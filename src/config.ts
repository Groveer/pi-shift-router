/**
 * Slim Router — Configuration loader
 *
 * Reads pi-agent's models-store.json and auth.json, resolves Judge endpoint,
 * and manages the pi-slim-router.json config file (user-level + project-level).
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import {
  type SlimRouterConfig,
  type ModelsStore,
  type AuthStore,
  type StoredModel,
  type ProviderEndpoint,
  DEFAULT_CONFIG,
  TIERS,
} from "./types.js";

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const CONFIG_FILENAME = "pi-slim-router.json";

let _config: SlimRouterConfig | null = null;
let _modelsStore: ModelsStore | null = null;
let _authStore: AuthStore | null = null;
let _configPath: string | null = null;

// ─── Paths ────────────────────────────────────────────────────────

/** User-level config: ~/.pi/agent/pi-slim-router.json (personal preferences) */
export function userConfigPath(): string {
  return join(PI_AGENT_DIR, CONFIG_FILENAME);
}

/** Project-level config: <cwd>/.pi/pi-slim-router.json (team-shared, git-tracked) */
export function projectConfigPath(cwd: string): string {
  return resolve(cwd, ".pi", CONFIG_FILENAME);
}

/** Active config path. Project takes precedence. */
export function getConfigPath(): string | null {
  return _configPath;
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

// ─── Pi-agent shared stores ───────────────────────────────────────

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

/** Get all models from the store as a flat array. Used by the config wizard. */
export function flattenModels(store: ModelsStore): StoredModel[] {
  const models: StoredModel[] = [];
  for (const [provider, entry] of Object.entries(store)) {
    for (const model of entry.models) {
      models.push({ ...model, provider });
    }
  }
  return models;
}

/** Invalidate all caches. Call after config edit. */
export function invalidateConfigCache(): void {
  _config = null;
  _configPath = null;
  // Note: _modelsStore and _authStore are not invalidated — they reflect
  // pi-agent's own state, which we don't own.
}

// ─── Judge endpoint resolution ────────────────────────────────────

/**
 * Resolve endpoint info for the judge model.
 * Order:
 *   1. light tier's first model (user chose this as the cheap/fast option)
 *   2. cheapest model with valid auth (fallback)
 */
export async function resolveJudgeEndpoint(config: SlimRouterConfig): Promise<ProviderEndpoint | null> {
  const store = await loadModelsStore();
  const auth = await loadAuthStore();

  async function resolve(provider: string, modelId: string): Promise<ProviderEndpoint | null> {
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

  // 1. Use light tier's first model as judge
  const lightFirst = config.tiers.light.models[0];
  if (lightFirst) {
    const ep = await resolve(lightFirst.provider, lightFirst.model);
    if (ep) return ep;
  }

  // 2. Fallback: cheapest model with auth
  const candidates: Array<{ provider: string; modelId: string; cost: number }> = [];
  for (const [prov, entry] of Object.entries(store)) {
    if (!auth[prov]?.key) continue;
    for (const m of entry.models) {
      const cost = m.cost?.input ?? Number.MAX_SAFE_INTEGER;
      if (cost >= 0) candidates.push({ provider: prov, modelId: m.id, cost });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  if (candidates.length === 0) return null;
  return resolve(candidates[0].provider, candidates[0].modelId);
}

// ─── Config persistence ────────────────────────────────────────────

/**
 * Save config to a specific path (user or project).
 * @param scope "user" → ~/.pi/agent/, "project" → <cwd>/.pi/
 */
export async function saveConfig(
  config: SlimRouterConfig,
  cwd: string,
  scope: "user" | "project" = "project",
): Promise<boolean> {
  const configPath = scope === "user" ? userConfigPath() : projectConfigPath(cwd);
  try {
    const dir = dirname(configPath);
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    invalidateConfigCache();
    _configPath = configPath;
    return true;
  } catch (err) {
    console.warn(`[SlimRouter] Failed to save config: ${err}`);
    return false;
  }
}

// ─── Config validation (SPEC §5.4) ────────────────────────────────

/**
 * Validate that referenced models exist in the store.
 * Returns warnings (non-fatal): tier without models, missing provider/model, duplicates.
 */
export function validateConfig(config: SlimRouterConfig, store: ModelsStore): string[] {
  const warnings: string[] = [];
  const seenRefs = new Map<string, string>(); // key → tier

  for (const tier of TIERS) {
    const cfg = config.tiers[tier];
    if (!cfg.models || cfg.models.length === 0) continue; // empty tier is OK
    for (const ref of cfg.models) {
      const key = `${ref.provider}/${ref.model}`;
      const providerModels = store[ref.provider];
      if (!providerModels) {
        warnings.push(`Provider "${ref.provider}" not found (tier "${tier}")`);
        continue;
      }
      const exists = providerModels.models.some((m) => m.id === ref.model);
      if (!exists) {
        warnings.push(`Model "${ref.model}" not found in provider "${ref.provider}" (tier "${tier}")`);
        continue;
      }
      // Track duplicate model references across tiers (informational)
      const prevTier = seenRefs.get(key);
      if (prevTier) {
        warnings.push(`Model "${key}" appears in both "${prevTier}" and "${tier}" — tier routing becomes a no-op`);
      } else {
        seenRefs.set(key, tier);
      }
    }
  }

  return warnings;
}

// ─── Config loading (user → project merge) ────────────────────────

/**
 * Load configuration with caching.
 * Layering:
 *   1. User config (~/.pi/agent/pi-slim-router.json) — personal defaults
 *   2. Project config (<cwd>/.pi/pi-slim-router.json) — team-shared overrides
 * Project wins on conflict (deep merge with project taking precedence).
 */
export async function loadConfig(cwd: string): Promise<SlimRouterConfig> {
  if (_config) return _config;

  const userPath = userConfigPath();
  const projectPath = projectConfigPath(cwd);

  // Read both layers
  const userCfg = await readJsonPartial(userPath);
  const projectCfg = await readJsonPartial(projectPath);

  // Merge: defaults ← user ← project (project wins)
  const merged: SlimRouterConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  deepMerge(merged as unknown as Record<string, unknown>, userCfg);
  deepMerge(merged as unknown as Record<string, unknown>, projectCfg);
  _config = merged;

  // Track which path is authoritative (project if exists, else user if exists)
  _configPath = (await fileExists(projectPath)) ? projectPath
              : (await fileExists(userPath))   ? userPath
              : projectPath; // default write target

  // Validate and warn (non-fatal)
  try {
    const store = await loadModelsStore();
    const warnings = validateConfig(merged, store);
    if (warnings.length > 0) {
      console.warn(`[SlimRouter] Config warnings:\n  ${warnings.join("\n  ")}`);
    }
  } catch {
    // Validation failure should never block startup
  }

  return merged;
}

/** Read partial JSON; tolerate missing files, malformed JSON, etc. */
async function readJsonPartial(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Deep merge: target gets all values from source (plain objects only, arrays replaced). */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(source)) {
    if (val === undefined) continue;
    const targetVal = target[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      deepMerge(targetVal as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      target[key] = val;
    }
  }
}