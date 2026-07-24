/**
 * Slim Router — Tier management
 *
 * Handles model lookup across tiers, priority-based fallback,
 * and integration with pi's model registry.
 */

import type { SmartRouterConfig, Tier } from "./types.js";
import { TIERS } from "./types.js";

/** Resolved model info with its tier */
export interface ResolvedModel {
  provider: string;
  modelId: string;
  tier: Tier;
}

/**
 * Find the best available model for a given tier.
 * Searches pi's model registry by provider + model id, falls back by priority.
 */
export function findBestModelForTier(
  tier: Tier,
  config: SmartRouterConfig,
  modelRegistry: { find: (provider: string, modelId: string) => unknown } | undefined,
): ResolvedModel | null {
  const tierConfig = config.tiers[tier];
  if (!tierConfig?.models?.length || !modelRegistry?.find) return null;

  const sorted = [...tierConfig.models].sort((a, b) => a.priority - b.priority);

  for (const ref of sorted) {
    try {
      if (modelRegistry.find(ref.provider, ref.model)) {
        return { provider: ref.provider, modelId: ref.model, tier };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** Check if a tier is valid */
export function isValidTier(s: string): s is Tier {
  return TIERS.includes(s as Tier);
}

/** Get display label for a tier */
export function tierLabel(tier: Tier, config: SmartRouterConfig): string {
  const cfg = config.tiers[tier];
  return cfg?.label ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** Get emoji for a tier */
export function tierEmoji(tier: Tier): string {
  switch (tier) {
    case "flagship":
      return "🧠";
    case "medium":
      return "🦾";
    case "light":
      return "⚡";
  }
}

/** Format tier for status bar: "[🚀 kimi-k3]" */
export function formatTierDisplay(
  tier: Tier | null,
  modelId: string | null,
): string {
  if (!tier) return "";
  const emoji = tierEmoji(tier);
  const model = modelId?.split("/").pop() ?? "…";
  return `[${emoji} ${model}]`;
}
