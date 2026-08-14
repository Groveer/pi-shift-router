/**
 * pi-shift-router — Judge tests
 *
 * Tests for the JSON parser (extractTier) and URL builder (judgeApiUrl).
 * The full classify() function makes a network call and is not unit-tested;
 * verify it via the verbose log output instead.
 */

import { describe, it, expect } from "vitest";
import { extractTier, parseJudgeAnswer } from "../src/judge.js";

// ─── extractTier: primary JSON path ─────────────────────────────────
describe("extractTier — JSON", () => {
  it("parses {\"tier\":\"fast\"}", () => {
    expect(extractTier('{"tier":"fast"}')).toBe("fast");
  });

  it("parses {\"tier\":\"smart\"}", () => {
    expect(extractTier('{"tier":"smart"}')).toBe("smart");
  });

  it("parses with spaces around colon", () => {
    expect(extractTier('{ "tier" : "fast" }')).toBe("fast");
  });

  it("parses with extra keys", () => {
    expect(extractTier('{"reason":"x","tier":"smart"}')).toBe("smart");
  });

  it("is case-insensitive for the tier value", () => {
    expect(extractTier('{"tier":"Fast"}')).toBe("fast");
    expect(extractTier('{"tier":"SMART"}')).toBe("smart");
  });

  it("parses even when surrounded by prose (model didn't follow instructions)", () => {
    expect(extractTier('Thinking... {"tier":"fast"} done')).toBe("fast");
  });

  it("returns null for invalid JSON tier values", () => {
    expect(extractTier('{"tier":"medium"}')).toBeNull();
    expect(extractTier('{"tier":""}')).toBeNull();
  });

  it("returns null for non-tier JSON", () => {
    expect(extractTier('{"answer":"yes"}')).toBeNull();
  });
});

// ─── extractTier: loose JSON path ────────────────────────────────────
describe("extractTier — loose JSON", () => {
  it("tolerates missing quotes around the value", () => {
    expect(extractTier('{"tier":fast}')).toBe("fast");
    expect(extractTier('{"tier":smart}')).toBe("smart");
  });

  it("tolerates missing quotes around the key", () => {
    expect(extractTier('{tier:"fast"}')).toBe("fast");
  });
});

// ─── extractTier: bare keyword path ─────────────────────────────────
describe("extractTier — bare keyword", () => {
  it("finds 'fast' as standalone word", () => {
    expect(extractTier("fast")).toBe("fast");
    expect(extractTier("  fast  ")).toBe("fast");
  });

  it("finds 'smart' as standalone word", () => {
    expect(extractTier("I think smart is the answer")).toBe("smart");
  });

  it("is case-insensitive", () => {
    expect(extractTier("FAST")).toBe("fast");
    expect(extractTier("Smart")).toBe("smart");
  });

  it("returns null when no tier keyword appears", () => {
    expect(extractTier("I don't know")).toBeNull();
    expect(extractTier("maybe medium?")).toBeNull();
  });

  it("takes the first occurrence when both appear (rare edge case)", () => {
    // Edge case: model said both. We take the first. This is a known limitation
    // that JSON parsing should normally prevent.
    expect(extractTier("fast then smart")).toBe("fast");
  });
});

// ─── extractTier: empty / invalid ───────────────────────────────────
describe("extractTier — edge cases", () => {
  it("returns null for empty string", () => {
    expect(extractTier("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(extractTier("   \n\t  ")).toBeNull();
  });

  it("returns null for unrelated JSON", () => {
    expect(extractTier('{"foo":1}')).toBeNull();
  });

  it("tolerates a reason field alongside tier (JSON path)", () => {
    expect(
      extractTier('{"tier":"smart","confidence":0.85,"reason":"user asked for depth"}'),
    ).toBe("smart");
  });
  it("returns null for garbage text", () => {
    expect(extractTier("@#$%^&*")).toBeNull();
  });
});

// ─── parseJudgeAnswer: reason extraction ──────────────────────────
describe("parseJudgeAnswer — reason field", () => {
  it("parses tier + confidence + reason from full JSON", () => {
    expect(
      parseJudgeAnswer('{"tier":"smart","confidence":0.85,"reason":"user asked for depth"}'),
    ).toEqual({ tier: "smart", confidence: 0.85, reason: "user asked for depth" });
  });

  it("parses reason even when confidence is absent", () => {
    expect(
      parseJudgeAnswer('{"tier":"fast","reason":"routine bug fix, path clear"}'),
    ).toEqual({ tier: "fast", reason: "routine bug fix, path clear" });
  });

  it("accepts 'why' as an alias for reason", () => {
    expect(
      parseJudgeAnswer('{"tier":"smart","confidence":0.7,"why":"architecture direction"}'),
    ).toEqual({ tier: "smart", confidence: 0.7, reason: "architecture direction" });
  });

  it("omits reason when absent", () => {
    expect(parseJudgeAnswer('{"tier":"fast","confidence":0.9}')).toEqual({ tier: "fast", confidence: 0.9 });
  });

  it("trims and caps an overlong reason", () => {
    const long = "x".repeat(300);
    const r = parseJudgeAnswer(`{"tier":"fast","reason":"${long}"}`);
    expect(r?.reason?.length).toBeLessThanOrEqual(120);
    expect(r?.reason?.length).toBe(120);
  });

  it("parses orchestrate:true from JSON", () => {
    expect(
      parseJudgeAnswer('{"tier":"smart","confidence":0.9,"orchestrate":true,"reason":"multi-file feature"}'),
    ).toEqual({ tier: "smart", confidence: 0.9, orchestrate: true, reason: "multi-file feature" });
  });

  it("parses orchestrate:false from JSON", () => {
    expect(
      parseJudgeAnswer('{"tier":"smart","orchestrate":false}'),
    ).toEqual({ tier: "smart", orchestrate: false });
  });

  it("accepts loose orchestrate=true syntax", () => {
    expect(parseJudgeAnswer('{"tier":"smart", orchestrate: true}')?.orchestrate).toBe(true);
  });

  it("omits orchestrate when absent (backward compat)", () => {
    expect(parseJudgeAnswer('{"tier":"fast","confidence":0.9}')).toEqual({ tier: "fast", confidence: 0.9 });
  });

  it("ignores malformed orchestrate value", () => {
    expect(parseJudgeAnswer('{"tier":"smart","orchestrate":"yes"}')?.orchestrate).toBeUndefined();
  });

  it("returns null for unparseable text", () => {
    expect(parseJudgeAnswer("@#$%")).toBeNull();
  });
});