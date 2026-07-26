/**
 * Slim Router — Configuration tests
 *
 * Pure-function tests for validateConfig() and flattenModels().
 * File-IO functions (loadConfig, saveConfig) are not tested here —
 * they require filesystem mocks which are out of scope for unit tests.
 */

import { describe, it, expect } from "vitest";
import { validateConfig, flattenModels } from "../src/config.js";
import { DEFAULT_CONFIG, type ModelsStore, type SlimRouterConfig, type StoredModel } from "../src/types.js";

function makeStore(): ModelsStore {
  return {
    deepseek: { models: [
      { id: "deepseek-v4-flash", provider: "deepseek" },
      { id: "deepseek-v4-pro", provider: "deepseek" },
    ] as StoredModel[] },
    kimi: { models: [
      { id: "kimi-k3", provider: "kimi" },
    ] as StoredModel[] },
  };
}

// ─── flattenModels ──────────────────────────────────────────────────
describe("flattenModels", () => {
  it("flattens a multi-provider store into a single array", () => {
    const flat = flattenModels(makeStore());
    const ids = flat.map((m) => m.id);
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("kimi-k3");
    expect(flat.length).toBe(3);
  });

  it("injects the provider name into each model", () => {
    const flat = flattenModels(makeStore());
    for (const m of flat) {
      expect(typeof m.provider).toBe("string");
      expect(m.provider.length).toBeGreaterThan(0);
    }
    expect(flat.find((m) => m.id === "kimi-k3")?.provider).toBe("kimi");
  });

  it("returns empty array for empty store", () => {
    expect(flattenModels({})).toEqual([]);
  });

  it("skips providers with empty models array", () => {
    const flat = flattenModels({
      empty: { models: [] },
      deepseek: { models: [{ id: "x", provider: "deepseek" } as StoredModel] },
    });
    expect(flat.length).toBe(1);
    expect(flat[0]?.id).toBe("x");
  });
});

// ─── validateConfig ─────────────────────────────────────────────────
describe("validateConfig", () => {
  it("returns no warnings when all referenced models exist", () => {
    const cfg: SlimRouterConfig = {
      ...DEFAULT_CONFIG,
      tiers: {
        fast: {
          ...DEFAULT_CONFIG.tiers.fast,
          models: [{ provider: "deepseek", model: "deepseek-v4-flash", priority: 1 }],
        },
        smart: {
          ...DEFAULT_CONFIG.tiers.smart,
          models: [{ provider: "kimi", model: "kimi-k3", priority: 1 }],
        },
      },
    };
    expect(validateConfig(cfg, makeStore())).toEqual([]);
  });

  it("no warnings when tiers are empty (default state)", () => {
    expect(validateConfig(DEFAULT_CONFIG, makeStore())).toEqual([]);
  });

  it("warns when a provider is not in the store", () => {
    const cfg: SlimRouterConfig = {
      ...DEFAULT_CONFIG,
      tiers: {
        fast: {
          ...DEFAULT_CONFIG.tiers.fast,
          models: [{ provider: "unknown-provider", model: "x", priority: 1 }],
        },
        smart: { ...DEFAULT_CONFIG.tiers.smart, models: [] },
      },
    };
    const warnings = validateConfig(cfg, makeStore());
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/unknown-provider/);
    expect(warnings[0]).toMatch(/fast/);
  });

  it("warns when a model is not in the provider", () => {
    const cfg: SlimRouterConfig = {
      ...DEFAULT_CONFIG,
      tiers: {
        fast: {
          ...DEFAULT_CONFIG.tiers.fast,
          models: [{ provider: "deepseek", model: "nonexistent-model", priority: 1 }],
        },
        smart: { ...DEFAULT_CONFIG.tiers.smart, models: [] },
      },
    };
    const warnings = validateConfig(cfg, makeStore());
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/nonexistent-model/);
    expect(warnings[0]).toMatch(/deepseek/);
  });

  it("warns when same model appears in both tiers (routing becomes no-op)", () => {
    const cfg: SlimRouterConfig = {
      ...DEFAULT_CONFIG,
      tiers: {
        fast: {
          ...DEFAULT_CONFIG.tiers.fast,
          models: [{ provider: "deepseek", model: "deepseek-v4-flash", priority: 1 }],
        },
        smart: {
          ...DEFAULT_CONFIG.tiers.smart,
          models: [{ provider: "deepseek", model: "deepseek-v4-flash", priority: 1 }],
        },
      },
    };
    const warnings = validateConfig(cfg, makeStore());
    expect(warnings.some((w) => w.includes("both"))).toBe(true);
  });

  it("accumulates multiple warnings, not just the first", () => {
    const cfg: SlimRouterConfig = {
      ...DEFAULT_CONFIG,
      tiers: {
        fast: {
          ...DEFAULT_CONFIG.tiers.fast,
          models: [
            { provider: "unknown-a", model: "x", priority: 1 },
            { provider: "deepseek", model: "nonexistent", priority: 2 },
          ],
        },
        smart: { ...DEFAULT_CONFIG.tiers.smart, models: [] },
      },
    };
    const warnings = validateConfig(cfg, makeStore());
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});