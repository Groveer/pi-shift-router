/**
 * Smart Router — Routing engine
 *
 * Core logic: sliding window trend detection, upgrade/downgrade decisions,
 * model switching via pi.setModel().
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SmartRouterConfig, Tier, WindowEntry, RouterState, JudgeResult } from "./types.js";
import { TIERS } from "./types.js";
import { findBestModelForTier, type ResolvedModel } from "./tier.js";

/** Create an initial RouterState */
export function createRouterState(): RouterState {
  return {
    currentTier: "medium", // default starting tier
    currentModelId: null,
    currentProvider: null,
    window: [],
    manualOverride: { active: false },
  };
}

/** Get the tier index (0=light, 1=medium, 2=flagship) */
function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** Determine if upgrade is needed (target tier is higher) */
function shouldUpgrade(current: Tier, target: Tier): boolean {
  return tierIndex(target) > tierIndex(current);
}

/** Determine the downgrade decision based on window analysis */
function analyzeDowngrade(
  window: WindowEntry[],
  currentTier: Tier,
  config: SmartRouterConfig,
): { shouldDowngrade: boolean; targetTier: Tier | null } {
  const downgradeCfg = config.routing.downgrade;
  if (window.length === 0) {
    return { shouldDowngrade: false, targetTier: null };
  }

  // Compute counts for each tier in the window
  const counts: Record<Tier, number> = { light: 0, medium: 0, flagship: 0 };
  const total = Math.min(window.length, downgradeCfg.maxWindowSize);

  // Only consider the most recent entries up to maxWindowSize
  const relevant = window.slice(-total);
  for (const entry of relevant) {
    counts[entry.tier]++;
  }

  if (currentTier === "flagship") {
    const cfg = downgradeCfg.flagship;
    if (relevant.length >= cfg.minObservations) {
      // Check medium threshold
      const mediumRatio = counts.medium / relevant.length;
      if (mediumRatio >= cfg.threshold) {
        return { shouldDowngrade: true, targetTier: "medium" };
      }
      // Check light threshold
      const lightRatio = counts.light / relevant.length;
      if (lightRatio >= cfg.threshold) {
        // Direct downgrade to light, skip medium (per SPEC §3.2)
        return { shouldDowngrade: true, targetTier: "light" };
      }
    }
  } else if (currentTier === "medium") {
    const cfg = downgradeCfg.medium;
    if (relevant.length >= cfg.minObservations) {
      const lightRatio = counts.light / relevant.length;
      if (lightRatio >= cfg.threshold) {
        return { shouldDowngrade: true, targetTier: "light" };
      }
    }
  }

  // light tier doesn't downgrade further
  return { shouldDowngrade: false, targetTier: null };
}

/** Clean the window on upgrade: keep only entries at the new tier or higher */
function cleanWindowOnUpgrade(window: WindowEntry[], newTier: Tier): WindowEntry[] {
  const newIdx = tierIndex(newTier);
  return window.filter((e) => tierIndex(e.tier) >= newIdx);
}

export type RouteAction = "upgrade" | "downgrade" | "stay" | "manual";

export interface RouteDecision {
  switchTo: ResolvedModel | null;
  action: RouteAction;
}

/**
 * Apply a new judge result to the router state and determine the next action.
 */
export function processRoute(
  judgeResult: JudgeResult,
  state: RouterState,
  config: SmartRouterConfig,
  pi: ExtensionAPI,
): RouteDecision {
  // ── Check manual override first ──
  if (state.manualOverride.active) {
    if (state.manualOverride.modelId && state.manualOverride.provider) {
      return {
        switchTo: {
          provider: state.manualOverride.provider,
          modelId: state.manualOverride.modelId,
          tier: state.manualOverride.tier ?? judgeResult.tier,
        },
        action: "manual",
      };
    }
    if (state.manualOverride.tier) {
      const model = findBestModelForTier(state.manualOverride.tier, config, pi);
      if (model) return { switchTo: model, action: "manual" };
    }
  }

  const currentTier = state.currentTier;
  const targetTier = judgeResult.tier;

  // ── Upgrade check (immediate) ──
  if (config.routing.upgrade.immediate && shouldUpgrade(currentTier, targetTier)) {
    const model = findBestModelForTier(targetTier, config, pi);
    if (model) {
      state.window = cleanWindowOnUpgrade(state.window, targetTier);
      return { switchTo: model, action: "upgrade" };
    }
  }

  // ── Accumulate window entry ──
  state.window.push({ tier: targetTier, timestamp: Date.now() });

  // ── Downgrade check ──
  const downgrade = analyzeDowngrade(state.window, currentTier, config);
  if (downgrade.shouldDowngrade && downgrade.targetTier) {
    const model = findBestModelForTier(downgrade.targetTier, config, pi);
    if (model) return { switchTo: model, action: "downgrade" };
  }

  return { switchTo: null, action: "stay" };
}

/**
 * Apply model switch using pi.setModel()
 */
export async function applyModelSwitch(
  resolved: ResolvedModel,
  state: RouterState,
  pi: ExtensionAPI,
): Promise<boolean> {
  try {
    const model = (pi as any).modelRegistry?.find?.(resolved.provider, resolved.modelId);
    if (!model) {
      console.warn(`[SmartRouter] Model not found: ${resolved.provider}/${resolved.modelId}`);
      return false;
    }

    const success = await pi.setModel(model);
    if (success) {
      state.currentTier = resolved.tier;
      state.currentModelId = resolved.modelId;
      state.currentProvider = resolved.provider;
    }
    return success;
  } catch (err) {
    console.warn(`[SmartRouter] Failed to switch model: ${err}`);
    return false;
  }
}

/** Clear manual override */
export function clearManualOverride(state: RouterState): void {
  state.manualOverride = { active: false };
}

/** Set manual override to a specific tier */
export function setManualOverrideTier(state: RouterState, tier: Tier): void {
  state.manualOverride = { active: true, tier };
}

/** Set manual override to a specific model */
export function setManualOverrideModel(state: RouterState, provider: string, modelId: string): void {
  state.manualOverride = { active: true, provider, modelId };
}
