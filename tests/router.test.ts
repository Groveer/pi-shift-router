/**
 * Slim Router — Routing engine tests
 *
 * Two-tier (fast/smart) routing algorithm tests:
 *   - Upgrade (fast → smart): immediate
 *   - Downgrade (smart → fast): requires window majority
 *   - Manual override bypasses all routing
 *   - Fallback when judge unavailable
 */

import { describe, it, expect } from "vitest";
import {
  createRouterState,
  processRoute,
  type RouterState,
} from "../src/router.js";
import type { SlimRouterConfig, JudgeResult, Tier } from "../src/types.js";

function makeRegistry() {
  return { find: (provider: string, modelId: string) => ({ provider, modelId }) };
}

function makeConfig(overrides: Partial<SlimRouterConfig> = {}): SlimRouterConfig {
  return {
    enabled: true,
    tiers: {
      fast:  { label: "Fast",  models: [{ provider: "p", model: "fast-model",  priority: 1 }], description: "" },
      smart: { label: "Smart", models: [{ provider: "p", model: "smart-model", priority: 1 }], description: "" },
    },
    routing: {
      mode: "auto",
      judgeTimeout: 5000,
      window: { size: 5, threshold: 0.6 },
    },
    ux: { quietMode: false, statusBar: true, inlineToast: true },
    ...overrides,
  } as SlimRouterConfig;
}

function judge(tier: Tier): JudgeResult {
  return { tier, source: "llm" };
}

function step(state: RouterState, config: SlimRouterConfig, j: JudgeResult) {
  return processRoute(j, state, config, makeRegistry());
}

// ─── Upgrade (immediate) ──────────────────────────────────────────
describe("Upgrade is immediate", () => {
  it("fast → smart on any smart judge", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    const config = makeConfig();

    const d = step(state, config, judge("smart"));
    expect(d.action).toBe("upgrade");
    expect(d.switchTo?.tier).toBe("smart");
    // Window cleared on upgrade
    expect(state.window.length).toBe(0);
  });

  it("fast stays fast on fast judge (no upgrade needed)", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    const config = makeConfig();

    const d = step(state, config, judge("fast"));
    expect(d.action).toBe("stay");
    expect(d.switchTo).toBeNull();
  });
});

// ─── Downgrade gating ─────────────────────────────────────────────
describe("Downgrade from smart requires window majority", () => {
  it("smart stays when window has only smart entries", () => {
    const state = createRouterState();
    state.currentTier = "smart";
    state.window = [
      { tier: "smart", timestamp: 0 },
      { tier: "smart", timestamp: 0 },
      { tier: "smart", timestamp: 0 },
    ];
    const config = makeConfig();

    const d = step(state, config, judge("smart"));
    expect(d.action).toBe("stay");
  });

  it("smart stays when fast ratio < threshold (40% < 60%)", () => {
    const state = createRouterState();
    state.currentTier = "smart";
    state.window = [
      { tier: "fast",  timestamp: 0 },
      { tier: "smart", timestamp: 0 },
      { tier: "smart", timestamp: 0 },
      { tier: "smart", timestamp: 0 },
    ];
    const config = makeConfig();

    const d = step(state, config, judge("smart"));
    expect(d.action).toBe("stay");
  });

  it("smart downgrades when fast ratio ≥ 60%", () => {
    const state = createRouterState();
    state.currentTier = "smart";
    state.window = [
      { tier: "fast",  timestamp: 0 },
      { tier: "fast",  timestamp: 0 },
      { tier: "fast",  timestamp: 0 },
      { tier: "fast",  timestamp: 0 },
    ];
    const config = makeConfig();

    const d = step(state, config, judge("fast"));
    expect(d.action).toBe("downgrade");
    expect(d.switchTo?.tier).toBe("fast");
  });

  it("fast never downgrades further (already bottom)", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    const config = makeConfig();

    const d = step(state, config, judge("fast"));
    expect(d.action).toBe("stay");
  });
});

// ─── Stay ─────────────────────────────────────────────────────────
describe("Stay action", () => {
  it("returns no switchTo on stay", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    const config = makeConfig();

    const d = step(state, config, judge("fast"));
    expect(d.action).toBe("stay");
    expect(d.switchTo).toBeNull();
  });

  it("smart stays on smart judge (no window push for same tier)", () => {
    const state = createRouterState();
    state.currentTier = "smart";
    const config = makeConfig();

    const d = step(state, config, judge("smart"));
    expect(d.action).toBe("stay");
    // Window entry still pushed for tracking
    expect(state.window.length).toBeGreaterThan(0);
  });
});

// ─── Window size cap ──────────────────────────────────────────────
describe("Window size cap", () => {
  it("discards oldest entries beyond window size", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    state.window = Array.from({ length: 8 }, (_, i) => ({ tier: "fast" as Tier, timestamp: i }));
    const config = makeConfig(); // window.size = 5

    step(state, config, judge("fast"));
    expect(state.window.length).toBeLessThanOrEqual(5);
  });
});

// ─── Judge fallback ──────────────────────────────────────────────
describe("Judge fallback", () => {
  it("returns fast when no LLM endpoint provided", async () => {
    const { classify } = await import("../src/judge.js");
    const r = await classify("anything", null);
    expect(r.tier).toBe("fast");
    expect(r.source).toBe("fallback");
  });
});

// ─── Manual override ──────────────────────────────────────────────
describe("Manual override", () => {
  it("bypasses routing entirely when active (by tier)", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    state.manualOverride = { active: true, tier: "smart" };
    const config = makeConfig();

    const d = step(state, config, judge("fast")); // judge says stay
    expect(d.action).toBe("manual");
    expect(d.switchTo?.tier).toBe("smart");
    expect(d.switchTo?.modelId).toBe("smart-model");
  });

  it("bypasses routing when active (by exact model)", () => {
    const state = createRouterState();
    state.currentTier = "fast";
    state.manualOverride = {
      active: true,
      provider: "anthropic",
      modelId: "claude-opus-4",
    };
    const config = makeConfig();

    const d = step(state, config, judge("fast"));
    expect(d.action).toBe("manual");
    expect(d.switchTo?.provider).toBe("anthropic");
    expect(d.switchTo?.modelId).toBe("claude-opus-4");
  });
});
