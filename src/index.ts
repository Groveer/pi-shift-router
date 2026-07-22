/**
 * Smart Router — Pi-agent Extension
 *
 * Intelligently routes tasks to the optimal model based on complexity.
 * Uses a sliding window trend detection algorithm to balance
 * output quality with cost efficiency while protecting prompt cache.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tier, SmartRouterConfig, RouterState, ProviderEndpoint } from "./types.js";
import { loadConfig, resolveJudgeEndpoint } from "./config.js";
import { findBestModelForTier, tierEmoji, formatTierDisplay } from "./tier.js";
import { classify } from "./judge.js";
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
  let judgeEndpoint: ProviderEndpoint | null = null;
  let initialized = false;

  const getConfig = () => config;
  const getState = () => state;

  // ── Initialization ──────────────────────────────────────────

  async function initialize(ctx: { cwd: string; ui?: any }) {
    if (initialized) return;
    config = await loadConfig(ctx.cwd);
    state = createRouterState();
    judgeEndpoint = await resolveJudgeEndpoint(config);
    initialized = true;
  }

  // ── Session lifecycle ───────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    await initialize(ctx);

    if (!config.enabled) {
      ctx.ui.setStatus("smart-router", "SR ⛔");
      return;
    }

    const initialModel = findBestModelForTier("medium", config, pi);
    if (initialModel) {
      state.currentTier = "medium";
      state.currentModelId = initialModel.modelId;
      state.currentProvider = initialModel.provider;
    }

    updateStatusBar(ctx.ui, state, config);
  });

  // ── Before each agent turn: routing decision ────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!initialized) await initialize(ctx);
    if (!config?.enabled) return;
    if (!event.prompt?.trim()) return;

    // 1. Classify: try LLM judge → fallback heuristic
    const judgeResult = await classify(event.prompt, judgeEndpoint);

    // 2. Route decision
    const result = processRoute(judgeResult, state, config, pi);

    // 3. Apply switch
    if (result.switchTo) {
      const success = await applyModelSwitch(result.switchTo, state, pi);
      if (success && !config.ux.quietMode && config.ux.inlineToast) {
        const emoji = tierEmoji(state.currentTier);
        const name = state.currentModelId?.split("/").pop() ?? "";
        ctx.ui.notify(`🔄 SR: ${emoji} ${name}`, "info");
      }
    }

    updateStatusBar(ctx.ui, state, config);

    if (state.manualOverride.active) clearManualOverride(state);
  });

  // ── Status bar ──────────────────────────────────────────────

  function updateStatusBar(ui: any, s: RouterState, cfg: SmartRouterConfig) {
    if (!cfg.ux.statusBar) { ui.setStatus("smart-router", undefined); return; }
    const display = formatTierDisplay(s.currentTier, s.currentModelId, s.currentProvider);
    const mode = cfg.enabled ? "✅" : "⛔";
    ui.setStatus("smart-router", `SR ${mode} ${display}`);
  }

  // ── Commands ────────────────────────────────────────────────

  registerCommands(
    pi,
    getConfig,
    getState,
    async () => {
      // Called after config changes — re-resolve judge endpoint
      judgeEndpoint = await resolveJudgeEndpoint(config);
      state.window = [];
      clearManualOverride(state);
    },
    (tier: Tier) => setManualOverrideTier(state, tier),
  );
}
