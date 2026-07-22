/**
 * Smart Router — Pi-agent Extension
 *
 * Routes tasks to the optimal model based on complexity.
 * Uses sliding window trend detection to balance quality and cost
 * while protecting prompt cache.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tier, SmartRouterConfig, RouterState, ProviderEndpoint } from "./types.js";
import { loadConfig, resolveJudgeEndpoint } from "./config.js";
import { findBestModelForTier, formatTierDisplay } from "./tier.js";
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

  // ── Init ────────────────────────────────────────────────────

  async function init(ctx: { cwd: string; ui?: any }) {
    if (initialized) return;
    config = await loadConfig(ctx.cwd);
    state = createRouterState();
    judgeEndpoint = await resolveJudgeEndpoint(config);
    initialized = true;
  }

  // ── Status bar ──────────────────────────────────────────────

  function updateBar(ui: any, cfg: SmartRouterConfig, s: RouterState) {
    if (!cfg.ux.statusBar) { ui.setStatus("smart-router", undefined); return; }
    const badge = cfg.enabled
      ? formatTierDisplay(s.currentTier, s.currentModelId)
      : "⛔";
    ui.setStatus("smart-router", badge);
  }

  // ── Session start ───────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    await init(ctx);

    if (!config.enabled) { updateBar(ctx.ui, config, state); return; }

    const m = findBestModelForTier("medium", config, ctx.modelRegistry as any);
    if (m) {
      state.currentTier = "medium";
      state.currentModelId = m.modelId;
      state.currentProvider = m.provider;
    }
    updateBar(ctx.ui, config, state);
  });

  // ── Before each turn ────────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!initialized) await init(ctx);
    if (!config?.enabled || !event.prompt?.trim()) return;

    const judgeResult = await classify(event.prompt, judgeEndpoint);
    const result = processRoute(judgeResult, state, config, ctx.modelRegistry as any);

    if (result.switchTo) {
      const ok = await applyModelSwitch(
        result.switchTo, state,
        ctx.modelRegistry as any,
        (m) => pi.setModel(m),
      );
      if (ok && !config.ux.quietMode && config.ux.inlineToast) {
        const name = state.currentModelId?.split("/").pop() ?? "";
        ctx.ui.notify(`${formatTierDisplay(state.currentTier, state.currentModelId)}`, "info");
      }
    }

    updateBar(ctx.ui, config, state);
    if (state.manualOverride.active) clearManualOverride(state);
  });

  // ── Commands ────────────────────────────────────────────────

  registerCommands(
    pi,
    getConfig,
    getState,
    async () => {
      judgeEndpoint = await resolveJudgeEndpoint(config);
      state.window = [];
      clearManualOverride(state);
    },
    (tier: Tier) => setManualOverrideTier(state, tier),
  );
}
