/**
 * pi-shift-router — Fallback chain editor tests
 *
 * Pure-function tests for chain editor operations:
 * add, remove, move up/down, priority reassignment.
 * TUI rendering is not tested — these are state-transition only.
 */

import { describe, it, expect } from "vitest";
import {
  chainEditorAdd,
  chainEditorRemove,
  chainEditorMoveUp,
  chainEditorMoveDown,
  reassignPriorities,
  isSingleKey,
  reorderDirection,
} from "../src/tui/fallback-chain-editor.js";
import type { ModelRef } from "../src/types.js";

function makeRef(provider: string, model: string, priority = 1): ModelRef {
  return { provider, model, priority };
}

function makeChain(): ModelRef[] {
  return [
    makeRef("deepseek", "deepseek-v4-flash", 1),
    makeRef("kimi", "kimi-k3", 2),
    makeRef("openai", "gpt-4o-mini", 3),
  ];
}

// ─── chainEditorAdd ────────────────────────────────────────────────

describe("chainEditorAdd", () => {
  it("appends a model to the end of the chain", () => {
    const chain = makeChain();
    const added = chainEditorAdd(chain, makeRef("anthropic", "claude-sonnet"));
    expect(added).toHaveLength(4);
    expect(added[3]).toEqual({ provider: "anthropic", model: "claude-sonnet", priority: 1 });
  });

  it("preserves existing order", () => {
    const chain = makeChain();
    const added = chainEditorAdd(chain, makeRef("claude", "sonnet"));
    for (let i = 0; i < chain.length; i++) {
      expect(added[i]).toBe(chain[i]);
    }
  });

  it("works on empty chain", () => {
    const added = chainEditorAdd([], makeRef("deepseek", "deepseek-v4-flash"));
    expect(added).toHaveLength(1);
    expect(added[0]!.model).toBe("deepseek-v4-flash");
  });

  it("is immutable (returns new array)", () => {
    const chain = makeChain();
    const added = chainEditorAdd(chain, makeRef("x", "y"));
    expect(chain).toHaveLength(3);
    expect(added).not.toBe(chain);
  });
});

// ─── chainEditorRemove ─────────────────────────────────────────────

describe("chainEditorRemove", () => {
  it("removes the item at cursor", () => {
    const { items, cursor } = chainEditorRemove(makeChain(), 1);
    expect(items).toHaveLength(2);
    expect(items[0]!.model).toBe("deepseek-v4-flash");
    expect(items[1]!.model).toBe("gpt-4o-mini");
  });

  it("cursor clamps to new last index when removing last item", () => {
    const chain = makeChain();
    const { items, cursor } = chainEditorRemove(chain, 2);
    expect(items).toHaveLength(2);
    expect(cursor).toBe(1);
  });

  it("cursor stays at 0 when removing only item", () => {
    const chain = [makeRef("kimi", "kimi-k3")];
    const { items, cursor } = chainEditorRemove(chain, 0);
    expect(items).toHaveLength(0);
    expect(cursor).toBe(0);
  });

  it("cursor stays same when removing non-last item", () => {
    const chain = makeChain();
    const { cursor } = chainEditorRemove(chain, 0);
    expect(cursor).toBe(0);
  });

  it("does nothing on empty chain", () => {
    const { items, cursor } = chainEditorRemove([], 0);
    expect(items).toHaveLength(0);
    expect(cursor).toBe(0);
  });

  it("is immutable", () => {
    const chain = makeChain();
    chainEditorRemove(chain, 1);
    expect(chain).toHaveLength(3);
  });
});

// ─── chainEditorMoveUp ─────────────────────────────────────────────

describe("chainEditorMoveUp", () => {
  it("swaps item at cursor with the one above", () => {
    const { items } = chainEditorMoveUp(makeChain(), 1);
    expect(items[0]!.model).toBe("kimi-k3");
    expect(items[1]!.model).toBe("deepseek-v4-flash");
    expect(items[2]!.model).toBe("gpt-4o-mini");
  });

  it("cursor moves up by one", () => {
    const { cursor } = chainEditorMoveUp(makeChain(), 1);
    expect(cursor).toBe(0);
  });

  it("does nothing when cursor is at top", () => {
    const chain = makeChain();
    const { items, cursor } = chainEditorMoveUp(chain, 0);
    expect(items).toEqual(chain);
    expect(cursor).toBe(0);
  });

  it("is immutable", () => {
    const chain = makeChain();
    chainEditorMoveUp(chain, 1);
    expect(chain[0]!.model).toBe("deepseek-v4-flash");
  });
});

// ─── chainEditorMoveDown ───────────────────────────────────────────

describe("chainEditorMoveDown", () => {
  it("swaps item at cursor with the one below", () => {
    const { items } = chainEditorMoveDown(makeChain(), 1);
    expect(items[0]!.model).toBe("deepseek-v4-flash");
    expect(items[1]!.model).toBe("gpt-4o-mini");
    expect(items[2]!.model).toBe("kimi-k3");
  });

  it("cursor moves down by one", () => {
    const { cursor } = chainEditorMoveDown(makeChain(), 1);
    expect(cursor).toBe(2);
  });

  it("does nothing when cursor is at bottom", () => {
    const chain = makeChain();
    const { items, cursor } = chainEditorMoveDown(chain, 2);
    expect(items).toEqual(chain);
    expect(cursor).toBe(2);
  });

  it("is immutable", () => {
    const chain = makeChain();
    chainEditorMoveDown(chain, 1);
    expect(chain[1]!.model).toBe("kimi-k3");
  });
});

// ─── reassignPriorities ────────────────────────────────────────────

describe("reassignPriorities", () => {
  it("assigns priorities 1, 2, 3, ... by position", () => {
    const chain = makeChain();
    const updated = reassignPriorities(chain);
    expect(updated[0]!.priority).toBe(1);
    expect(updated[1]!.priority).toBe(2);
    expect(updated[2]!.priority).toBe(3);
  });

  it("preserves model identity", () => {
    const updated = reassignPriorities(makeChain());
    expect(updated[0]!.model).toBe("deepseek-v4-flash");
    expect(updated[1]!.model).toBe("kimi-k3");
    expect(updated[2]!.model).toBe("gpt-4o-mini");
  });

  it("overwrites old priorities", () => {
    const chain = [
      makeRef("a", "m1", 10),
      makeRef("b", "m2", 5),
    ];
    const updated = reassignPriorities(chain);
    expect(updated[0]!.priority).toBe(1);
    expect(updated[1]!.priority).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(reassignPriorities([])).toEqual([]);
  });

  it("returns a new array (immutable)", () => {
    const chain = makeChain();
    const updated = reassignPriorities(chain);
    expect(updated).not.toBe(chain);
    // Original unchanged
    expect(chain[0]!.priority).toBe(1); // was already 1, but generally...
  });
});

// ─── isSingleKey (case-insensitive single-character match) ─────────

describe("isSingleKey", () => {
  it("matches lowercase key", () => {
    expect(isSingleKey("a", "a")).toBe(true);
  });

  it("matches uppercase key (caps lock on)", () => {
    expect(isSingleKey("A", "a")).toBe(true);
  });

  it("is symmetric: uppercase reference, lowercase input", () => {
    expect(isSingleKey("d", "D")).toBe(true);
    expect(isSingleKey("D", "d")).toBe(true);
  });

  it("rejects different letters", () => {
    expect(isSingleKey("x", "a")).toBe(false);
    expect(isSingleKey("a", "x")).toBe(false);
  });

  it("rejects arrow escape sequences", () => {
    expect(isSingleKey("\x1b[A", "a")).toBe(false);
    expect(isSingleKey("\x1b[1;2A", "a")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSingleKey("", "a")).toBe(false);
  });

  it("rejects multi-character strings (longer than 1 char)", () => {
    expect(isSingleKey("ab", "a")).toBe(false);
    expect(isSingleKey("aa", "a")).toBe(false);
  });
});

// ─── reorderDirection (J/K plain keys + best-effort Shift+Arrow) ───

describe("reorderDirection", () => {
  it("maps k (lowercase) to up", () => {
    expect(reorderDirection("k")).toBe("up");
  });

  it("maps K (uppercase / caps lock) to up", () => {
    expect(reorderDirection("K")).toBe("up");
  });

  it("maps j (lowercase) to down", () => {
    expect(reorderDirection("j")).toBe("down");
  });

  it("maps J (uppercase / caps lock) to down", () => {
    expect(reorderDirection("J")).toBe("down");
  });

  it("accepts Shift+Up ANSI escape as best-effort", () => {
    expect(reorderDirection("\x1b[1;2A")).toBe("up");
  });

  it("accepts Shift+Down ANSI escape as best-effort", () => {
    expect(reorderDirection("\x1b[1;2B")).toBe("down");
  });

  it("returns null for plain arrows (navigation, not reorder)", () => {
    expect(reorderDirection("\x1b[A")).toBeNull(); // plain Up
    expect(reorderDirection("\x1b[B")).toBeNull(); // plain Down
  });

  it("returns null for other letter keys (a/x/d are add/remove/done)", () => {
    expect(reorderDirection("a")).toBeNull();
    expect(reorderDirection("A")).toBeNull();
    expect(reorderDirection("x")).toBeNull();
    expect(reorderDirection("X")).toBeNull();
    expect(reorderDirection("d")).toBeNull();
    expect(reorderDirection("D")).toBeNull();
  });

  it("returns null for modifier escape sequences (Ctrl+↑ etc.)", () => {
    expect(reorderDirection("\x1b[1;5A")).toBeNull(); // Ctrl+Up
    expect(reorderDirection("\x1b[1;5B")).toBeNull(); // Ctrl+Down
  });

  it("returns null for empty / multi-char input", () => {
    expect(reorderDirection("")).toBeNull();
    expect(reorderDirection("jk")).toBeNull();
  });
});
