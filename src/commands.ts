/**
 * Smart Router — Slash commands
 *
 * /router          — Show status, enable/disable
 * /route-force     — Manual override for current turn
 * /route status    — Detailed router state
 * /route-config    — Interactive configuration wizard
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SmartRouterConfig, RouterState, Tier } from "./types.js";
import { TIERS } from "./types.js";
import {
  isValidTier,
  tierEmoji,
  tierLabel,
  formatTierDisplay,
} from "./tier.js";
import {
  clearManualOverride,
  setManualOverrideModel,
} from "./router.js";
import {
  getConfigPath,
  loadModelsStore,
  flattenModels,
  saveConfig,
} from "./config.js";

// ─── Helpers ──────────────────────────────────────────────────────

function formatWindow(window: RouterState["window"]): string {
  if (window.length === 0) return "(empty)";
  const badge: Record<string,string> = { light: "l", medium: "m", flagship: "f" };
  return "[" + window.map((e) => badge[e.tier] ?? "?").join(", ") + "]";
}

function tierEntries(config: SmartRouterConfig): TierEntry[] {
  return TIERS.map((t) => ({
    tier: t,
    label: config.tiers[t].label,
    description: config.tiers[t].description,
    models: config.tiers[t].models.map((m) => ({ provider: m.provider, model: m.model })),
  }));
}

function formatTierList(config: SmartRouterConfig): string {
  return tierEntries(config)
    .map(
      (e) =>
        `  ${tierEmoji(e.tier)} ${e.label.padEnd(14)} ${e.models.map((m) => `${m.provider}/${m.model}`).join(", ") || "(none)"}`,
    )
    .join("\n");
}

// ─── `/route-config` wizard ──────────────────────────────────────

async function routeConfigWizard(
  config: SmartRouterConfig,
  cwd: string,
  ctx: { ui: any },
): Promise<boolean> {
  const store = await loadModelsStore();
  const allModels = flattenModels(store);

  if (allModels.length === 0) {
    ctx.ui.notify("No models found in models-store.json", "error");
    return false;
  }

  type MenuChoice = "light" | "medium" | "flagship" | "judge" | "ux" | "done" | "cancel";

  async function menu(): Promise<MenuChoice> {
    const choice = await ctx.ui.select("Smart Router — Configuration", [
      `⚡ Light — ${config.tiers.light.models.length} model(s)`,
      `🟡 Medium — ${config.tiers.medium.models.length} model(s)`,
      `🚀 Flagship — ${config.tiers.flagship.models.length} model(s)`,
      "---",
      "🤖 Judge model",
      "🎨 UX settings",
      "---",
      "💾 Save & exit",
      "🚫 Discard & exit",
    ]);

    if (!choice) return "cancel";
    if (choice.startsWith("⚡")) return "light";
    if (choice.startsWith("🟡")) return "medium";
    if (choice.startsWith("🚀")) return "flagship";
    if (choice.startsWith("🤖")) return "judge";
    if (choice.startsWith("🎨")) return "ux";
    if (choice.startsWith("💾")) return "done";
    return "cancel";
  }

  async function editTier(tier: Tier): Promise<void> {
    const cfg = config.tiers[tier];
    const current = cfg.models.map((m) => `${m.provider}/${m.model}`);

    // Pick a model to toggle: if already in tier → remove; else → add
    const options = allModels
      .filter((m) => m.cost?.input != null)
      .map((m) => {
        const key = `${m.provider}/${m.id}`;
        const inTier = current.includes(key);
        return {
          key,
          label: `${inTier ? "☑" : "☐"} ${key.padEnd(35)} $${m.cost!.input.toFixed(3)}/M`,
          inTier,
        };
      })
      .sort((a, b) => (a.inTier === b.inTier ? 0 : a.inTier ? -1 : 1));

    const header = `Edit ${tierEmoji(tier)} ${cfg.label} tier\nTap a model to toggle. [Done] when finished.`;
    const labels = [...options.map((o) => o.label), "---", "✅ Done"];

    let done = false;
    while (!done) {
      const pick = await ctx.ui.select(header, labels);
      if (!pick || pick.startsWith("✅")) { done = true; break; }

      const idx = labels.indexOf(pick);
      if (idx < 0 || idx >= options.length) continue;

      const opt = options[idx];
      const key = opt.key;
      const [prov, modelId] = key.split("/");

      if (opt.inTier) {
        // Remove
        cfg.models = cfg.models.filter((m) => !(m.provider === prov && m.model === modelId));
        options[idx].inTier = false;
        options[idx].label = options[idx].label.replace("☑", "☐");
      } else {
        // Add
        cfg.models.push({ provider: prov, model: modelId, priority: cfg.models.length + 1 });
        options[idx].inTier = true;
        options[idx].label = options[idx].label.replace("☐", "☑");
      }
    }
  }

  async function editJudge(): Promise<void> {
    const isAuto = config.judge.provider === "auto" && config.judge.model === "auto";

    const choices = [
      `${isAuto ? "☑" : "☐"} Auto — pick cheapest available model`,
      "---",
      ...allModels
        .filter((m) => m.cost?.input != null)
        .map((m) => {
          const key = `${m.provider}/${m.id}`;
          const selected = !isAuto && config.judge.provider === m.provider && config.judge.model === m.id;
          return `${selected ? "☑" : "☐"} ${key.padEnd(35)} $${m.cost!.input.toFixed(3)}/M`;
        }),
      "---",
      "✅ Done",
    ];

    const pick = await ctx.ui.select("🤖 Judge Model", choices);
    if (!pick || pick.startsWith("✅")) return;

    // Manual pick
    for (const m of allModels) {
      const key = `${m.provider}/${m.id}`;
      if (pick.includes(key)) {
        config.judge.provider = m.provider;
        config.judge.model = m.id;
        return;
      }
    }
    // Auto
    if (pick.includes("Auto")) {
      config.judge.provider = "auto";
      config.judge.model = "auto";
    }
  }

  async function editUX(): Promise<void> {
    const ux = config.ux;
    const lines = [
      `${ux.quietMode ? "☑" : "☐"} Quiet mode — no inline toast notifications`,
      `${ux.statusBar ? "☑" : "☐"} Status bar — show current tier/model in footer`,
      `${ux.inlineToast ? "☑" : "☐"} Inline toast — notify on tier change`,
      "---",
      "✅ Done",
    ];

    const pick = await ctx.ui.select("🎨 UX Settings", lines);
    if (!pick || pick.includes("✅")) return;
    if (pick.includes("Quiet")) ux.quietMode = !ux.quietMode;
    if (pick.includes("Status bar")) ux.statusBar = !ux.statusBar;
    if (pick.includes("Inline toast")) ux.inlineToast = !ux.inlineToast;
  }

  // Main loop
  let saving = false;
  for (;;) {
    const choice = await menu();
    if (choice === "cancel") return false;
    if (choice === "done") { saving = true; break; }
    if (choice === "light" || choice === "medium" || choice === "flagship") {
      await editTier(choice);
    } else if (choice === "judge") {
      await editJudge();
    } else if (choice === "ux") {
      await editUX();
    }
  }

  if (!saving) return false;

  const saved = await saveConfig(config, cwd);
  if (saved) {
    ctx.ui.notify(`Smart Router: 💾 Configuration saved to ${getConfigPath() ?? ".pi/smartrouter.json"}`, "info");
  } else {
    ctx.ui.notify("Smart Router: ⚠ Failed to save configuration", "error");
  }
  return saved;
}

// ─── Command registration ────────────────────────────────────────

export function registerCommands(
  pi: ExtensionAPI,
  getConfig: () => SmartRouterConfig,
  getState: () => RouterState,
  onConfigChanged: () => void,
  onManualOverrideTier: (tier: Tier) => void,
): void {
  // ── /router ──────────────────────────────────────────────────
  pi.registerCommand("router", {
    description: "Smart Router: show status, enable/disable",
    getArgumentCompletions: (prefix: string) => {
      const cmds = ["on", "off", "status", "quiet"].filter((c) => c.startsWith(prefix));
      return cmds.length > 0 ? cmds.map((c) => ({ value: c, label: c })) : null;
    },
    handler: async (args, ctx) => {
      const config = getConfig();
      const state = getState();
      const arg = args.trim().toLowerCase();

      if (arg === "on") {
        config.enabled = true;
        onConfigChanged();
        ctx.ui.notify("Smart Router: ✅ Enabled", "info");
        return;
      }
      if (arg === "off") {
        config.enabled = false;
        onConfigChanged();
        ctx.ui.notify("Smart Router: ⛔ Disabled", "info");
        return;
      }
      if (arg === "quiet") {
        config.ux.quietMode = !config.ux.quietMode;
        ctx.ui.notify(`Smart Router: ${config.ux.quietMode ? "🔇 Quiet" : "🔊 Notifications"}`, "info");
        return;
      }
      if (arg === "status") {
        const counts: Record<string, number> = { light: 0, medium: 0, flagship: 0 };
        for (const e of state.window) counts[e.tier]++;

        ctx.ui.notify(
          [
            `Mode: ${config.routing.mode.toUpperCase()}  Enabled: ${config.enabled ? "✅" : "⛔"}  Quiet: ${config.ux.quietMode ? "🔇" : "🔊"}`,
            ``,
            `Current: ${formatTierDisplay(state.currentTier, state.currentModelId)}`,
            `Window: ${formatWindow(state.window)}  (${state.window.length} entries)`,
            `Counts: F=${counts.flagship} M=${counts.medium} L=${counts.light}`,
            `Manual: ${state.manualOverride.active ? `✅ ${state.manualOverride.tier ?? state.manualOverride.modelId ?? "active"}` : "✗ None"}`,
            ``,
            `Config: ${getConfigPath() ?? "N/A"}`,
            ``,
            formatTierList(config),
          ].join("\n"),
          "info",
        );
        return;
      }

      // Default: compact status
      ctx.ui.notify(
        `${config.enabled ? "" : "⛔ "}${formatTierDisplay(state.currentTier, state.currentModelId)}${state.manualOverride.active ? " (manual)" : ""}`,
        "info",
      );
    },
  });

  // ── /route-force ──────────────────────────────────────────────
  pi.registerCommand("route-force", {
    description: "Force a specific tier or model for the next turn: /route-force <tier|provider/model>",
    getArgumentCompletions: (prefix: string) => {
      const opts = ["light", "medium", "flagship", "auto"].filter((c) => c.startsWith(prefix));
      return opts.length > 0 ? opts.map((c) => ({ value: c, label: c })) : null;
    },
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (!arg || arg === "auto") {
        clearManualOverride(getState());
        ctx.ui.notify("Smart Router: Manual override cleared", "info");
        return;
      }

      if (isValidTier(arg)) {
        onManualOverrideTier(arg);
        ctx.ui.notify(`Smart Router: ${tierEmoji(arg)} Forcing "${tierLabel(arg, getConfig())}" tier`, "info");
        return;
      }

      // provider/model
      const parts = arg.split("/");
      if (parts.length === 2) {
        setManualOverrideModel(getState(), parts[0], parts[1]);
        ctx.ui.notify(`Smart Router: 🎯 Forcing ${parts[0]}/${parts[1]}`, "info");
        return;
      }

      ctx.ui.notify('Usage: light, medium, flagship, auto, or provider/model-id', "error");
    },
  });

  // ── /route-config ─────────────────────────────────────────────
  pi.registerCommand("route-config", {
    description: "Interactive configuration wizard",
    handler: async (_args, ctx) => {
      await routeConfigWizard(getConfig(), ctx.cwd, ctx);
      onConfigChanged();
    },
  });
}
