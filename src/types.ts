/**
 * pi-shift-router — Type definitions
 *
 * Two-tier routing: Fast (programmer) ↔ Smart (CTO).
 * Fast: execution-heavy tasks, daily coding, following patterns.
 * Smart: judgment-heavy tasks, architecture, planning, code review.
 */

/** The two routing tiers */
export type Tier = "fast" | "smart";

/** All tier labels */
export const TIERS: readonly Tier[] = ["fast", "smart"] as const;

/** Judge result (tier classification) */
export interface JudgeResult {
  tier: Tier;
  source: "llm" | "fallback";
  /**
   * LLM's confidence in the tier classification, in [0, 1].
   * Used by the confidence-weighted sliding window: entries below
   * `window.minConfidence` are ignored; weighted ratio decides downgrade.
   * Defaults to 1.0 when the Judge doesn't emit it (backward-compat).
   */
  confidence?: number;
}

/** A reference to a specific model in a specific provider */
export interface ModelRef {
  provider: string;
  model: string;
  priority: number;
}

/** Configuration for one tier */
export interface TierConfig {
  label: string;
  models: ModelRef[];
  description: string;
}

/** UX configuration */
export interface UXConfig {
  quietMode: boolean;
  statusBar: boolean;
  inlineToast: boolean;
  /** Verbose logging: print router decisions, judge calls, window state to console */
  routerLogVerbose: boolean;
}

/** Routing behaviour config */
export interface RoutingConfig {
  mode: "auto" | "manual" | "off";
  /** LLM Judge timeout in ms */
  judgeTimeout: number;
  /**
   * Sliding window for downgrade gating. Entries whose confidence is
   * below `minConfidence` are ignored. Downgrade fires when
   * `Σ confidence_for_fast / window_size` ≥ `threshold`.
   */
  window: { size: number; threshold: number; minConfidence?: number };
}

/** Full SLIM Router configuration */
export interface ShiftRouterConfig {
  enabled: boolean;
  tiers: {
    fast: TierConfig;
    smart: TierConfig;
  };
  routing: RoutingConfig;
  ux: UXConfig;
}

/** Default configuration */
export const DEFAULT_CONFIG: ShiftRouterConfig = {
  enabled: true,
  tiers: {
    fast: {
      label: "Fast",
      models: [],
      description: "Daily coding, debugging, following patterns — execution mode",
    },
    smart: {
      label: "Smart",
      models: [],
      description: "Architecture, planning, code review, trade-off analysis — judgment mode",
    },
  },
  routing: {
    mode: "auto",
    judgeTimeout: 5000,
    window: { size: 5, threshold: 0.6, minConfidence: 0.5 },
  },
  ux: {
    quietMode: false,
    statusBar: true,
    inlineToast: true,
    routerLogVerbose: false,
  },
};

/** Model entry from models-store.json */
export interface StoredModel {
  id: string;
  name?: string;
  provider: string;
  baseUrl?: string;
  api?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
}

/** models-store.json shape */
export interface ModelsStore {
  [provider: string]: {
    models: StoredModel[];
  };
}

/** Window entry — one Judge result */
export interface WindowEntry {
  tier: Tier;
  timestamp: number;
  /**
   * Confidence of this classification (defaults to 1.0 when missing).
   * Used by the confidence-weighted sliding window.
   */
  confidence?: number;
}

/** Auth store shape — maps provider name to API key */
export interface AuthStore {
  [provider: string]: { type: string; key: string };
}

/** Resolved info for making an API call to a provider */
export interface ProviderEndpoint {
  provider: string;
  baseUrl: string;
  apiType: string;       // "openai-completions" | "anthropic-messages"
  apiKey: string;
  modelId: string;
}

/** Configured tier with resolved model info (for config display) */
export interface TierEntry {
  tier: Tier;
  label: string;
  description: string;
  models: Array<{ provider: string; model: string }>;
}

import type { CooldownMap } from "./failover.js";

/** Router internal state */
export interface RouterState {
  currentTier: Tier;
  currentModelId: string | null;
  currentProvider: string | null;
  window: WindowEntry[];
  manualOverride: {
    active: boolean;
    tier?: Tier;
    modelId?: string;
    provider?: string;
  };
  /** Models in exponential-backoff cooldown after runtime failure (SPEC §8.5) */
  modelCooldowns: CooldownMap;
  /** Cumulative output tokens across the session (from AssistantMessage.usage.output). */
  totalOutputTokens: number;
  /** Sliding window of recent tokens-per-second readings (for `/router stats`). */
  recentSpeeds: number[];
  /** Epoch ms when the current in-flight assistant message started streaming; null when none. */
  streamingStartTime: number | null;
  /** Cumulative count of fast→smart tier transitions. */
  upgradeCount: number;
  /** Cumulative count of smart→fast tier transitions. */
  downgradeCount: number;
}
