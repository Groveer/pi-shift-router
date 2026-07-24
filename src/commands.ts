/**
 * Slim Router — Slash commands
 *
 * /router          — Show status, enable/disable
 * /route-force     — Manual override for current turn
 * /route status    — Detailed router state
 * /route-config    — Interactive configuration wizard
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SmartRouterConfig, RouterState, Tier, TierEntry } from "./types.js";
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
        `  ${tierEmoji(e.tier)} ${e.label.padEnd(14)} ${e.models.map((m: { provider: string; model: string }) => `${m.provider}/${m.model}`).join(", ") || "(none)"}`,
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

  type MenuChoice = "light" | "medium" | "flagship" | "ux" | "done" | "cancel";

  async function saveDestination(): Promise<"user" | "project" | null> {
    const choice = await ctx.ui.select("Save configuration to…", [
      "📁 Project — <cwd>/.pi/pi-slim-router.json (shareable with team)",
      "👤 User — ~/.pi/agent/pi-slim-router.json (personal)",
      "🚫 Cancel save",
    ]);
    if (!choice) return null;
    if (choice.startsWith("📁")) return "project";
    if (choice.startsWith("👤")) return "user";
    return null;
  }

  async function menu(): Promise<MenuChoice> {
    const lightSuffix = config.tiers.light.models.length > 0 ? " (also Judge)" : "";
    const choice = await ctx.ui.select("Slim Router — Configuration", [
      `⚡ Light — ${config.tiers.light.models.length} model(s)${lightSuffix}`,
      `🦾 Medium — ${config.tiers.medium.models.length} model(s)`,
      `🧠 Flagship — ${config.tiers.flagship.models.length} model(s)`,
      "---",
      "🎨 UX settings",
      "---",
      "💾 Save & exit",
      "🚫 Discard & exit",
    ]);

    if (!choice) return "cancel";
    if (choice.startsWith("⚡")) return "light";
    if (choice.startsWith("🦾")) return "medium";
    if (choice.startsWith("🧠")) return "flagship";
    if (choice.startsWith("🎨")) return "ux";
    if (choice.startsWith("💾")) return "done";
    return "cancel";
  }

  async function editTier(tier: Tier): Promise<void> {
    const cfg = config.tiers[tier];
    const selectedKey = cfg.models[0]
      ? `${cfg.models[0].provider}/${cfg.models[0].model}`
      : null;

    const options = allModels
      .filter((m) => m.cost?.input != null)
      .map((m) => {
        const key = `${m.provider}/${m.id}`;
        const isSelected = key === selectedKey;
        const judgeSuffix = (tier === "light" && isSelected) ? "  (Judge)" : "";
        return {
          key,
          label: `${isSelected ? "●" : "○"} ${key.padEnd(35)} $${m.cost!.input.toFixed(3)}/M${judgeSuffix}`,
          isSelected,
        };
      })
      .sort((a, b) => (a.isSelected === b.isSelected ? 0 : a.isSelected ? -1 : 1));

    const header = `Select ${tierEmoji(tier)} ${cfg.label} model`;
    const labels: string[] = [];
    if (selectedKey) labels.push("❌ Clear selection");
    labels.push(...options.map((o) => o.label), "---", "✅ Done");

    const pick = await ctx.ui.select(header, labels);
    if (!pick || pick.startsWith("✅")) return;

    if (pick.startsWith("❌")) { cfg.models = []; return; }

    const picked = options.find((o) => pick.includes(o.key));
    if (!picked) return;

    const [prov, modelId] = picked.key.split("/");
    cfg.models = [{ provider: prov, model: modelId, priority: 1 }];
  }

  // Judge is no longer user-configurable — always uses light tier's model.

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
    } else if (choice === "ux") {
      await editUX();
    }
  }

  if (!saving) return false;

  const scope = await saveDestination();
  if (!scope) return false;

  const saved = await saveConfig(config, cwd, scope);
  if (saved) {
    ctx.ui.notify(`Slim Router: 💾 Configuration saved to ${getConfigPath() ?? scope + " config"}`, "info");
  } else {
    ctx.ui.notify("Slim Router: ⚠ Failed to save configuration", "error");
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
  updateStatus: (ui: any) => void,
): void {
  // ── /router ──────────────────────────────────────────────────
  pi.registerCommand("router", {
    description: "Slim Router: show status, enable/disable",
    getArgumentCompletions: (prefix: string) => {
      const cmds = ["on", "off", "status", "quiet", "config"].filter((c) => c.startsWith(prefix));
      return cmds.length > 0 ? cmds.map((c) => ({ value: c, label: c })) : null;
    },
    handler: async (args, ctx) => {
      const config = getConfig();
      const state = getState();
      const arg = args.trim().toLowerCase();

      if (arg === "on") {
        config.enabled = true;
        onConfigChanged();
        updateStatus(ctx.ui);
        ctx.ui.notify("Slim Router: ✅ Enabled", "info");
        return;
      }
      if (arg === "off") {
        config.enabled = false;
        onConfigChanged();
        updateStatus(ctx.ui);
        ctx.ui.notify("Slim Router: ⛔ Disabled", "info");
        return;
      }
      if (arg === "config") {
        await routeConfigWizard(getConfig(), ctx.cwd, ctx);
        onConfigChanged();
        updateStatus(ctx.ui);
        return;
      }
      if (arg === "quiet") {
        config.ux.quietMode = !config.ux.quietMode;
        ctx.ui.notify(`Slim Router: ${config.ux.quietMode ? "🔇 Quiet" : "🔊 Notifications"}`, "info");
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
        ctx.ui.notify("Slim Router: Manual override cleared", "info");
        return;
      }

      if (isValidTier(arg)) {
        onManualOverrideTier(arg);
        ctx.ui.notify(`Slim Router: ${tierEmoji(arg)} Forcing "${tierLabel(arg, getConfig())}" tier`, "info");
        return;
      }

      // provider/model
      const parts = arg.split("/");
      if (parts.length === 2) {
        setManualOverrideModel(getState(), parts[0], parts[1]);
        ctx.ui.notify(`Slim Router: 🎯 Forcing ${parts[0]}/${parts[1]}`, "info");
        return;
      }

      ctx.ui.notify('Usage: light, medium, flagship, auto, or provider/model-id', "error");
    },
  });

}
