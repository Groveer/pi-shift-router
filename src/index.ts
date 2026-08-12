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
import { findBestModelForTier, formatTierDisplay, formatTierDisplayWithSpeed } from "./tier.js";
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
  markModelFailed,
  clearModelCooldown,
  isModelInCooldown,
  cooldownPredicate,
  remainingCooldownMs,
  formatRemaining,
  tokensPerSecond,
  recordSpeed,
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
    const speed = s.recentSpeeds.length > 0 ? s.recentSpeeds[s.recentSpeeds.length - 1] : 0;
    const badge = cfg.enabled
      ? formatTierDisplayWithSpeed(s.currentTier, s.currentModelId, speed)
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
    if (config.ux.statusBar) ctx.ui.setStatus("shift-router", "🧭 judging…");

    let judgeResult;
    try {
      judgeResult = await classify(
        event.prompt,
        fastEndpoints,
        config.routing.judgeTimeout,
        verbose,
        cooldownPredicate(state.modelCooldowns, Date.now()),
        // Judge-side failure → mark the model into the shared cooldown map so
        // (a) the next judge call skips it without re-burning a 429, and
        // (b) the turn-path (`findBestModelForTier`) also avoids it.
        // Mirrors SPEC §8.5: only failover signatures cool down; classify's
        // own policy already excludes network/timeout/unparseable failures.
        (provider, model, code) => markModelFailed(state.modelCooldowns, provider, model, Date.now(), code),
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
        `[ShiftRouter] judge: ${judgeResult.tier} (${judgeResult.source})` +
          (judgeResult.confidence !== undefined ? ` conf=${judgeResult.confidence.toFixed(2)}` : "") +
          (judgeResult.reason !== undefined ? ` reason=${judgeResult.reason}` : "") +
          `, window=[${state.window.map((e) => e.tier[0]).join("")}] (${ratio} fast)`,
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

  // Track token throughput. message_start records when streaming began;
  // message_end computes tokens/sec from elapsed time and usage.output.

  pi.on("message_start", async (_event, ctx) => {
    if (!initialized) await init(ctx);
    const msg: any = (_event as any).message;
    // Use Date.now() rather than msg.timestamp because at stream-start the
    // timestamp field may not yet be populated on the partial message.
    if (msg?.role === "assistant") {
      state.streamingStartTime = Date.now();
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!initialized) await init(ctx);
    const msg: any = (event as any).message;
    if (!msg || msg.role !== "assistant") return;

    const usage = msg.usage;
    const outputTokens: number = usage?.output ?? 0;
    state.totalOutputTokens += outputTokens;
    // Cache-aware routing (SPEC §9.2): record the last activity so the
    // session-boundary gate knows whether the prompt cache is still warm.
    state.lastActivityAt = Date.now();

    // ── Cost telemetry (SPEC §9 "Cost telemetry — deep view") ────────
    // Attribute this message's tokens + cost to whichever tier was active
    // when it ran (`state.currentTier` reflects the model picked during
    // `before_agent_start`).
    const tokens = {
      input: usage?.input ?? 0,
      output: outputTokens,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
    };
    const messageCost = usage?.cost?.total ?? 0;
    const tierUsage = state.tierUsage[state.currentTier];
    tierUsage.calls += 1;
    tierUsage.tokens.input += tokens.input;
    tierUsage.tokens.output += tokens.output;
    tierUsage.tokens.cacheRead += tokens.cacheRead;
    tierUsage.tokens.cacheWrite += tokens.cacheWrite;
    tierUsage.cost += messageCost;
    state.callLog.push({
      tier: state.currentTier,
      provider: state.currentProvider ?? "?",
      modelId: state.currentModelId ?? "?",
      tokens,
      cost: messageCost,
    });

    // Compute throughput from wall-clock elapsed (we used Date.now() at
    // message_start, so streamingStartTime is reliably set for any assistant
    // message that ran through streaming).
    const startTime = state.streamingStartTime;
    if (startTime !== null && outputTokens > 0) {
      const elapsed = Date.now() - startTime;
      const tps = tokensPerSecond(outputTokens, elapsed);
      if (tps > 0) {
        recordSpeed(state.recentSpeeds, tps);
        if (config.ux.routerLogVerbose) {
          console.log(
            `[ShiftRouter] ${outputTokens} tokens in ${elapsed}ms = ${tps} tok/s (total ${state.totalOutputTokens.toLocaleString()})`,
          );
        }
      } else if (config.ux.routerLogVerbose) {
        // tokens>0 but elapsed<=0 — defensive log so we can see time-source issues
        console.log(
          `[ShiftRouter] message_end: tokens=${outputTokens} elapsed=${elapsed}ms startTime=${startTime} msgTs=${msg.timestamp}`,
        );
      }
    } else if (config.ux.routerLogVerbose) {
      console.log(
        `[ShiftRouter] message_end: tokens=${outputTokens} startTime=${startTime} usage=${usage ? JSON.stringify(usage) : "undefined"}`,
      );
    }

    // Always reset start time and refresh status bar — guarantees the bar
    // updates even when output_tokens=0 (reasoning-only models, free providers,
    // etc.).
    state.streamingStartTime = null;
    updateBar(ctx.ui, config, state);
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
      state.tierUsage.fast = { calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 };
      state.tierUsage.smart = { calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 };
      state.callLog = [];
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
