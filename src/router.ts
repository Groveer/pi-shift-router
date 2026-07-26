/**
 * pi-shift-router — Routing engine
 *
 * Two-tier sliding window trend detection:
 *   - Upgrade (fast → smart): immediate
 *   - Downgrade (smart → fast): requires window majority
 */

import type { ShiftRouterConfig, Tier, WindowEntry, RouterState, JudgeResult } from "./types.js";
import { TIERS } from "./types.js";
import { findBestModelForTier, type ResolvedModel } from "./tier.js";

/** Create an initial RouterState */
export function createRouterState(): RouterState {
  return {
    currentTier: "fast",
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
  config: ShiftRouterConfig,
): { shouldDowngrade: boolean; targetTier: Tier | null } {
  // Can't downgrade further from fast
  if (currentTier !== "smart") return { shouldDowngrade: false, targetTier: null };

  const { size, threshold } = config.routing.window;
  if (window.length === 0) return { shouldDowngrade: false, targetTier: null };

  const relevant = window.slice(-Math.min(window.length, size));
  const fastCount = relevant.filter((e) => e.tier === "fast").length;
  const ratio = fastCount / relevant.length;

  if (ratio >= threshold) {
    return { shouldDowngrade: true, targetTier: "fast" };
  }

  return { shouldDowngrade: false, targetTier: null };
}

/**
 * Core routing decision:
 * 1. Manual override → use forced model
 * 2. Judge says "smart" and current is "fast" → immediate upgrade
 * 3. Otherwise → analyze window for possible downgrade
 * 4. Push judge result to window (capped)
 */
export function processRoute(
  judgeResult: JudgeResult,
  state: RouterState,
  config: ShiftRouterConfig,
  modelRegistry: { find: (p: string, m: string) => unknown } | undefined,
): RouteDecision {
  const { tier: targetTier } = judgeResult;

  // 1. Manual override
  if (state.manualOverride.active) {
    if (state.manualOverride.modelId && state.manualOverride.provider) {
      return {
        switchTo: {
          provider: state.manualOverride.provider,
          modelId: state.manualOverride.modelId,
          tier: state.manualOverride.tier ?? targetTier,
        },
        action: "manual",
      };
    }
    if (state.manualOverride.tier) {
      const m = findBestModelForTier(state.manualOverride.tier, config, modelRegistry);
      if (m) return { switchTo: m, action: "manual" };
    }
  }

  // 2. Immediate upgrade: fast → smart
  if (shouldUpgrade(state.currentTier, targetTier)) {
    const m = findBestModelForTier(targetTier, config, modelRegistry);
    if (m) {
      // Clear window on upgrade (fresh start for the new tier)
      state.window = [];
      return { switchTo: m, action: "upgrade" };
    }
  }

  // 3. Push current judgment to window
  state.window.push({ tier: targetTier, timestamp: Date.now() });

  // Cap window
  const maxSize = config.routing.window.size;
  if (state.window.length > maxSize) {
    state.window = state.window.slice(-maxSize);
  }

  // 4. Check downgrade
  const down = analyzeDowngrade(state.window, state.currentTier, config);
  if (down.shouldDowngrade && down.targetTier) {
    const m = findBestModelForTier(down.targetTier, config, modelRegistry);
    if (m) return { switchTo: m, action: "downgrade" };
  }

  return { switchTo: null, action: "stay" };
}

export interface RouteDecision {
  switchTo: ResolvedModel | null;
  action: "upgrade" | "downgrade" | "stay" | "manual";
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
      console.warn(`[ShiftRouter] Model not found: ${resolved.provider}/${resolved.modelId}`);
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
    console.warn(`[ShiftRouter] Model switch failed: ${err}`);
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
