/**
 * Slim Router — Pi-agent Extension
 *
 * Routes tasks to the optimal model based on complexity.
 * Two tiers: Fast (execution) ↔ Smart (judgment).
 * Uses sliding window trend detection with LLM Judge.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tier, SlimRouterConfig, RouterState, ProviderEndpoint } from "./types.js";
import { loadConfig, resolveFastEndpoint } from "./config.js";
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

/** Check if both tiers share the same model configuration */
function allTiersIdentical(config: SlimRouterConfig): boolean {
  const { fast, smart } = config.tiers;
  const modelsJson = (tc: typeof fast) =>
    tc.models.map((m) => `${m.provider}/${m.model}`).sort().join(",");
  return modelsJson(fast) === modelsJson(smart);
}

export default function slimRouterExtension(pi: ExtensionAPI) {
  let config: SlimRouterConfig;
  let state: RouterState;
  let fastEndpoint: ProviderEndpoint | null = null;
  let initialized = false;

  const getConfig = () => config;
  const getState = () => state;

  // ── Init ────────────────────────────────────────────────────

  async function init(ctx: { cwd: string; ui?: any }) {
    if (initialized) return;
    config = await loadConfig(ctx.cwd);
    state = createRouterState();
    fastEndpoint = await resolveFastEndpoint(config);
    initialized = true;
  }

  // ── Status bar ──────────────────────────────────────────────

  function updateBar(ui: any, cfg: SlimRouterConfig, s: RouterState) {
    if (!cfg.ux.statusBar) { ui.setStatus("slim-router", undefined); return; }
    const badge = cfg.enabled
      ? formatTierDisplay(s.currentTier, s.currentModelId)
      : "⛔";
    ui.setStatus("slim-router", badge);
  }

  // ── Session start ───────────────────────────────────────────
  //
  // Observe only: read config, init state, update status bar.
  // Do NOT call pi.setModel() — respect the user's default model.
  // The router only changes models during before_agent_start.

  pi.on("session_start", async (_event, ctx) => {
    await init(ctx);
    updateBar(ctx.ui, config, state);

    // Hint when tiers are identically configured
    if (config.enabled && allTiersIdentical(config)) {
      console.warn(
        "[SlimRouter] Both tiers share the same model. " +
        "Run '/router config' to set up tier-specific routing."
      );
    }
  });

  // ── Before each turn ────────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!initialized) await init(ctx);
    if (!config?.enabled || !event.prompt?.trim()) return;

    const verbose = config.ux.routerLogVerbose;
    const promptPreview = event.prompt.slice(0, 80).replace(/\n/g, " ");
    if (verbose) {
      console.log(`\n[SlimRouter] ─── Turn start ───`);
      console.log(`[SlimRouter] prompt: "${promptPreview}${event.prompt.length > 80 ? "…" : ""}"`);
      console.log(`[SlimRouter] current: ${formatTierDisplay(state.currentTier, state.currentModelId)}`);
    }

    // Show transient "judging..." badge in status bar so the user sees
    // the router is working during the Judge API call.
    if (config.ux.statusBar) ctx.ui.setStatus("slim-router", "⚖ judging…");

    let judgeResult;
    try {
      judgeResult = await classify(
        event.prompt,
        fastEndpoint,
        config.routing.judgeTimeout,
        verbose,
      );
    } finally {
      // Restore the proper status badge immediately, regardless of judge outcome.
      updateBar(ctx.ui, config, state);
    }

    if (verbose) {
      const ratio = state.window.length === 0
        ? "0/0"
        : `${state.window.filter((e) => e.tier === "fast").length}/${state.window.length}`;
      console.log(
        `[SlimRouter] judge: ${judgeResult.tier} (${judgeResult.source}), ` +
        `window=[${state.window.map((e) => e.tier[0]).join("")}] (${ratio} fast)`,
      );
    }

    const result = processRoute(judgeResult, state, config, ctx.modelRegistry as any);

    if (verbose) {
      console.log(`[SlimRouter] decision: ${result.action}${result.switchTo ? ` → ${result.switchTo.provider}/${result.switchTo.modelId}` : ""}`);
    }

    if (result.switchTo) {
      const ok = await applyModelSwitch(
        result.switchTo, state,
        ctx.modelRegistry as any,
        (m) => pi.setModel(m as any),
      );
      if (verbose) console.log(`[SlimRouter] model switch ${ok ? "ok" : "FAILED"}`);
      if (ok && !config.ux.quietMode && config.ux.inlineToast) {
        ctx.ui.notify(`${formatTierDisplay(state.currentTier, state.currentModelId)}`, "info");
      }
    } else if (!state.currentModelId && state.currentTier) {
      // First turn with no model yet — resolve one for current tier
      const m = findBestModelForTier(state.currentTier, config, ctx.modelRegistry as any);
      if (m) {
        await applyModelSwitch(m, state, ctx.modelRegistry as any, (model) => pi.setModel(model as any));
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
      fastEndpoint = await resolveFastEndpoint(config);
      state.window = [];
      clearManualOverride(state);
    },
    (tier: Tier) => setManualOverrideTier(state, tier),
    (ui: any) => updateBar(ui, config, state),
  );
}
