/**
 * Smart Router — Slash commands
 *
 * /router          — Show status, enable/disable
 * /route-force     — Manual override for current turn
 * /route status    — Detailed router state
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SmartRouterConfig, RouterState, Tier } from "./types.js";
import {
  isValidTier,
  tierEmoji,
  tierBadge,
  tierLabel,
  formatTierDisplay,
} from "./tier.js";
import { clearManualOverride, setManualOverrideModel } from "./router.js";
import { getConfigPath } from "./config.js";

/** Format the window contents for display */
function formatWindow(window: RouterState["window"]): string {
  if (window.length === 0) return "(empty)";
  return "[" + window.map((e) => tierBadge(e.tier).toLowerCase()).join(", ") + "]";
}

/** Count tier occurrences in window */
function countTiers(window: RouterState["window"]): Record<string, number> {
  const counts: Record<string, number> = { light: 0, medium: 0, flagship: 0 };
  for (const e of window) counts[e.tier]++;
  return counts;
}

/** Register all smart router commands */
export function registerCommands(
  pi: ExtensionAPI,
  getConfig: () => SmartRouterConfig,
  getState: () => RouterState,
  onToggleEnabled: () => void,
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
        onToggleEnabled();
        ctx.ui.notify("Smart Router: ✅ Enabled", "info");
        return;
      }

      if (arg === "off") {
        config.enabled = false;
        onToggleEnabled();
        ctx.ui.notify("Smart Router: ⛔ Disabled", "info");
        return;
      }

      if (arg === "quiet") {
        config.ux.quietMode = !config.ux.quietMode;
        const status = config.ux.quietMode ? "🔇 Quiet mode ON" : "🔊 Notifications ON";
        ctx.ui.notify(`Smart Router: ${status}`, "info");
        return;
      }

      if (arg === "status") {
        // Show detailed status view
        const windowStr = formatWindow(state.window);
        const counts = countTiers(state.window);
        const total = state.window.length;

        let detail = `Mode: ${config.routing.mode.toUpperCase()}
Enabled: ${config.enabled ? "✅" : "⛔"}
Quiet: ${config.ux.quietMode ? "🔇" : "🔊"}

Current: ${formatTierDisplay(state.currentTier, state.currentModelId, state.currentProvider)}
Window: ${windowStr}  (${total} entries)
Counts: F=${counts.flagship} M=${counts.medium} L=${counts.light}
Manual: ${state.manualOverride.active ? `✅ ${state.manualOverride.tier ?? state.manualOverride.modelId ?? "active"}` : "✗ None"}

Config: ${getConfigPath() ?? "N/A"}`;

        ctx.ui.notify(detail, "info");
        return;
      }

      // Default: show compact status
      const mode = config.enabled ? "✅" : "⛔";
      const tier = state.currentTier;
      const manual = state.manualOverride.active ? " (manual)" : "";
      ctx.ui.notify(
        `Smart Router ${mode} | ${formatTierDisplay(tier, state.currentModelId, state.currentProvider)}${manual}`,
        "info",
      );
    },
  });

  // ── /route-force ──────────────────────────────────────────────
  pi.registerCommand("route-force", {
    description: "Force a specific tier or model for the next turn: /route-force <tier|model>",
    getArgumentCompletions: (prefix: string) => {
      const tiers = ["light", "medium", "flagship", "auto"].filter((c) => c.startsWith(prefix));
      return tiers.length > 0 ? tiers.map((c) => ({ value: c, label: c })) : null;
    },
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      const config = getConfig();

      if (!arg || arg === "auto") {
        clearManualOverride(getState());
        ctx.ui.notify("Smart Router: Manual override cleared, returning to auto mode", "info");
        return;
      }

      if (isValidTier(arg)) {
        onManualOverrideTier(arg);
        const emoji = tierEmoji(arg);
        const label = tierLabel(arg, config);
        ctx.ui.notify(`Smart Router: ${emoji} Forcing "${label}" tier for next turn`, "info");
        return;
      }

      // Try as model ID (provider/model format)
      const parts = arg.split("/");
      if (parts.length === 2) {
        setManualOverrideModel(getState(), parts[0], parts[1]);
        ctx.ui.notify(`Smart Router: 🎯 Forcing model "${parts[1]}" (${parts[0]}) for next turn`, "info");
        return;
      }

      ctx.ui.notify(
        `Smart Router: Unknown target "${arg}". Use: light, medium, flagship, auto, or provider/model-id`,
        "error",
      );
    },
  });
}
