/**
 * pi-shift-router — Pi-agent Extension
 *
 * Routes tasks to the optimal model based on complexity.
 * Two tiers: Fast (execution) ↔ Smart (judgment).
 * Uses sliding window trend detection with LLM Judge.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tier, ShiftRouterConfig, RouterState, ProviderEndpoint } from "./types.js";
import { loadConfig, resolveFastEndpoints } from "./config.js";
import { findBestModelForTier, formatTierDisplay } from "./tier.js";
import { classify } from "./judge.js";
import {
  createRouterState,
  processRoute,
  applyModelSwitch,
  clearManualOverride,
  setManualOverrideTier,
} from "./router.js";
import {
  planTurnFailover,
  clearModelCooldown,
  isModelInCooldown,
  cooldownPredicate,
  remainingCooldownMs,
  formatRemaining,
} from "./failover.js";
import { registerCommands } from "./commands.js";

/** Check if both tiers share the same model configuration */
function allTiersIdentical(config: ShiftRouterConfig): boolean {
  const { fast, smart } = config.tiers;
  const modelsJson = (tc: typeof fast) =>
    tc.models.map((m) => `${m.provider}/${m.model}`).sort().join(",");
  return modelsJson(fast) === modelsJson(smart);
}

export default function slimRouterExtension(pi: ExtensionAPI) {
  let config: ShiftRouterConfig;
  let state: RouterState;
  let fastEndpoints: ProviderEndpoint[] = [];
  let initialized = false;

  const getConfig = () => config;
  const getState = () => state;

  // ── Init ────────────────────────────────────────────────────

  async function init(ctx: { cwd: string; ui?: any }) {
    if (initialized) return;
    config = await loadConfig(ctx.cwd);
    state = createRouterState();
    fastEndpoints = await resolveFastEndpoints(config);
    initialized = true;
  }

  // ── Status bar ──────────────────────────────────────────────

  function updateBar(ui: any, cfg: ShiftRouterConfig, s: RouterState) {
    if (!cfg.ux.statusBar) { ui.setStatus("shift-router", undefined); return; }
    const badge = cfg.enabled
      ? formatTierDisplay(s.currentTier, s.currentModelId)
      : "⛔";
    ui.setStatus("shift-router", badge);
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
        "[ShiftRouter] Both tiers share the same model. " +
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
      console.log(`\n[ShiftRouter] ─── Turn start ───`);
      console.log(`[ShiftRouter] prompt: "${promptPreview}${event.prompt.length > 80 ? "…" : ""}"`);
      console.log(`[ShiftRouter] current: ${formatTierDisplay(state.currentTier, state.currentModelId)}`);
    }

    // Show transient "judging..." badge in status bar so the user sees
    // the router is working during the Judge API call.
    if (config.ux.statusBar) ctx.ui.setStatus("shift-router", "⚖ judging…");

    let judgeResult;
    try {
      judgeResult = await classify(
        event.prompt,
        fastEndpoints,
        config.routing.judgeTimeout,
        verbose,
        cooldownPredicate(state.modelCooldowns, Date.now()),
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
        `[ShiftRouter] judge: ${judgeResult.tier} (${judgeResult.source}), ` +
        `window=[${state.window.map((e) => e.tier[0]).join("")}] (${ratio} fast)`,
      );
    }

    const result = processRoute(judgeResult, state, config, ctx.modelRegistry as any);

    if (verbose) {
      console.log(`[ShiftRouter] decision: ${result.action}${result.switchTo ? ` → ${result.switchTo.provider}/${result.switchTo.modelId}` : ""}`);
    }

    if (result.switchTo) {
      const ok = await applyModelSwitch(
        result.switchTo, state,
        ctx.modelRegistry as any,
        (m) => pi.setModel(m as any),
      );
      if (verbose) console.log(`[ShiftRouter] model switch ${ok ? "ok" : "FAILED"}`);
      if (ok && !config.ux.quietMode && config.ux.inlineToast) {
        ctx.ui.notify(`${formatTierDisplay(state.currentTier, state.currentModelId)}`, "info");
      }
    } else if (!state.currentModelId && state.currentTier) {
      // First turn with no model yet — resolve one for current tier,
      // skipping models in cooldown.
      const m = findBestModelForTier(state.currentTier, config, ctx.modelRegistry as any, cooldownPredicate(state.modelCooldowns, Date.now()));
      if (m) {
        await applyModelSwitch(m, state, ctx.modelRegistry as any, (model) => pi.setModel(model as any));
      }
    }

    updateBar(ctx.ui, config, state);
    if (state.manualOverride.active) clearManualOverride(state);
  });

  // ── Runtime failover (SPEC §8.5) ──────────────────────────────
  //
  // agent_end: if the turn failed with a failover signature, mark the
  // model into exponential-backoff cooldown and immediately setModel to
  // the next healthy model in the same tier. pi's pending
  // agent.continue() retry then runs with the fallback model.

  pi.on("agent_end", async (event, ctx) => {
    if (!initialized) await init(ctx);
    if (!config?.enabled) return;
    if (state.manualOverride.active) return; // user forced a model — don't override

    const now = Date.now();
    const plan = planTurnFailover(
      (event as any).messages ?? [],
      state,
      config,
      (ctx as any).modelRegistry as any,
      now,
    );
    if (!plan) return; // healthy turn or non-failover error

    if (config.ux.routerLogVerbose) {
      console.log(
        `[ShiftRouter] ⚠ ${plan.failed.provider}/${plan.failed.model} failed (${plan.failed.code}) → cooldown ${formatRemaining(remainingFor(state, plan.failed.provider, plan.failed.model))}`,
      );
    }

    if (plan.switched && plan.fallback) {
      const ok = await applyModelSwitch(
        plan.fallback, state,
        (ctx as any).modelRegistry as any,
        (m) => pi.setModel(m as any),
      );
      if (ok && !config.ux.quietMode && config.ux.inlineToast) {
        const retry = formatRemaining(remainingFor(state, plan.failed.provider, plan.failed.model));
        ctx.ui.notify(
          `⚠️ ${shortModel(plan.failed.provider, plan.failed.model)} unavailable (${plan.failed.code}), ` +
          `switching to ${shortModel(plan.fallback.provider, plan.fallback.modelId)} — retry in ${retry}`,
          "warning",
        );
      }
    } else if (!config.ux.quietMode && config.ux.inlineToast) {
      ctx.ui.notify(
        `⚠️ ${shortModel(plan.failed.provider, plan.failed.model)} unavailable (${plan.failed.code}) — ` +
        `all ${plan.failed.provider} models in cooldown, keeping current`,
        "warning",
      );
    }

    updateBar(ctx.ui, config, state);
  });

  // after_provider_response: a 2xx response means the model works again —
  // clear its cooldown immediately (SPEC §8.5.2(4) recovery).

  pi.on("after_provider_response", async (event, ctx) => {
    if (!initialized) await init(ctx);
    if (!config?.enabled) return;
    if (event.status >= 200 && event.status < 300 && state.currentProvider && state.currentModelId) {
      if (isModelInCooldown(state.modelCooldowns, state.currentProvider, state.currentModelId, Date.now())) {
        clearModelCooldown(state.modelCooldowns, state.currentProvider, state.currentModelId);
        if (config.ux.routerLogVerbose) {
          console.log(
            `[ShiftRouter] ✓ ${state.currentProvider}/${state.currentModelId} recovered (HTTP ${event.status}) — cooldown cleared`,
          );
        }
      }
    }
  });

  // ── Commands ────────────────────────────────────────────────

  registerCommands(
    pi,
    getConfig,
    getState,
    async () => {
      fastEndpoints = await resolveFastEndpoints(config);
      state.window = [];
      state.modelCooldowns.clear();
      clearManualOverride(state);
    },
    (tier: Tier) => setManualOverrideTier(state, tier),
    (ui: any) => updateBar(ui, config, state),
  );
}

// ── Display helpers ────────────────────────────────────────────────

/** Short model name: "minimax/MiniMax-M3" → "MiniMax-M3". */
function shortModel(_provider: string, model: string): string {
  return model.split("/").pop() ?? model;
}

/** Remaining cooldown for a model from the state map. */
function remainingFor(
  state: RouterState,
  provider: string,
  model: string,
): number {
  return remainingCooldownMs(state.modelCooldowns, provider, model, Date.now());
}
