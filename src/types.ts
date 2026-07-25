/**
 * Slim Router — Type definitions
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
}

/** Routing behaviour config */
export interface RoutingConfig {
  mode: "auto" | "manual" | "off";
  /** LLM Judge timeout in ms */
  judgeTimeout: number;
  /** Sliding window: downgrade only when ≥threshold fraction of last `size` entries are the lower tier */
  window: { size: number; threshold: number };
}

/** Full SLIM Router configuration */
export interface SlimRouterConfig {
  enabled: boolean;
  tiers: {
    fast: TierConfig;
    smart: TierConfig;
  };
  routing: RoutingConfig;
  ux: UXConfig;
}

/** Default configuration */
export const DEFAULT_CONFIG: SlimRouterConfig = {
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
    window: { size: 5, threshold: 0.6 },
  },
  ux: {
    quietMode: false,
    statusBar: true,
    inlineToast: true,
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
}

/** Auth store shape — maps provider name to API key */
export interface AuthStore {
  [provider: string]: { type: string; key: string };
}

/** Resolved info for making an API call to a provider */
export interface ProviderEndpoint {
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
}
