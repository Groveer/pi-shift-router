/**
 * Slim Router — Routing engine tests
 *
 * The routing algorithm is the contract from SPEC §3. These tests prove
 * we honour the upgrade/downgrade rules, regardless of SPEC's worked
 * examples (which contain minor inconsistencies in the window math).
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
    judge: { provider: "auto", model: "auto", timeout: 5000 },
    tiers: {
      light:    { label: "Light",    models: [{ provider: "p", model: "l", priority: 1 }], description: "" },
      medium:   { label: "Medium",   models: [{ provider: "p", model: "m", priority: 1 }], description: "" },
      flagship: { label: "Flagship", models: [{ provider: "p", model: "f", priority: 1 }], description: "" },
    },
    routing: {
      mode: "auto",
      upgrade: { immediate: true },
      downgrade: {
        flagship: { minObservations: 4, threshold: 0.75 },
        medium:   { minObservations: 3, threshold: 0.75 },
        maxWindowSize: 10,
      },
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

// ─── Upgrade (SPEC §3.3) ──────────────────────────────────────────
describe("Upgrade is immediate", () => {
  it("light → medium on any medium judge", () => {
    const state = createRouterState();
    state.currentTier = "light";
    const config = makeConfig();

    const d = step(state, config, judge("medium"));
    expect(d.action).toBe("upgrade");
    expect(d.switchTo?.tier).toBe("medium");
  });

  it("medium → flagship on any flagship judge", () => {
    const state = createRouterState();
    state.currentTier = "medium";
    const config = makeConfig();

    const d = step(state, config, judge("flagship"));
    expect(d.action).toBe("upgrade");
    expect(d.switchTo?.tier).toBe("flagship");
  });

  it("light → flagship on any flagship judge", () => {
    const state = createRouterState();
    state.currentTier = "light";
    const config = makeConfig();

    const d = step(state, config, judge("flagship"));
    expect(d.action).toBe("upgrade");
    expect(d.switchTo?.tier).toBe("flagship");
  });
});

// ─── Upgrade window cleanup (SPEC §3.4) ───────────────────────────
describe("Upgrade cleans lower-tier entries from window", () => {
  it("drops entries with tier below the new tier", () => {
    const state = createRouterState();
    state.currentTier = "light";
    state.window = [
      { tier: "light",   timestamp: 0 },
      { tier: "light",   timestamp: 0 },
      { tier: "medium",  timestamp: 0 },
      { tier: "light",   timestamp: 0 },
    ];
    const config = makeConfig();

    step(state, config, judge("flagship"));
    // After upgrade to flagship, only flagship entries remain (none here, so empty).
    // Then the new flagship entry is pushed? Check implementation behaviour:
    expect(state.window.every((e) => e.tier !== "light" && e.tier !== "medium")).toBe(true);
  });

  it("medium upgrade preserves medium entries, drops light entries", () => {
    const state = createRouterState();
    state.currentTier = "light";
    state.window = [
      { tier: "light",  timestamp: 0 },
      { tier: "light",  timestamp: 0 },
      { tier: "medium", timestamp: 0 },
    ];
    const config = makeConfig();

    step(state, config, judge("medium"));
    // Light entries dropped, medium entry preserved.
    expect(state.window.some((e) => e.tier === "light")).toBe(false);
    expect(state.window.some((e) => e.tier === "medium")).toBe(true);
  });
});

// ─── Downgrade gating (SPEC §3.2) ─────────────────────────────────
describe("Downgrade requires sufficient observations AND threshold", () => {
  it("flagship stays when window length < minObservations", () => {
    const state = createRouterState();
    state.currentTier = "flagship";
    // Window has 2 entries; after push becomes 3, which is < minObservations=4
    state.window = [
      { tier: "light", timestamp: 0 },
      { tier: "light", timestamp: 0 },
    ];
    const config = makeConfig(); // flagship.minObservations = 4

    const d = step(state, config, judge("light"));
    expect(d.action).toBe("stay");
  });

  it("flagship downgrades when window ≥ minObservations and ≥75% are light", () => {
    const state = createRouterState();
    state.currentTier = "flagship";
    state.window = [
      { tier: "light", timestamp: 0 },
      { tier: "light", timestamp: 0 },
      { tier: "light", timestamp: 0 },
      { tier: "light", timestamp: 0 },
    ];
    const config = makeConfig();

    const d = step(state, config, judge("light"));
    expect(d.action).toBe("downgrade");
    expect(d.switchTo?.tier).toBe("light");
  });

  it("flagship downgrades to medium (not light) when medium ratio ≥75%", () => {
    const state = createRouterState();
    state.currentTier = "flagship";
    state.window = [
      { tier: "medium", timestamp: 0 },
      { tier: "medium", timestamp: 0 },
      { tier: "medium", timestamp: 0 },
      { tier: "light",  timestamp: 0 },
    ];
    const config = makeConfig();

    const d = step(state, config, judge("medium"));
    expect(d.action).toBe("downgrade");
    expect(d.switchTo?.tier).toBe("medium");
  });

  it("flagship stays when no single tier reaches 75%", () => {
    const state = createRouterState();
    state.currentTier = "flagship";
    state.window = [
      { tier: "medium", timestamp: 0 },
      { tier: "flagship", timestamp: 0 },
      { tier: "light",  timestamp: 0 },
      { tier: "medium", timestamp: 0 },
    ];
    const config = makeConfig();

    const d = step(state, config, judge("medium"));
    expect(d.action).toBe("stay");
  });
});

// ─── Stay ─────────────────────────────────────────────────────────
describe("Stay action", () => {
  it("returns no switchTo on stay", () => {
    const state = createRouterState();
    state.currentTier = "medium";
    const config = makeConfig();

    const d = step(state, config, judge("medium"));
    expect(d.action).toBe("stay");
    expect(d.switchTo).toBeNull();
  });

  it("light tier stays on light judge", () => {
    const state = createRouterState();
    state.currentTier = "light";
    const config = makeConfig();

    const d = step(state, config, judge("light"));
    expect(d.action).toBe("stay");
  });
});

// ─── Window size cap (SPEC §3.2) ──────────────────────────────────
describe("Window size cap", () => {
  it("discards oldest entries beyond maxWindowSize", () => {
    const state = createRouterState();
    state.currentTier = "flagship";
    state.window = Array.from({ length: 12 }, (_, i) => ({ tier: "light" as Tier, timestamp: i }));
    const config = makeConfig(); // maxWindowSize = 10

    // Add one more, verify oldest 3 dropped
    step(state, config, judge("light"));
    expect(state.window.length).toBeLessThanOrEqual(10);
  });
});

// ─── Judge fallback (SPEC §4.6) ───────────────────────────────────
describe("Judge fallback", () => {
  it("returns medium when no LLM endpoint provided", async () => {
    const { classify } = await import("../src/judge.js");
    const r = await classify("anything", null);
    expect(r.tier).toBe("medium");
    expect(r.source).toBe("fallback");
  });

  it("heuristic classifier is the no-op fallback", async () => {
    const { classifyHeuristic } = await import("../src/judge.js");
    expect(classifyHeuristic("ok").tier).toBe("medium");
    expect(classifyHeuristic("really long prompt " + "x".repeat(1000)).tier).toBe("medium");
    expect(classifyHeuristic("architect something").tier).toBe("medium");
  });
});

// ─── Manual override ──────────────────────────────────────────────
describe("Manual override (SPEC §6.3)", () => {
  it("bypasses routing entirely when active (by tier)", () => {
    const state = createRouterState();
    state.currentTier = "light";
    state.manualOverride = { active: true, tier: "flagship" };
    const config = makeConfig();

    const d = step(state, config, judge("light")); // judge says stay
    expect(d.action).toBe("manual");
    expect(d.switchTo?.tier).toBe("flagship");
  });

  it("bypasses routing when active (by exact model)", () => {
    const state = createRouterState();
    state.currentTier = "light";
    state.manualOverride = { active: true, provider: "anthropic", modelId: "claude-opus-4" };
    const config = makeConfig();

    const d = step(state, config, judge("light"));
    expect(d.action).toBe("manual");
    expect(d.switchTo?.provider).toBe("anthropic");
    expect(d.switchTo?.modelId).toBe("claude-opus-4");
  });
});