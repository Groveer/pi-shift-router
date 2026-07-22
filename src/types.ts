/**
 * Smart Router — Type definitions
 */

/** The three routing tiers */
export type Tier = "light" | "medium" | "flagship";

/** All tier labels */
export const TIERS: readonly Tier[] = ["light", "medium", "flagship"] as const;

/** Judge result (tier classification) */
export interface JudgeResult {
  tier: Tier;
  source: "heuristic" | "llm" | "fallback";
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

/** Upgrade policy */
export interface UpgradeConfig {
  immediate: boolean;
}

/** Downgrade policy for a single tier */
export interface DowngradeTierConfig {
  minObservations: number;
  threshold: number;
}

/** Total downgrade policy */
export interface DowngradeConfig {
  flagship: DowngradeTierConfig;
  medium: DowngradeTierConfig;
  maxWindowSize: number;
}

/** Judge configuration */
export interface JudgeConfig {
  provider: string;
  model: string;
  timeout: number;
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
  upgrade: UpgradeConfig;
  downgrade: DowngradeConfig;
}

/** Full SMART Router configuration */
export interface SmartRouterConfig {
  enabled: boolean;
  judge: JudgeConfig;
  tiers: {
    light: TierConfig;
    medium: TierConfig;
    flagship: TierConfig;
  };
  routing: RoutingConfig;
  ux: UXConfig;
}

/** Default configuration */
export const DEFAULT_CONFIG: SmartRouterConfig = {
  enabled: true,
  judge: {
    provider: "auto",
    model: "auto",
    timeout: 5000,
  },
  tiers: {
    light: {
      label: "Lightweight",
      models: [],
      description: "Simple Q&A, confirmations, repetitive tasks",
    },
    medium: {
      label: "Balanced",
      models: [],
      description: "Daily coding, debugging, documentation, analysis",
    },
    flagship: {
      label: "Flagship",
      models: [],
      description: "Architecture, large refactoring, security audit, multi-step reasoning",
    },
  },
  routing: {
    mode: "auto",
    upgrade: { immediate: true },
    downgrade: {
      flagship: { minObservations: 4, threshold: 0.75 },
      medium: { minObservations: 3, threshold: 0.75 },
      maxWindowSize: 10,
    },
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
