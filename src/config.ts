/**
 * Smart Router — Configuration loader
 *
 * Reads pi-agent's models-store.json and auth.json, auto-assigns models
 * to tiers, and manages the smartrouter.json config file.
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import {
  type SmartRouterConfig,
  type ModelsStore,
  type AuthStore,
  type StoredModel,
  type ProviderEndpoint,
  DEFAULT_CONFIG,
  TIERS,
} from "./types.js";

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const CONFIG_FILENAME = "smartrouter.json";

let _config: SmartRouterConfig | null = null;
let _modelsStore: ModelsStore | null = null;
let _authStore: AuthStore | null = null;
let _configPath: string | null = null;

/** Resolve config file path: project-local > user-global */
function resolveConfigPath(cwd: string): string {
  // Check project-local first
  const projectPath = resolve(cwd, ".pi", CONFIG_FILENAME);
  return projectPath;
}

/** Check if a file exists */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Load models-store.json */
export async function loadModelsStore(): Promise<ModelsStore> {
  if (_modelsStore) return _modelsStore;
  const storePath = join(PI_AGENT_DIR, "models-store.json");
  try {
    const raw = await readFile(storePath, "utf-8");
    _modelsStore = JSON.parse(raw) as ModelsStore;
    return _modelsStore;
  } catch {
    return {};
  }
}

/** Load auth.json */
export async function loadAuthStore(): Promise<AuthStore> {
  if (_authStore) return _authStore;
  const authPath = join(PI_AGENT_DIR, "auth.json");
  try {
    const raw = await readFile(authPath, "utf-8");
    _authStore = JSON.parse(raw) as AuthStore;
    return _authStore;
  } catch {
    return {};
  }
}

/** Get all models from the store as a flat array */
export function flattenModels(store: ModelsStore): StoredModel[] {
  const models: StoredModel[] = [];
  for (const [provider, entry] of Object.entries(store)) {
    for (const model of entry.models) {
      models.push({ ...model, provider });
    }
  }
  return models;
}

/** Auto-assign models to tiers based on cost */
export function autoAssignTiers(models: StoredModel[]): {
  light: StoredModel[];
  medium: StoredModel[];
  flagship: StoredModel[];
} {
  // Filter models that have valid cost data
  const priced = models.filter((m) => m.cost && m.cost.input > 0);
  if (priced.length === 0) {
    return { light: [], medium: [], flagship: [] };
  }

  // Sort by input cost ascending
  const sorted = [...priced].sort((a, b) => (a.cost?.input ?? 0) - (b.cost?.input ?? 0));

  const total = sorted.length;
  const split1 = Math.max(1, Math.floor(total * 0.3));
  const split2 = Math.max(split1 + 1, Math.floor(total * 0.6));

  return {
    light: sorted.slice(0, split1),
    medium: sorted.slice(split1, split2),
    flagship: sorted.slice(split2),
  };
}

/** Convert a StoredModel array to ModelRef array */
export function modelRefsFromModels(
  models: StoredModel[],
  priorityBase = 1,
): Array<{ provider: string; model: string; priority: number }> {
  // Deduplicate by provider+model
  const seen = new Set<string>();
  const refs: Array<{ provider: string; model: string; priority: number }> = [];

  for (const m of models) {
    const key = `${m.provider}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ provider: m.provider, model: m.id, priority: priorityBase + refs.length });
  }

  return refs;
}

/** Build a full SmartRouterConfig, auto-assigning tiers if needed */
async function buildConfig(cwd: string): Promise<SmartRouterConfig> {
  const store = await loadModelsStore();
  const allModels = flattenModels(store);
  const assigned = autoAssignTiers(allModels);

  const config: SmartRouterConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Auto-assign model references
  config.tiers.light.models = modelRefsFromModels(assigned.light, 1);
  config.tiers.medium.models = modelRefsFromModels(assigned.medium, 10);
  config.tiers.flagship.models = modelRefsFromModels(assigned.flagship, 20);

  return config;
}

/**
 * Resolve endpoint info for the judge model.
 * If "auto", picks the cheapest available model.
 */
export async function resolveJudgeEndpoint(config: SmartRouterConfig): Promise<ProviderEndpoint | null> {
  const store = await loadModelsStore();
  const auth = await loadAuthStore();

  let provider = config.judge.provider;
  let modelId = config.judge.model;

  // Auto-detect: pick cheapest model with auth
  if (provider === "auto" || modelId === "auto") {
    const candidates: Array<{ provider: string; model: StoredModel; cost: number }> = [];
    for (const [prov, entry] of Object.entries(store)) {
      if (!auth[prov]?.key) continue;
      for (const m of entry.models) {
        const cost = m.cost?.input ?? 999;
        if (cost > 0) candidates.push({ provider: prov, model: m, cost });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    if (candidates.length === 0) return null;
    provider = candidates[0].provider;
    modelId = candidates[0].model.id;
  }

  const provEntry = store[provider];
  if (!provEntry) return null;
  const modelInfo = provEntry.models.find((m) => m.id === modelId);
  if (!modelInfo) return null;
  const apiKey = auth[provider]?.key;
  if (!apiKey) return null;

  return {
    baseUrl: modelInfo.baseUrl ?? "",
    apiType: modelInfo.api ?? "openai-completions",
    apiKey,
    modelId,
  };
}

/** Save config to file */
export async function saveConfig(config: SmartRouterConfig, cwd: string): Promise<boolean> {
  const configPath = _configPath ?? resolve(cwd, ".pi", CONFIG_FILENAME);
  try {
    const dir = dirname(configPath);
    await access(dir).catch(() => {}); // ignore if dir missing
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    _configPath = configPath;
    return true;
  } catch {
    return false;
  }
}

/** Validate that referenced models exist in the store */
export function validateConfig(config: SmartRouterConfig, store: ModelsStore): string[] {
  const errors: string[] = [];

  for (const tier of TIERS) {
    const cfg = config.tiers[tier];
    if (!cfg.models || cfg.models.length === 0) {
      errors.push(`Tier "${tier}" has no models configured`);
      continue;
    }
    for (const ref of cfg.models) {
      const providerModels = store[ref.provider];
      if (!providerModels) {
        errors.push(`Provider "${ref.provider}" not found (referenced in tier "${tier}")`);
        continue;
      }
      const exists = providerModels.models.some((m) => m.id === ref.model);
      if (!exists) {
        errors.push(`Model "${ref.model}" not found in provider "${ref.provider}" (tier "${tier}")`);
      }
    }
  }

  return errors;
}

/** Load configuration with caching */
export async function loadConfig(cwd: string): Promise<SmartRouterConfig> {
  if (_config) return _config;

  // Resolve config file path
  const configPath = resolveConfigPath(cwd);
  _configPath = configPath;

  const exists = await fileExists(configPath);

  if (exists) {
    try {
      const raw = await readFile(configPath, "utf-8");
      const userConfig = JSON.parse(raw) as Partial<SmartRouterConfig>;
      // Merge with defaults
      const merged: SmartRouterConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      deepMerge(merged, userConfig);
      _config = merged;

      // Validate
      const store = await loadModelsStore();
      const errors = validateConfig(merged, store);
      if (errors.length > 0) {
        console.warn(`[SmartRouter] Config validation warnings:\n  ${errors.join("\n  ")}`);
      }

      return merged;
    } catch (err) {
      console.warn(`[SmartRouter] Failed to parse config, using defaults: ${err}`);
      // Fall through to auto-build
    }
  }

  // No config file: auto-build and save
  _config = await buildConfig(cwd);

  // Auto-save the generated config for user reference
  try {
    const dir = dirname(configPath);
    await access(dir);
    await writeFile(configPath, JSON.stringify(_config, null, 2), "utf-8");
    console.log(`[SmartRouter] Auto-generated config saved to ${configPath}`);
  } catch {
    // Project .pi dir may not exist, that's fine
  }

  return _config;
}

/** Deep merge: target gets all values from source (only plain objects, not arrays) */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else if (val !== undefined) {
      target[key] = val;
    }
  }
}

/** Invalidate config cache (for reload) */
export function invalidateConfigCache(): void {
  _config = null;
  _modelsStore = null;
}

/** Get the config file path (after loadConfig was called) */
export function getConfigPath(): string | null {
  return _configPath;
}
