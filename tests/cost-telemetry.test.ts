/**
 * pi-shift-router — Cost telemetry tests (SPEC §9 deep view)
 *
 * Validates the per-message attribution, tier split, and the
 * "hypothetical all-on-most-expensive-model" baseline.
 */

import { describe, it, expect } from "vitest";
import { createRouterState } from "../src/router.js";
import {
  computeCostTelemetry,
  formatStats,
  formatUsd,
  type CostTelemetry,
} from "../src/stats.js";
import { getModelPricing } from "../src/config.js";
import type { ModelsStore, RouterState } from "../src/types.js";

const sampleStore: ModelsStore = {
  cheap: {
    models: [
      { id: "cheap-flash", provider: "cheap", cost: { input: 0.15, output: 0.6 } },
    ],
  },
  pricey: {
    models: [
      { id: "pricey-pro", provider: "pricey", cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 } },
    ],
  },
};

/** Minimal config whose smart tier has pricey/pricey-pro as priority 1. */
const cfgWithSmart = {
  tiers: {
    fast: { models: [{ provider: "cheap", model: "cheap-flash", priority: 1 }], label: "Fast", description: "" },
    smart: { models: [{ provider: "pricey", model: "pricey-pro", priority: 1 }], label: "Smart", description: "" },
  },
  routing: { mode: "auto" as const, window: { size: 5, threshold: 0.6, minConfidence: 0.5 }, judgeTimeout: 5000 },
  ux: { quietMode: false, statusBar: true, inlineToast: true, routerLogVerbose: false },
  enabled: true,
} as any;

/** Config with an empty smart tier (no baseline possible). */
const cfgEmptySmart = {
  ...cfgWithSmart,
  tiers: {
    fast: { models: [{ provider: "cheap", model: "cheap-flash", priority: 1 }], label: "Fast", description: "" },
    smart: { models: [], label: "Smart", description: "" },
  },
} as any;

describe("createRouterState initializes cost telemetry", () => {
  it("starts with zero tier usage and empty callLog", () => {
    const s = createRouterState();
    expect(s.tierUsage.fast).toEqual({
      calls: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
    });
    expect(s.tierUsage.smart).toEqual({
      calls: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
    });
    expect(s.callLog).toEqual([]);
  });
});

describe("computeCostTelemetry — basic attribution", () => {
  it("attributes input/output/cache tokens and cost to the active tier", () => {
    const s = createRouterState();
    s.callLog.push({
      tier: "fast",
      provider: "cheap",
      modelId: "cheap-flash",
      tokens: { input: 1_000, output: 500, cacheRead: 0, cacheWrite: 0 },
      cost: 0.0005,
    });
    s.callLog.push({
      tier: "smart",
      provider: "pricey",
      modelId: "pricey-pro",
      tokens: { input: 2_000, output: 800, cacheRead: 100, cacheWrite: 50 },
      cost: 0.045,
    });
    s.tierUsage = {
      fast: { calls: 1, tokens: { input: 1_000, output: 500, cacheRead: 0, cacheWrite: 0 }, cost: 0.0005 },
      smart: { calls: 1, tokens: { input: 2_000, output: 800, cacheRead: 100, cacheWrite: 50 }, cost: 0.045 },
    };

    const c = computeCostTelemetry(s, cfgWithSmart);
    expect(c.byTier.fast.calls).toBe(1);
    expect(c.byTier.fast.cost).toBe(0.0005);
    expect(c.byTier.smart.calls).toBe(1);
    expect(c.byTier.smart.cost).toBe(0.045);
    expect(c.actualTotal).toBeCloseTo(0.0455);
  });

  it("returns zero baseline when no store is supplied", () => {
    const s = createRouterState();
    s.callLog.push({
      tier: "smart",
      provider: "pricey",
      modelId: "pricey-pro",
      tokens: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
      cost: 0.05,
    });
    s.tierUsage.smart.calls = 1;
    s.tierUsage.smart.cost = 0.05;
    const c = computeCostTelemetry(s, cfgWithSmart); // no store
    expect(c.baselineTotal).toBe(0);
    expect(c.savings).toBe(0);
    expect(c.baselineModel).toBe(null);
  });

  it("computes baseline against the configured smart model (priority 1)", () => {
    const s = createRouterState();
    // 3 calls: cheap-flash x2, pricey-pro x1
    s.callLog.push(
      {
        tier: "fast",
        provider: "cheap",
        modelId: "cheap-flash",
        tokens: { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 },
        cost: 0.15 * 1 + 0.6 * 0.5, // 0.45
      },
      {
        tier: "fast",
        provider: "cheap",
        modelId: "cheap-flash",
        tokens: { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 },
        cost: 0.45,
      },
      {
        tier: "smart",
        provider: "pricey",
        modelId: "pricey-pro",
        tokens: { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 },
        cost: 3.0 * 1 + 15.0 * 0.1, // 4.5
      },
    );
    s.tierUsage = {
      fast: { calls: 2, tokens: { input: 2_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, cost: 0.9 },
      smart: { calls: 1, tokens: { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 }, cost: 4.5 },
    };

    // Baseline = every call priced at smart priority-1 (pricey-pro $3/$15):
    // Call 1: 3*1 + 15*0.5 = 10.5
    // Call 2: 3*1 + 15*0.5 = 10.5
    // Call 3: 3*1 + 15*0.1 = 4.5
    // Total baseline: 25.5
    const c = computeCostTelemetry(s, cfgWithSmart, sampleStore);
    expect(c.baselineTotal).toBeCloseTo(25.5);
    expect(c.actualTotal).toBeCloseTo(5.4);
    expect(c.savings).toBeCloseTo(20.1);
    expect(c.baselineModel?.provider).toBe("pricey");
    expect(c.baselineModel?.modelId).toBe("pricey-pro");
  });

  it("includes cacheRead/cacheWrite in the baseline when priced", () => {
    const s = createRouterState();
    s.callLog.push({
      tier: "smart",
      provider: "pricey",
      modelId: "pricey-pro",
      tokens: { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 100_000 },
      cost: 4.5,
    });
    s.tierUsage.smart.calls = 1;
    s.tierUsage.smart.tokens = { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 100_000 };
    s.tierUsage.smart.cost = 4.5;

    const c = computeCostTelemetry(s, cfgWithSmart, sampleStore);
    // baseline at pricey-pro pricing: input $3 + output $15*0.1 + cacheRead $0.3*0.5 + cacheWrite $3.75*0.1
    // = 3 + 1.5 + 0.15 + 0.375 = 5.025
    expect(c.baselineTotal).toBeCloseTo(5.025);
  });
});

describe("computeCostTelemetry — fallback behaviour", () => {
  it("returns zero baseline when the smart tier is unconfigured", () => {
    const s = createRouterState();
    s.callLog.push({
      tier: "smart",
      provider: "ghost",
      modelId: "mystery",
      tokens: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
      cost: 0.001,
    });
    s.tierUsage.smart.calls = 1;
    s.tierUsage.smart.cost = 0.001;
    const c = computeCostTelemetry(s, cfgEmptySmart, sampleStore);
    expect(c.baselineTotal).toBe(0);
    expect(c.savings).toBe(0);
    expect(c.baselineModel).toBe(null);
  });

  it("returns zero baseline when the smart model has no pricing in store", () => {
    const s = createRouterState();
    s.callLog.push({
      tier: "fast",
      provider: "cheap",
      modelId: "cheap-flash",
      tokens: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
      cost: 0.001,
    });
    s.tierUsage.fast.calls = 1;
    s.tierUsage.fast.cost = 0.001;
    const c = computeCostTelemetry(s, cfgWithSmart, {}); // store lacks pricey
    expect(c.baselineTotal).toBe(0);
    expect(c.savings).toBe(0);
    expect(c.baselineModel).toBe(null);
  });
});

describe("formatUsd", () => {
  it("formats values with adaptive precision", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.000123)).toBe("$0.0001");
    expect(formatUsd(0.5)).toBe("$0.500");
    expect(formatUsd(2.5)).toBe("$2.50");
    expect(formatUsd(1234.567)).toBe("$1234.57");
  });
});

describe("formatStats — cost block", () => {
  it("includes the spend + baseline lines", () => {
    const s = createRouterState();
    s.tierUsage.fast = { calls: 1, tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, cost: 0.001 };
    s.tierUsage.smart = { calls: 1, tokens: { input: 200, output: 80, cacheRead: 0, cacheWrite: 0 }, cost: 0.04 };
    s.callLog.push(
      { tier: "fast", provider: "cheap", modelId: "cheap-flash", tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, cost: 0.001 },
      { tier: "smart", provider: "pricey", modelId: "pricey-pro", tokens: { input: 200, output: 80, cacheRead: 0, cacheWrite: 0 }, cost: 0.04 },
    );

    const cfg = {
      tiers: {
        fast: { models: [{ provider: "cheap", model: "cheap-flash", priority: 1 }], label: "Fast", description: "" },
        smart: { models: [{ provider: "pricey", model: "pricey-pro", priority: 1 }], label: "Smart", description: "" },
      },
      routing: { mode: "auto" as const, window: { size: 5, threshold: 0.6, minConfidence: 0.5 }, judgeTimeout: 5000 },
      ux: { quietMode: false, statusBar: true, inlineToast: true, routerLogVerbose: false },
      enabled: true,
    } as any;

    const out = formatStats(s, cfg, Date.now(), sampleStore);
    expect(out).toMatch(/Judge: 🧭 cheap\/cheap-flash/);
    expect(out).toMatch(/Spend: fast .* · smart .* · total /);
    expect(out).toMatch(/baseline: all-turns-on-smart \(pricey\/pricey-pro\) → /);
    expect(out).toMatch(/saved /);
    expect(out).toMatch(/fast tokens: \d+ in \/ \d+ out/);
    expect(out).toMatch(/smart tokens: \d+ in \/ \d+ out/);
  });

  it("shows 'baseline: unavailable' when actual cost exists but pricing is missing", () => {
    const s = createRouterState();
    s.tierUsage.smart = { calls: 1, tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, cost: 0.05 };
    s.callLog.push({
      tier: "smart",
      provider: "ghost",
      modelId: "mystery",
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
      cost: 0.05,
    });

    const cfg = {
      tiers: { fast: { models: [], label: "Fast", description: "" }, smart: { models: [], label: "Smart", description: "" } },
      routing: { mode: "auto" as const, window: { size: 5, threshold: 0.6, minConfidence: 0.5 }, judgeTimeout: 5000 },
      ux: { quietMode: false, statusBar: true, inlineToast: true, routerLogVerbose: false },
      enabled: true,
    } as any;

    const out = formatStats(s, cfg, Date.now(), sampleStore);
    expect(out).toMatch(/baseline: unavailable/);
  });
});

describe("getModelPricing", () => {
  it("returns pricing when present", () => {
    const p = getModelPricing(sampleStore, "pricey", "pricey-pro");
    expect(p).toEqual({ input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 });
  });

  it("returns null for unknown model", () => {
    expect(getModelPricing(sampleStore, "ghost", "x")).toBe(null);
  });

  it("returns null when model has no cost entry", () => {
    const store: ModelsStore = {
      foo: { models: [{ id: "no-cost-model", provider: "foo" }] },
    };
    expect(getModelPricing(store, "foo", "no-cost-model")).toBe(null);
  });
});