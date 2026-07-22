/**
 * Smart Router — Routing engine
 *
 * Core logic: sliding window trend detection, upgrade/downgrade decisions,
 * model switching via pi.setModel().
 */

import type { SmartRouterConfig, Tier, WindowEntry, RouterState, JudgeResult } from "./types.js";
import { TIERS } from "./types.js";
import { findBestModelForTier, type ResolvedModel } from "./tier.js";

/** Create an initial RouterState */
export function createRouterState(): RouterState {
  return {
    currentTier: "medium",
    currentModelId: null,
    currentProvider: null,
    window: [],
    manualOverride: { active: false },
  };
}

function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

function shouldUpgrade(current: Tier, target: Tier): boolean {
  return tierIndex(target) > tierIndex(current);
}

function analyzeDowngrade(
  window: WindowEntry[],
  currentTier: Tier,
  config: SmartRouterConfig,
): { shouldDowngrade: boolean; targetTier: Tier | null } {
  const dc = config.routing.downgrade;
  if (window.length === 0) return { shouldDowngrade: false, targetTier: null };

  const counts: Record<Tier, number> = { light: 0, medium: 0, flagship: 0 };
  const relevant = window.slice(-Math.min(window.length, dc.maxWindowSize));
  for (const e of relevant) counts[e.tier]++;

  if (currentTier === "flagship") {
    const cfg = dc.flagship;
    if (relevant.length >= cfg.minObservations) {
      const mr = counts.medium / relevant.length;
      if (mr >= cfg.threshold) return { shouldDowngrade: true, targetTier: "medium" };
      const lr = counts.light / relevant.length;
      if (lr >= cfg.threshold) return { shouldDowngrade: true, targetTier: "light" };
    }
  } else if (currentTier === "medium") {
    const cfg = dc.medium;
    if (relevant.length >= cfg.minObservations) {
      const lr = counts.light / relevant.length;
      if (lr >= cfg.threshold) return { shouldDowngrade: true, targetTier: "light" };
    }
  }
  return { shouldDowngrade: false, targetTier: null };
}

function cleanWindowOnUpgrade(window: WindowEntry[], newTier: Tier): WindowEntry[] {
  const idx = tierIndex(newTier);
  return window.filter((e) => tierIndex(e.tier) >= idx);
}

export type RouteAction = "upgrade" | "downgrade" | "stay" | "manual";

export interface RouteDecision {
  switchTo: ResolvedModel | null;
  action: RouteAction;
}

/**
 * Apply a new judge result and determine the next action.
 */
export function processRoute(
  judgeResult: JudgeResult,
  state: RouterState,
  config: SmartRouterConfig,
  modelRegistry: { find: (p: string, m: string) => unknown } | undefined,
): RouteDecision {
  if (state.manualOverride.active) {
    if (state.manualOverride.modelId && state.manualOverride.provider) {
      return {
        switchTo: { provider: state.manualOverride.provider, modelId: state.manualOverride.modelId, tier: state.manualOverride.tier ?? judgeResult.tier },
        action: "manual",
      };
    }
    if (state.manualOverride.tier) {
      const m = findBestModelForTier(state.manualOverride.tier, config, modelRegistry);
      if (m) return { switchTo: m, action: "manual" };
    }
  }

  const currentTier = state.currentTier;
  const targetTier = judgeResult.tier;

  if (config.routing.upgrade.immediate && shouldUpgrade(currentTier, targetTier)) {
    const m = findBestModelForTier(targetTier, config, modelRegistry);
    if (m) {
      state.window = cleanWindowOnUpgrade(state.window, targetTier);
      return { switchTo: m, action: "upgrade" };
    }
  }

  state.window.push({ tier: targetTier, timestamp: Date.now() });

  const down = analyzeDowngrade(state.window, currentTier, config);
  if (down.shouldDowngrade && down.targetTier) {
    const m = findBestModelForTier(down.targetTier, config, modelRegistry);
    if (m) return { switchTo: m, action: "downgrade" };
  }

  return { switchTo: null, action: "stay" };
}

/**
 * Apply model switch: find model in registry, then call pi.setModel().
 */
export async function applyModelSwitch(
  resolved: ResolvedModel,
  state: RouterState,
  modelRegistry: { find: (p: string, m: string) => unknown } | undefined,
  setModel: (m: unknown) => Promise<boolean>,
): Promise<boolean> {
  try {
    const model = modelRegistry?.find?.(resolved.provider, resolved.modelId);
    if (!model) {
      console.warn(`[SmartRouter] Model not found: ${resolved.provider}/${resolved.modelId}`);
      return false;
    }
    const ok = await setModel(model);
    if (ok) {
      state.currentTier = resolved.tier;
      state.currentModelId = resolved.modelId;
      state.currentProvider = resolved.provider;
    }
    return ok;
  } catch (err) {
    console.warn(`[SmartRouter] Model switch failed: ${err}`);
    return false;
  }
}

export function clearManualOverride(state: RouterState): void {
  state.manualOverride = { active: false };
}

export function setManualOverrideTier(state: RouterState, tier: Tier): void {
  state.manualOverride = { active: true, tier };
}

export function setManualOverrideModel(state: RouterState, provider: string, modelId: string): void {
  state.manualOverride = { active: true, provider, modelId };
}
