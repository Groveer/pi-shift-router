/**
 * Smart Router — Pi-agent Extension
 *
 * Intelligently routes tasks to the optimal model based on complexity.
 * Uses a sliding window trend detection algorithm to balance
 * output quality with cost efficiency while protecting prompt cache.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tier, SmartRouterConfig, RouterState } from "./types.js";
import { loadConfig } from "./config.js";
import { findBestModelForTier, tierEmoji, formatTierDisplay } from "./tier.js";
import { classifyHeuristic } from "./judge.js";
import {
  createRouterState,
  processRoute,
  applyModelSwitch,
  clearManualOverride,
  setManualOverrideTier,
} from "./router.js";
import { registerCommands } from "./commands.js";

export default function smartRouterExtension(pi: ExtensionAPI) {
  let config: SmartRouterConfig;
  let state: RouterState;
  let initialized = false;

  // Getter functions for commands module
  const getConfig = () => config;
  const getState = () => state;

  // ── Initialization ──────────────────────────────────────────

  async function initialize(ctx: { cwd: string; ui?: any; modelRegistry?: any }) {
    if (initialized) return;

    try {
      config = await loadConfig(ctx.cwd);
      state = createRouterState();
      initialized = true;
    } catch (err) {
      console.warn(`[SmartRouter] Init error: ${err}`);
      // Safe fallback: create minimal config
      config = await loadConfig(ctx.cwd);
      state = createRouterState();
      initialized = true;
    }
  }

  // ── Session lifecycle ───────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    await initialize(ctx);

    if (!config.enabled) {
      ctx.ui.setStatus("smart-router", "SmartRouter ⛔");
      return;
    }

    // Find best medium model as initial starting point
    const initialModel = findBestModelForTier("medium", config, pi);
    if (initialModel) {
      state.currentTier = "medium";
      state.currentModelId = initialModel.modelId;
      state.currentProvider = initialModel.provider;
    }

    // Update status bar
    updateStatusBar(ctx.ui, state, config);
  });

  // ── Before each agent turn: routing decision ────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!initialized) await initialize(ctx);
    if (!config.enabled) return;

    const prompt = event.prompt;
    if (!prompt || prompt.trim().length === 0) return;

    // 1. Classify the task
    const judgeResult = classifyHeuristic(prompt);

    // 2. Process route decision (synchronous — no API calls)
    const result = processRoute(judgeResult, state, config, pi);

    // 3. Apply model switch if needed
    if (result.switchTo) {
      const success = await applyModelSwitch(result.switchTo, state, pi);
      if (success) {
        // Notify on tier change (unless quiet mode)
        if (!config.ux.quietMode && config.ux.inlineToast) {
          const emoji = tierEmoji(state.currentTier);
          const modelName = state.currentModelId?.split("/").pop() ?? state.currentModelId ?? "";
          ctx.ui.notify(`🔄 SR: ${emoji} ${modelName}`, "info");
        }
      }
    }

    // 4. Update status bar
    if (config.ux.statusBar) {
      updateStatusBar(ctx.ui, state, config);
    }

    // 5. Manual override: clear after one turn
    if (state.manualOverride.active) {
      clearManualOverride(state);
    }
  });

  // ── Status bar update ───────────────────────────────────────

  function updateStatusBar(ui: any, s: RouterState, cfg: SmartRouterConfig) {
    if (!cfg.ux.statusBar) {
      ui.setStatus("smart-router", undefined);
      return;
    }

    const display = formatTierDisplay(s.currentTier, s.currentModelId, s.currentProvider);
    const mode = cfg.enabled ? "✅" : "⛔";
    ui.setStatus("smart-router", `SR ${mode} ${display}`);
  }

  // ── Register commands ───────────────────────────────────────

  registerCommands(
    pi,
    getConfig,
    getState,
    () => {
      state.window = [];
      clearManualOverride(state);
    },
    (tier: Tier) => {
      setManualOverrideTier(state, tier);
    },
  );
}
