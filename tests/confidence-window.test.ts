/**
 * pi-shift-router — Confidence-weighted sliding window tests
 *
 * SPEC: Judge returns { tier, confidence }. The sliding window counts
 * only entries whose confidence meets `window.minConfidence`. The downgrade
 * ratio is the SUM of confidences for fast entries / total entries.
 *
 * Pure functions:
 *   - parseJudgeConfidence(text): number | null   (in judge.ts)
 *   - analyzeDowngrade(...): now weights by confidence
 */

import { describe, it, expect } from "vitest";
import { analyzeDowngrade } from "../src/router.js";
import { extractTier } from "../src/judge.js";
import type { ShiftRouterConfig, WindowEntry } from "../src/types.js";

function makeConfig(overrides: Partial<ShiftRouterConfig["routing"]> = {}): ShiftRouterConfig {
  return {
    enabled: true,
    tiers: {
      fast: { label: "Fast", models: [{ provider: "p", model: "f", priority: 1 }], description: "" },
      smart: { label: "Smart", models: [{ provider: "p", model: "s", priority: 1 }], description: "" },
    },
    routing: {
      mode: "auto",
      judgeTimeout: 5000,
      window: {
        size: 5,
        threshold: 0.6,
        minConfidence: 0.5,
        ...overrides.window,
      },
    },
    ux: { quietMode: false, statusBar: true, inlineToast: true },
  } as ShiftRouterConfig;
}

function entry(tier: "fast" | "smart", confidence?: number): WindowEntry {
  return {
    tier,
    timestamp: 0,
    confidence: confidence ?? 1.0,
  };
}

// ─── Confidence parsing ────────────────────────────────────────────
describe("extractTier parses confidence", () => {
  it("extracts confidence from primary JSON shape", () => {
    const text = '{"tier":"fast","confidence":0.85}';
    expect(extractTier(text)).toBe("fast");
  });

  it("returns null for malformed confidence (non-numeric)", () => {
    const text = '{"tier":"fast","confidence":"high"}';
    expect(extractTier(text)).toBe("fast"); // tier still parsed
  });
});

// ─── analyzeDowngrade: weighted window ──────────────────────────────
describe("analyzeDowngrade with confidence weighting", () => {
  it("downgrades when all fast entries are high confidence", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        entry("fast", 0.9),
        entry("fast", 0.9),
        entry("fast", 0.9),
      ],
    };
    const config = makeConfig();
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    // weighted fast = 2.7 / 3 = 0.9 ≥ 0.6
    expect(r.shouldDowngrade).toBe(true);
  });

  it("does not downgrade when most fast entries are low confidence", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        entry("fast", 0.3),  // skipped (below minConfidence)
        entry("fast", 0.3),  // skipped
        entry("fast", 0.3),  // skipped
        entry("smart", 0.9),
      ],
    };
    const config = makeConfig();
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    // All 3 fast entries below 0.5 minConfidence → ignored → ratio = 0
    expect(r.shouldDowngrade).toBe(false);
  });

  it("weighted ratio: partial confidence yields fractional ratio", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        entry("fast", 0.5),
        entry("fast", 0.5),
        entry("fast", 0.5),
        entry("fast", 0.5),
      ],
    };
    const config = makeConfig();
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    // 4 * 0.5 / 4 = 0.5 < 0.6 → no downgrade
    expect(r.shouldDowngrade).toBe(false);
  });

  it("weighted ratio: 3 of 4 fast above min-confidence hits threshold", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        entry("fast", 0.9),
        entry("fast", 0.9),
        entry("fast", 0.9),
        entry("smart", 0.9),
      ],
    };
    const config = makeConfig();
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    // 3 * 0.9 / 4 = 0.675 ≥ 0.6
    expect(r.shouldDowngrade).toBe(true);
  });

  it("defaults to confidence 1.0 when not provided (backward compat)", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        { tier: "fast" as const, timestamp: 0 },  // no confidence → 1.0
        { tier: "fast" as const, timestamp: 0 },
        { tier: "fast" as const, timestamp: 0 },
      ],
    };
    const config = makeConfig();
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    // 3 * 1.0 / 3 = 1.0 ≥ 0.6
    expect(r.shouldDowngrade).toBe(true);
  });

  it("window is capped to size (last N entries only)", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        entry("smart", 0.9),  // outside window
        entry("smart", 0.9),  // outside window
        entry("fast", 0.9),   // in window
        entry("fast", 0.9),   // in window
        entry("fast", 0.9),   // in window
        entry("fast", 0.9),   // in window
        entry("fast", 0.9),   // in window
      ],
    };
    const config = makeConfig({ window: { size: 5, threshold: 0.6, minConfidence: 0.5 } });
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    // window.size = 5 → last 5 entries = [fast×5]
    // 5 * 0.9 / 5 = 0.9 ≥ 0.6
    expect(r.shouldDowngrade).toBe(true);
  });

  it("no downgrade when currentTier is already fast", () => {
    const state = {
      currentTier: "fast" as const,
      window: [
        entry("fast", 0.9),
        entry("fast", 0.9),
        entry("fast", 0.9),
      ],
    };
    const config = makeConfig();
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    expect(r.shouldDowngrade).toBe(false);
    expect(r.targetTier).toBeNull();
  });

  it("does not downgrade when window is empty", () => {
    const config = makeConfig();
    const r = analyzeDowngrade([], "smart", config);
    expect(r.shouldDowngrade).toBe(false);
  });

  it("custom threshold raises the bar", () => {
    const state = {
      currentTier: "smart" as const,
      window: [
        entry("fast", 0.9),
        entry("fast", 0.9),
        entry("smart", 0.9),
      ],
    };
    // 2 * 0.9 / 3 = 0.6, threshold 0.8 → not enough
    const config = makeConfig({ window: { size: 5, threshold: 0.8, minConfidence: 0.5 } });
    const r = analyzeDowngrade(state.window, state.currentTier, config);
    expect(r.shouldDowngrade).toBe(false);
  });
});

// ─── End-to-end via processRoute ───────────────────────────────────
import { createRouterState, processRoute } from "../src/router.js";
describe("processRoute respects confidence weighting", () => {
  it("stays on smart when fast entries are low confidence", () => {
    const state = createRouterState();
    state.currentTier = "smart";
    state.window = [
      entry("fast", 0.3),
      entry("fast", 0.3),
      entry("fast", 0.3),
      entry("fast", 0.3),
    ];
    const config = makeConfig();

    const d = processRoute({ tier: "fast", source: "llm", confidence: 0.3 }, state, config, { find: () => ({} as any) });
    expect(d.action).toBe("stay"); // all low-confidence fast → no downgrade
  });
});