/**
 * pi-shift-router — Orchestration (SPEC §9.3) tests
 *
 * Backward-compatibility contract:
 * 1. Default off — orchestration.enabled=false is byte-for-byte today's router.
 * 2. Simple tasks (Judge "fast") never orchestrate.
 * 3. Config without orchestration.* parses unchanged (deepMerge defaults).
 * 4. Missing subagent tool / unresolvable Smart model → no injection, no crash.
 * 5. Abort/reset semantics.
 * 6. Existing features unaffected.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  type ShiftRouterConfig,
  type RouterState,
} from "../src/types.js";
import { createRouterState } from "../src/router.js";
import {
  shouldOrchestrate,
  buildOrchestratorPrompt,
  renderTierChain,
  enterOrchestration,
  exitOrchestration,
  resetOrchestration,
  capHit,
} from "../src/orchestrate.js";

function makeConfig(partial?: Partial<ShiftRouterConfig>): ShiftRouterConfig {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ShiftRouterConfig;
  if (partial) {
    // Deep merge partial into the config clone.
    const p = partial as unknown as Record<string, unknown>;
    const c = cfg as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      if (
        v !== null && typeof v === "object" && !Array.isArray(v) &&
        c[k] !== null && typeof c[k] === "object" && !Array.isArray(c[k])
      ) {
        (c[k] as Record<string, unknown>) = { ...(c[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        c[k] = v;
      }
    }
  }
  return cfg;
}

function noCooldown(_provider: string, _model: string): boolean {
  return false;
}

describe("orchestration: default config", () => {
  it("is disabled by default (backward-compat #1)", () => {
    expect(DEFAULT_CONFIG.orchestration.enabled).toBe(false);
  });

  it("config without orchestration.* parses unchanged (backward-compat #3)", () => {
    // Simulate an old config file (no orchestration key) — deepMerge must
    // fill in defaults. loadConfig uses the same deepMerge; here we verify
    // the default shape is present and complete.
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ShiftRouterConfig;
    expect(cfg.orchestration).toEqual({
      enabled: false,
      maxRounds: 3,
      escalationThreshold: 2,
      requireSmartModel: true,
    });
  });
});

describe("shouldOrchestrate", () => {
  it("returns false when orchestration disabled (backward-compat #1)", () => {
    const cfg = makeConfig();
    expect(shouldOrchestrate(cfg, "smart", true, true)).toBe(false);
  });

  it("returns false for simple tasks even when enabled (backward-compat #2)", () => {
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true } });
    expect(shouldOrchestrate(cfg, "fast", true, true)).toBe(false);
  });

  it("returns false when router disabled", () => {
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true }, enabled: false });
    expect(shouldOrchestrate(cfg, "smart", true, true)).toBe(false);
  });

  it("returns true for smart verdict when everything available", () => {
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true } });
    expect(shouldOrchestrate(cfg, "smart", true, true)).toBe(true);
  });

  it("returns false when Smart model unresolvable and requireSmartModel (backward-compat #4)", () => {
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true } });
    expect(shouldOrchestrate(cfg, "smart", false, true)).toBe(false);
  });

  it("returns true when Smart model unresolvable but requireSmartModel=false", () => {
    const cfg = makeConfig({
      orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true, requireSmartModel: false },
    });
    expect(shouldOrchestrate(cfg, "smart", false, true)).toBe(true);
  });

  it("returns false when subagent tool unavailable (backward-compat #4)", () => {
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true } });
    expect(shouldOrchestrate(cfg, "smart", true, false)).toBe(false);
  });
});

describe("renderTierChain", () => {
  it("renders models in priority order with thinking suffix", () => {
    const chain = renderTierChain(
      [
        { provider: "b", model: "m2", priority: 2 },
        { provider: "a", model: "m1", priority: 1 },
      ],
      noCooldown,
      "high",
    );
    expect(chain).toContain("a/m1:high");
    expect(chain).toContain("b/m2:high");
    // priority order: a/m1 first
    expect(chain.indexOf("a/m1")).toBeLessThan(chain.indexOf("b/m2"));
  });

  it("skips models in cooldown", () => {
    const chain = renderTierChain(
      [
        { provider: "a", model: "hot", priority: 1 },
        { provider: "a", model: "cold", priority: 2 },
      ],
      (p, m) => m === "hot",
      "high",
    );
    expect(chain).not.toContain("hot");
    expect(chain).toContain("a/cold:high");
  });

  it("reports when all models are in cooldown", () => {
    const chain = renderTierChain(
      [{ provider: "a", model: "hot", priority: 1 }],
      () => true,
      "high",
    );
    expect(chain).toContain("cooldown");
  });

  it("reports when tier has no models", () => {
    const chain = renderTierChain(undefined, noCooldown, "high");
    expect(chain).toContain("(none");
  });
});

describe("buildOrchestratorPrompt", () => {
  it("injects fast/smart chains and caps into the template", () => {
    const cfg = makeConfig({
      orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true, maxRounds: 5, escalationThreshold: 3 },
    });
    cfg.tiers.fast.models = [{ provider: "fastp", model: "fm", priority: 1 }];
    cfg.tiers.smart.models = [{ provider: "smartp", model: "sm", priority: 1 }];
    const prompt = buildOrchestratorPrompt(cfg, noCooldown);
    expect(prompt).toContain("fastp/fm:high");
    expect(prompt).toContain("smartp/sm:high");
    expect(prompt).not.toContain("{{maxRounds}}");
    expect(prompt).toContain("5");
    expect(prompt).toContain("3");
    expect(prompt).toContain("context: \"fresh\"");
    expect(prompt).toContain("subagent");
  });

  it("renders cooldown-filtered chain into the prompt", () => {
    const cfg = makeConfig({
      orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true },
    });
    cfg.tiers.fast.models = [
      { provider: "p", model: "down", priority: 1 },
      { provider: "p", model: "up", priority: 2 },
    ];
    const prompt = buildOrchestratorPrompt(cfg, (p, m) => m === "down");
    expect(prompt).toContain("p/up:high");
    expect(prompt).not.toContain("p/down");
  });
});

describe("orchestration lifecycle", () => {
  it("enterOrchestration activates and sets startedAt", () => {
    const state: RouterState = createRouterState();
    enterOrchestration(state);
    expect(state.orchestration.active).toBe(true);
    expect(state.orchestration.startedAt).not.toBeNull();
  });

  it("enterOrchestration is idempotent (no reset mid-task)", () => {
    const state: RouterState = createRouterState();
    enterOrchestration(state);
    state.orchestration.rounds = 2;
    enterOrchestration(state);
    expect(state.orchestration.rounds).toBe(2);
  });

  it("exitOrchestration returns to inactive", () => {
    const state: RouterState = createRouterState();
    enterOrchestration(state);
    exitOrchestration(state);
    expect(state.orchestration.active).toBe(false);
    expect(state.orchestration.startedAt).toBeNull();
  });

  it("resetOrchestration clears an active run", () => {
    const state: RouterState = createRouterState();
    enterOrchestration(state);
    resetOrchestration(state);
    expect(state.orchestration.active).toBe(false);
  });

  it("capHit is false when inactive", () => {
    const state: RouterState = createRouterState();
    const cfg = makeConfig();
    expect(capHit(state, cfg)).toBe(false);
  });

  it("capHit fires at maxRounds", () => {
    const state: RouterState = createRouterState();
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true, maxRounds: 3 } });
    enterOrchestration(state);
    state.orchestration.rounds = 3;
    expect(capHit(state, cfg)).toBe(true);
  });

  it("capHit fires at escalationThreshold", () => {
    const state: RouterState = createRouterState();
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true, escalationThreshold: 2 } });
    enterOrchestration(state);
    state.orchestration.escalations = 2;
    expect(capHit(state, cfg)).toBe(true);
  });

  it("capHit false below caps", () => {
    const state: RouterState = createRouterState();
    const cfg = makeConfig({ orchestration: { ...DEFAULT_CONFIG.orchestration, enabled: true, maxRounds: 3, escalationThreshold: 2 } });
    enterOrchestration(state);
    state.orchestration.rounds = 1;
    state.orchestration.escalations = 1;
    expect(capHit(state, cfg)).toBe(false);
  });
});
