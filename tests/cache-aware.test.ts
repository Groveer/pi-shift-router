/**
 * pi-shift-router — Cache-aware routing tests (SPEC §9.2)
 *
 * When fast and smart resolve to the same provider family, a mid-session
 * downgrade forfeits the warm prompt cache (reads bill 0.1x–0.5x of base
 * input). Cache-aware routing raises the downgrade threshold and suppresses
 * downgrades while the cache is warm, only allowing them after an idle
 * boundary long enough that the cache has already expired.
 *
 * Covered here:
 *   - shareProviderFamily: same-provider detection
 *   - effectiveThreshold: raised threshold when cache-aware is on
 *   - downgradeAllowedAt: session-boundary gate
 *   - processRoute end-to-end: downgrade suppressed on warm cache,
 *     allowed after idle boundary, unchanged when disabled
 */

import { describe, it, expect } from "vitest";
import {
  createRouterState,
  processRoute,
  analyzeDowngrade,
  shareProviderFamily,
  effectiveThreshold,
  downgradeAllowedAt,
  type RouteDecision,
} from "../src/router.js";
import type { ShiftRouterConfig, JudgeResult, Tier } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";

const IDLE_BOUNDARY = 5 * 60_000; // 5 min, matches DEFAULT_CONFIG

function makeConfig(overrides: Partial<ShiftRouterConfig> = {}): ShiftRouterConfig {
  return {
    ...DEFAULT_CONFIG,
    tiers: {
      fast: { label: "Fast", models: [{ provider: "anthropic", model: "claude-sonnet-5", priority: 1 }], description: "" },
      smart: { label: "Smart", models: [{ provider: "anthropic", model: "claude-opus-5", priority: 1 }], description: "" },
    },
    ...overrides,
  };
}

function makeRegistry() {
  return { find: (provider: string, modelId: string) => ({ provider, modelId }) };
}

function judge(tier: Tier): JudgeResult {
  return { tier, source: "llm" };
}

/** Fill the window with N fast judgments (confidence 1.0) so the downgrade ratio = 1.0. */
function fillFastWindow(state: ReturnType<typeof createRouterState>, n: number, now: number): void {
  for (let i = 0; i < n; i++) {
    state.window.push({ tier: "fast", timestamp: now - 1000, confidence: 1.0 });
  }
}

function step(
  state: ReturnType<typeof createRouterState>,
  config: ShiftRouterConfig,
  j: JudgeResult,
  now: number,
): RouteDecision {
  return processRoute(j, state, config, makeRegistry(), now);
}

// ─── shareProviderFamily ──────────────────────────────────────────
describe("shareProviderFamily", () => {
  it("returns true when both tiers use the same provider", () => {
    const config = makeConfig();
    expect(shareProviderFamily(config)).toBe(true);
  });

  it("returns true when one model in each tier shares a provider among several", () => {
    const config = makeConfig({
      tiers: {
        fast: {
          label: "Fast",
          models: [
            { provider: "openai", model: "gpt-5.6-luna", priority: 2 },
            { provider: "anthropic", model: "claude-sonnet-5", priority: 1 },
          ],
          description: "",
        },
        smart: {
          label: "Smart",
          models: [{ provider: "anthropic", model: "claude-opus-5", priority: 1 }],
          description: "",
        },
      },
    });
    expect(shareProviderFamily(config)).toBe(true);
  });

  it("returns false when tiers use different providers", () => {
    const config = makeConfig({
      tiers: {
        fast: { label: "Fast", models: [{ provider: "openai", model: "gpt-5.6-luna", priority: 1 }], description: "" },
        smart: { label: "Smart", models: [{ provider: "anthropic", model: "claude-opus-5", priority: 1 }], description: "" },
      },
    });
    expect(shareProviderFamily(config)).toBe(false);
  });

  it("returns false when either tier has no models", () => {
    const config = makeConfig({
      tiers: {
        fast: { label: "Fast", models: [], description: "" },
        smart: { label: "Smart", models: [{ provider: "anthropic", model: "claude-opus-5", priority: 1 }], description: "" },
      },
    });
    expect(shareProviderFamily(config)).toBe(false);
  });
});

// ─── effectiveThreshold ───────────────────────────────────────────
describe("effectiveThreshold", () => {
  it("returns the configured window threshold when cache-aware is off", () => {
    const config = makeConfig({
      routing: {
        ...DEFAULT_CONFIG.routing,
        cacheAware: { ...DEFAULT_CONFIG.routing.cacheAware!, enabled: false },
      },
    });
    expect(effectiveThreshold(config, true)).toBe(0.6); // shareProviderFamily true but enabled=false
  });

  it("returns the raised same-family threshold when cache-aware is on", () => {
    const config = makeConfig({
      routing: {
        ...DEFAULT_CONFIG.routing,
        cacheAware: { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: IDLE_BOUNDARY },
      },
    });
    expect(effectiveThreshold(config, true)).toBe(0.9);
  });

  it("is enabled by default on same-family configs (SPEC §9.2)", () => {
    const config = makeConfig(); // DEFAULT_CONFIG: cacheAware.enabled = true
    expect(shareProviderFamily(config)).toBe(true);
    expect(effectiveThreshold(config)).toBe(0.9);
  });

  it("returns the configured threshold when providers differ even if enabled", () => {
    const config = makeConfig({
      tiers: {
        fast: { label: "Fast", models: [{ provider: "openai", model: "gpt-5.6-luna", priority: 1 }], description: "" },
        smart: { label: "Smart", models: [{ provider: "anthropic", model: "claude-opus-5", priority: 1 }], description: "" },
      },
      routing: {
        ...DEFAULT_CONFIG.routing,
        cacheAware: { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: IDLE_BOUNDARY },
      },
    });
    expect(effectiveThreshold(config, false)).toBe(0.6);
  });
});

// ─── downgradeAllowedAt ───────────────────────────────────────────
describe("downgradeAllowedAt", () => {
  const cacheAware = { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: IDLE_BOUNDARY };
  const now = 1_000_000_000_000;

  it("always allows when cache-aware is disabled", () => {
    const config = makeConfig({
      routing: {
        ...DEFAULT_CONFIG.routing,
        cacheAware: { ...DEFAULT_CONFIG.routing.cacheAware!, enabled: false },
      },
    });
    const state = createRouterState();
    state.lastActivityAt = now - 1000; // very recent message
    expect(downgradeAllowedAt(state, config, now)).toBe(true);
  });

  it("allows when no message has completed yet (nothing cached)", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    expect(downgradeAllowedAt(state, config, now)).toBe(true); // lastActivityAt === 0
  });

  it("blocks while the cache is warm (recent activity)", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.lastActivityAt = now - 60_000; // 1 min ago
    expect(downgradeAllowedAt(state, config, now)).toBe(false);
  });

  it("allows after the idle boundary (cache expired)", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.lastActivityAt = now - (IDLE_BOUNDARY + 1000);
    expect(downgradeAllowedAt(state, config, now)).toBe(true);
  });

  it("treats the exact boundary as still warm (conservative)", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.lastActivityAt = now - IDLE_BOUNDARY;
    // Implementation uses strict `>`: at exactly the boundary the cache is
    // still considered live, so the downgrade is blocked.
    expect(downgradeAllowedAt(state, config, now)).toBe(false);
  });
});

// ─── analyzeDowngrade with threshold override ─────────────────────
describe("analyzeDowngrade threshold override", () => {
  it("respects the override threshold", () => {
    const config = makeConfig();
    const window = [
      { tier: "fast" as Tier, timestamp: 1, confidence: 1.0 },
      { tier: "fast" as Tier, timestamp: 1, confidence: 1.0 },
    ];
    // ratio = 1.0; base threshold 0.6 would downgrade, override 0.9 does too (1.0 ≥ 0.9)
    expect(analyzeDowngrade(window, "smart", config, 0.9).shouldDowngrade).toBe(true);
    // override 1.1 → no downgrade
    expect(analyzeDowngrade(window, "smart", config, 1.1).shouldDowngrade).toBe(false);
  });

  it("defaults to the configured threshold when override is undefined", () => {
    const config = makeConfig({
      routing: { ...DEFAULT_CONFIG.routing, window: { size: 5, threshold: 0.95 } },
    });
    const window = [
      { tier: "fast" as Tier, timestamp: 1, confidence: 1.0 },
      { tier: "fast" as Tier, timestamp: 1, confidence: 0.5 }, // == minConfidence → still considered
    ];
    // ratio = (1.0 + 0.5) / 2 = 0.75 < 0.95 → no downgrade
    expect(analyzeDowngrade(window, "smart", config).shouldDowngrade).toBe(false);
    // A 2×1.0 window → ratio 1.0 ≥ 0.95 → downgrade
    expect(
      analyzeDowngrade(
        [
          { tier: "fast" as Tier, timestamp: 1, confidence: 1.0 },
          { tier: "fast" as Tier, timestamp: 1, confidence: 1.0 },
        ],
        "smart",
        config,
      ).shouldDowngrade,
    ).toBe(true);
  });
});

// ─── processRoute end-to-end ──────────────────────────────────────
describe("processRoute with cache-aware routing", () => {
  const now = 1_000_000_000_000;
  const cacheAware = { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: IDLE_BOUNDARY };

  it("suppresses a mid-session downgrade while the cache is warm", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.currentTier = "smart";
    state.lastActivityAt = now - 10_000; // warm cache
    fillFastWindow(state, 5, now);

    const d = step(state, config, judge("fast"), now);
    expect(d.action).toBe("stay"); // downgrade blocked
    expect(d.switchTo).toBeNull();
  });

  it("allows the downgrade after the idle boundary", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.currentTier = "smart";
    state.lastActivityAt = now - (IDLE_BOUNDARY + 1000); // cache expired
    fillFastWindow(state, 5, now);

    const d = step(state, config, judge("fast"), now);
    expect(d.action).toBe("downgrade");
    expect(d.switchTo?.tier).toBe("fast");
  });

  it("downgrades normally (base threshold) when cache-aware is disabled", () => {
    const config = makeConfig({
      routing: {
        ...DEFAULT_CONFIG.routing,
        cacheAware: { ...DEFAULT_CONFIG.routing.cacheAware!, enabled: false },
      },
    });
    const state = createRouterState();
    state.currentTier = "smart";
    state.lastActivityAt = now - 10_000; // warm, but disabled → no gate
    fillFastWindow(state, 5, now);

    const d = step(state, config, judge("fast"), now);
    expect(d.action).toBe("downgrade");
  });

  it("downgrades normally with cache-aware on but a weak fast majority", () => {
    // 3/5 fast → ratio 0.6, below the raised 0.9 threshold → stay
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.currentTier = "smart";
    state.lastActivityAt = now - (IDLE_BOUNDARY + 1000); // cache cold, gate passes
    for (let i = 0; i < 3; i++) state.window.push({ tier: "fast", timestamp: now - 1000, confidence: 1.0 });
    for (let i = 0; i < 2; i++) state.window.push({ tier: "smart", timestamp: now - 1000, confidence: 1.0 });

    const d = step(state, config, judge("fast"), now);
    expect(d.action).toBe("stay"); // raised threshold requires 90% fast
  });

  it("does not block upgrades even when cache-aware is on", () => {
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.currentTier = "fast";
    state.lastActivityAt = now - 10_000; // warm cache

    const d = step(state, config, judge("smart"), now);
    expect(d.action).toBe("upgrade");
    expect(d.switchTo?.tier).toBe("smart");
  });

  it("still downgrades at the raised threshold when the cache is cold", () => {
    // 5/5 fast → ratio 1.0 ≥ 0.9 → downgrade after boundary
    const config = makeConfig({ routing: { ...DEFAULT_CONFIG.routing, cacheAware } });
    const state = createRouterState();
    state.currentTier = "smart";
    state.lastActivityAt = now - (IDLE_BOUNDARY + 1000);
    fillFastWindow(state, 5, now);

    const d = step(state, config, judge("fast"), now);
    expect(d.action).toBe("downgrade");
  });
});
