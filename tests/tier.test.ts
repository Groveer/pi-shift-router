/**
 * pi-shift-router — Tier management tests
 *
 * Covers tier.ts pure functions: model lookup, priority sort,
 * display formatting, validation. These are pure (no IO) so
 * they don't need mocks.
 */

import { describe, it, expect } from "vitest";
import {
  findBestModelForTier,
  isValidTier,
  tierEmoji,
  tierLabel,
  formatTierDisplay,
} from "../src/tier.js";
import { DEFAULT_CONFIG, type ShiftRouterConfig } from "../src/types.js";

function makeRegistry(modelIds: Record<string, string[]>) {
  // modelIds: { provider: [model, model, ...] }
  return {
    find: (provider: string, modelId: string) => {
      if (modelIds[provider]?.includes(modelId)) return { provider, modelId };
      return undefined;
    },
  };
}

// ─── findBestModelForTier ──────────────────────────────────────────
describe("findBestModelForTier", () => {
  const cfg = (models: { provider: string; model: string; priority: number }[]): ShiftRouterConfig => ({
    ...DEFAULT_CONFIG,
    tiers: {
      ...DEFAULT_CONFIG.tiers,
      fast: { ...DEFAULT_CONFIG.tiers.fast, models },
    },
  });

  it("returns the configured model when found in registry", () => {
    const config = cfg([{ provider: "deepseek", model: "deepseek-v4-flash", priority: 1 }]);
    const registry = makeRegistry({ deepseek: ["deepseek-v4-flash"] });

    const r = findBestModelForTier("fast", config, registry);
    expect(r).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash", tier: "fast" });
  });

  it("picks lower priority first", () => {
    const config = cfg([
      { provider: "kimi", model: "kimi-k3", priority: 2 },
      { provider: "deepseek", model: "deepseek-v4-flash", priority: 1 },
    ]);
    const registry = makeRegistry({
      kimi: ["kimi-k3"],
      deepseek: ["deepseek-v4-flash"],
    });

    const r = findBestModelForTier("fast", config, registry);
    expect(r?.modelId).toBe("deepseek-v4-flash");
  });

  it("falls back to higher priority when lower-priority model missing", () => {
    const config = cfg([
      { provider: "kimi", model: "kimi-k3", priority: 1 }, // not in registry
      { provider: "deepseek", model: "deepseek-v4-flash", priority: 2 }, // available
    ]);
    const registry = makeRegistry({ deepseek: ["deepseek-v4-flash"] });

    const r = findBestModelForTier("fast", config, registry);
    expect(r?.modelId).toBe("deepseek-v4-flash");
  });

  it("returns null when no configured model is in registry", () => {
    const config = cfg([{ provider: "openai", model: "gpt-4o", priority: 1 }]);
    const registry = makeRegistry({ anthropic: ["claude-sonnet"] });

    expect(findBestModelForTier("fast", config, registry)).toBeNull();
  });

  it("returns null when tier has no models configured", () => {
    const config = cfg([]);
    const registry = makeRegistry({ deepseek: ["deepseek-v4-flash"] });

    expect(findBestModelForTier("fast", config, registry)).toBeNull();
  });

  it("returns null when modelRegistry is undefined", () => {
    const config = cfg([{ provider: "deepseek", model: "deepseek-v4-flash", priority: 1 }]);
    expect(findBestModelForTier("fast", config, undefined)).toBeNull();
  });

  it("works for smart tier", () => {
    const smartConfig = {
      ...DEFAULT_CONFIG,
      tiers: {
        ...DEFAULT_CONFIG.tiers,
        smart: {
          ...DEFAULT_CONFIG.tiers.smart,
          models: [{ provider: "kimi", model: "kimi-k3", priority: 1 }],
        },
      },
    };
    const registry = makeRegistry({ kimi: ["kimi-k3"] });

    const r = findBestModelForTier("smart", smartConfig, registry);
    expect(r?.tier).toBe("smart");
    expect(r?.modelId).toBe("kimi-k3");
  });

  it("swallows modelRegistry.find() exceptions and tries next", () => {
    const config = cfg([
      { provider: "broken", model: "x", priority: 1 },
      { provider: "deepseek", model: "deepseek-v4-flash", priority: 2 },
    ]);
    const registry = {
      find: (provider: string, modelId: string) => {
        if (provider === "broken") throw new Error("network down");
        if (provider === "deepseek" && modelId === "deepseek-v4-flash") return { provider, modelId };
        return undefined;
      },
    };

    const r = findBestModelForTier("fast", config, registry);
    expect(r?.modelId).toBe("deepseek-v4-flash");
  });
});

// ─── tierEmoji ──────────────────────────────────────────────────────
describe("tierEmoji", () => {
  it("returns 🧠 for smart", () => {
    expect(tierEmoji("smart")).toBe("🧠");
  });

  it("returns 🦾 for fast", () => {
    expect(tierEmoji("fast")).toBe("🦾");
  });
});

// ─── formatTierDisplay ─────────────────────────────────────────────
describe("formatTierDisplay", () => {
  it("formats smart + modelId with emoji", () => {
    expect(formatTierDisplay("smart", "kimi/kimi-k3")).toBe("[🧠 kimi-k3]");
  });

  it("formats fast + modelId with emoji", () => {
    expect(formatTierDisplay("fast", "deepseek/deepseek-v4-flash")).toBe("[🦾 deepseek-v4-flash]");
  });

  it("takes only the last segment of a slash-separated modelId", () => {
    expect(formatTierDisplay("smart", "provider/sub-org/model-name")).toBe("[🧠 model-name]");
  });

  it("returns empty string for null tier", () => {
    expect(formatTierDisplay(null, "kimi/k3")).toBe("");
  });

  it("uses ellipsis when modelId is null", () => {
    expect(formatTierDisplay("smart", null)).toBe("[🧠 …]");
  });
});

// ─── tierLabel ──────────────────────────────────────────────────────
describe("tierLabel", () => {
  it("returns the configured label", () => {
    expect(tierLabel("fast", DEFAULT_CONFIG)).toBe("Fast");
    expect(tierLabel("smart", DEFAULT_CONFIG)).toBe("Smart");
  });
});

// ─── isValidTier ────────────────────────────────────────────────────
describe("isValidTier", () => {
  it("accepts 'fast' and 'smart'", () => {
    expect(isValidTier("fast")).toBe(true);
    expect(isValidTier("smart")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isValidTier("medium")).toBe(false);
    expect(isValidTier("flagship")).toBe(false);
    expect(isValidTier("")).toBe(false);
    expect(isValidTier("FAST")).toBe(false); // case-sensitive
  });
});