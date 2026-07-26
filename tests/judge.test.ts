/**
 * pi-shift-router — Judge tests
 *
 * Tests for the JSON parser (extractTier) and URL builder (judgeApiUrl).
 * The full classify() function makes a network call and is not unit-tested;
 * verify it via the verbose log output instead.
 */

import { describe, it, expect } from "vitest";
import { extractTier } from "../src/judge.js";

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

  it("returns null for garbage text", () => {
    expect(extractTier("@#$%^&*")).toBeNull();
  });
});