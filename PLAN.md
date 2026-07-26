# Slim Router — Development Phases

This document records the development phases of Slim Router as a historical record. It complements `CHANGELOG.md` (per-release notes) and `SPEC.md` (current design contract).

## Phase Status

| Phase | Status |
|-------|--------|
| Phase 1 — Core engine + heuristic judge + commands | ✅ Delivered (v0.1.0) |
| Phase 2 — LLM Judge (direct API call) | ✅ Delivered (v0.1.0) |
| Phase 3 — Open-source release prep (renamed, docs, license) | ✅ Delivered (v0.1.0) |
| Phase 4 — UX polish: TUI model picker, wizard | ✅ Delivered (v0.2.0) |
| Phase 5 — Two-tier redesign (CTO / Programmer model) | ✅ Delivered (v0.3.0) |
| Phase 6 — Judge robustness (JSON mode, transient indicator, verbose log) | ✅ Delivered (v0.3.1) |
| Phase 7 — Publish to npm | ⏳ Next |

## Current File Structure

```
pi-slim-router/
├── package.json            # pi-package manifest
├── tsconfig.json           # TypeScript config (strict mode)
├── src/
│   ├── index.ts            # Entry: lifecycle hooks + command registration
│   ├── types.ts            # All TypeScript types + DEFAULT_CONFIG
│   ├── config.ts           # Config loader (read/parse/validate/cache, user+project layers)
│   ├── tier.ts             # Model lookup, priority-based fallback, display
│   ├── judge.ts            # LLM classifier (JSON mode) + fallback "hold position"
│   ├── router.ts           # Routing engine: processRoute + sliding window
│   ├── commands.ts         # /router, /route-force, /route status, wizard
│   ├── tui/
│   │   └── model-picker.ts # TUI component (mirrors pi's /model UX)
│   └── prompts/
│       └── judge.md        # Judge system prompt (loaded at module init)
└── tests/
    └── router.test.ts      # Routing engine unit tests (vitest)
```

## Module Dependency

```
index.ts
  ├── config.ts    →  types.ts
  ├── router.ts    →  types.ts, tier.ts, judge.ts
  ├── tier.ts      →  types.ts
  ├── judge.ts     →  types.ts
  └── commands.ts  →  types.ts, config.ts, tier.ts, router.ts
```

One-way, no cycles. `tui/model-picker.ts` is only imported by `commands.ts` dynamically (lazy load for the wizard).

## Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Pi-agent lifecycle hooks: `session_start` (read-only init), `before_agent_start` (classify + route + apply). Status bar updates. |
| `config.ts` | Read/write `pi-slim-router.json` (user + project layers, project wins). Resolve Fast tier endpoint. Validate models exist. |
| `tier.ts` | Model lookup with priority. Display formatting. |
| `judge.ts` | LLM classifier with JSON-mode constraints + 3-layer parse fallback. On failure, returns `{ tier: "fast", source: "fallback" }` (no keyword/heuristic fallback). |
| `router.ts` | `processRoute()` — manual override check → immediate upgrade → window push → downgrade threshold check. `applyModelSwitch()` — call `pi.setModel()`. |
| `commands.ts` | Slash commands and the configuration wizard. TUI model picker is loaded lazily for TUI mode. |
| `tui/model-picker.ts` | Pure TUI component. Mirrors pi's `/model` UX: real-time filter + 10-item sliding viewport. |
| `types.ts` | All interfaces + `DEFAULT_CONFIG`. Zero dependencies. |

## State Management

`RouterState` lives in `types.ts` and is the only mutable state object:

```typescript
interface RouterState {
  currentTier: Tier;             // "fast" | "smart"
  currentModelId: string | null;
  currentProvider: string | null;
  window: WindowEntry[];         // sliding window of recent judge results
  manualOverride: {
    active: boolean;
    tier?: Tier;
    modelId?: string;
    provider?: string;
  };
}
```

Window state is **per-session**, not persisted. `session_start` resets the window. We deliberately avoid persisting window state across sessions because:

- Cross-session continuity is conceptually unclear (is the user's new request related to the old session's trend?)
- Most conversations are short (1–10 turns), so window accumulation is fast
- Persisting would couple window state to session file format and complicate extension lifecycle

## Test Strategy

- Core routing algorithm: covered by `tests/router.test.ts` (12 tests via vitest).
- Judge: not unit-tested because it requires network. Smoke-tested manually via verbose logging.
- TUI picker: not unit-tested because it requires pi's TUI runtime. Visually tested during wizard development.
- Type checking: `npm run typecheck` runs `tsc --noEmit` in strict mode.

## Future Direction

Phase 7 (npm publish) is the next concrete milestone. Beyond that:

- **Cache-aware routing**: when both tiers share a Provider, automatically raise the downgrade threshold to avoid cache thrashing.
- **Multilingual Judge prompts**: validate `judge.md` works in Chinese, Japanese, Spanish, etc.
- **Per-tier cost statistics**: show users how much they've saved per session.
- **Streaming tool result classification**: classify tool calls (e.g., a long shell command output may indicate the user is debugging, not asking a question).