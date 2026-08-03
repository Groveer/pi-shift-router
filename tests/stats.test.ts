/**
 * pi-shift-router — Router statistics (TDD test)
 *
 * `computeStats` is a pure function: takes RouterState + config, returns
 * a snapshot suitable for `/router stats` display.
 */

import { describe, it, expect } from "vitest";
import { computeStats } from "../src/stats.js";
import { createRouterState } from "../src/router.js";
import { createCooldowns, markModelFailed } from "../src/failover.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { ShiftRouterConfig } from "../src/types.js";

function makeConfig(): ShiftRouterConfig {
  return {
    ...DEFAULT_CONFIG,
    tiers: {
      fast: { label: "Fast", models: [{ provider: "p", model: "f", priority: 1 }], description: "" },
      smart: { label: "Smart", models: [{ provider: "p", model: "s", priority: 1 }], description: "" },
    },
  };
}

describe("computeStats — pure state snapshot", () => {
  it("returns zeros and empty arrays for a fresh state", () => {
    const state = createRouterState();
    const stats = computeStats(state, makeConfig());

    expect(stats.windowSize).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.downgradeCount).toBe(0);
    expect(stats.upgradeCount).toBe(0);
    expect(stats.cooldownCount).toBe(0);
    expect(stats.activeCooldowns).toEqual([]);
    expect(stats.confidence).toEqual({ high: 0, mid: 0, low: 0, none: 0 });
  });

  it("counts window entries", () => {
    const state = createRouterState();
    state.window = [
      { tier: "fast", timestamp: 0, confidence: 0.9 },
      { tier: "fast", timestamp: 1, confidence: 0.8 },
      { tier: "smart", timestamp: 2, confidence: 0.95 },
    ];
    const stats = computeStats(state, makeConfig());
    expect(stats.windowSize).toBe(3);
  });

  it("buckets window confidence: high ≥0.7, mid ≥0.5, low <0.5, none=undefined", () => {
    const state = createRouterState();
    state.window = [
      { tier: "fast", timestamp: 0, confidence: 0.95 }, // high
      { tier: "fast", timestamp: 0, confidence: 0.8 },  // high
      { tier: "fast", timestamp: 0, confidence: 0.6 },  // mid
      { tier: "fast", timestamp: 0, confidence: 0.3 },  // low
      { tier: "fast", timestamp: 0 },                    // none
    ];
    const stats = computeStats(state, makeConfig());
    expect(stats.confidence).toEqual({ high: 2, mid: 1, low: 1, none: 1 });
  });

  it("sums totalOutputTokens", () => {
    const state = createRouterState();
    state.totalOutputTokens = 12_345;
    const stats = computeStats(state, makeConfig());
    expect(stats.totalOutputTokens).toBe(12_345);
  });

  it("computes average speed from recentSpeeds (excludes empty window)", () => {
    const state = createRouterState();
    state.recentSpeeds = [20, 30, 40];
    const stats = computeStats(state, makeConfig());
    expect(stats.avgTokensPerSec).toBe(30);
    expect(stats.currentTokensPerSec).toBe(40); // last value
  });

  it("returns 0 avg when no speeds recorded", () => {
    const state = createRouterState();
    const stats = computeStats(state, makeConfig());
    expect(stats.avgTokensPerSec).toBe(0);
    expect(stats.currentTokensPerSec).toBe(0);
  });

  it("counts active cooldowns (only non-expired)", () => {
    const state = createRouterState();
    state.modelCooldowns = createCooldowns();
    const NOW = 1_000_000;
    markModelFailed(state.modelCooldowns, "p", "a", NOW);          // active
    markModelFailed(state.modelCooldowns, "p", "b", NOW - 1_000_000); // expired (1m ago)
    const stats = computeStats(state, makeConfig(), NOW);
    expect(stats.cooldownCount).toBe(1);
    expect(stats.activeCooldowns).toHaveLength(1);
    expect(stats.activeCooldowns[0]).toMatchObject({ provider: "p", model: "a" });
  });

  it("tracks downgrade and upgrade counts", () => {
    const state = createRouterState();
    state.downgradeCount = 3;
    state.upgradeCount = 7;
    const stats = computeStats(state, makeConfig());
    expect(stats.downgradeCount).toBe(3);
    expect(stats.upgradeCount).toBe(7);
  });
});