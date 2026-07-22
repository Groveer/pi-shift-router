/**
 * Smart Router — Tier management
 *
 * Handles model lookup across tiers, priority-based fallback,
 * and integration with pi's model registry.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SmartRouterConfig, Tier, ModelRef } from "./types.js";
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
  pi: ExtensionAPI,
): ResolvedModel | null {
  const tierConfig = config.tiers[tier];
  if (!tierConfig?.models?.length) return null;

  const sorted = [...tierConfig.models].sort((a, b) => a.priority - b.priority);
  const registry = (pi as any).modelRegistry;
  if (!registry?.find) return null;

  for (const ref of sorted) {
    try {
      if (registry.find(ref.provider, ref.model)) {
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
      return "🚀";
    case "medium":
      return "🟡";
    case "light":
      return "⚡";
  }
}

/** Get short badge for status bar */
export function tierBadge(tier: Tier): string {
  switch (tier) {
    case "flagship":
      return "F";
    case "medium":
      return "M";
    case "light":
      return "L";
  }
}

/** Format tier info for display: "🚀 F:model-name" */
export function formatTierDisplay(
  tier: Tier,
  modelId: string | null,
  provider: string | null,
): string {
  const emoji = tierEmoji(tier);
  const badge = tierBadge(tier);
  const model = modelId ? modelId.split("/").pop() ?? modelId : "?";
  const prov = provider ? provider.split("/").pop() ?? provider : "";
  return `${emoji} ${badge}:${model}${prov ? `(${prov})` : ""}`;
}
