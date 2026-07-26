# pi-shift-router — Development Principles

This document is the developer handbook for pi-shift-router. It defines the philosophy, code standards, architecture principles, and collaboration conventions that every contribution must follow.

## Philosophy

- **Simplicity over complexity.** Every line is a potential bug. Prefer expressions over statements. Avoid `if` when an expression will do.
- **Delete before adding.** Before submitting a change, ask: "is this truly needed?" Dead code is worse than missing code.
- **DRY.** If two places do similar work, extract an abstraction. If three, design a pattern.
- **Explicit over implicit.** No hidden side effects, no obscured state, no "happy coincidence" behavior.
- **Small files.** One file, one job, done well.
- **Flat over nested.** Two levels of indentation is a refactoring signal. Use early returns.
- **Tests are not optional.** The core routing algorithm must have coverage. We don't do TDD but we backfill tests.

## Code Standards

- **TypeScript only.** No `any` (except when interfacing with undocumented pi-agent APIs). Prefer `interface` over `type`.
- **No classes** unless state + behavior genuinely requires encapsulation. Default to pure functions and data structures.
- **No third-party dependencies** beyond `@earendil-works/pi-coding-agent` (peer), `@earendil-works/pi-tui` (devDep for local builds), and `typebox` (peer). The runtime has zero external libraries.
- **Side-effect isolation.** Pure functions at the top. IO passed in.
- **Errors are values, not exceptions.** Log to console and fall back. Never crash the host process.

## Architecture Principles

- **Two tiers, not three.** The only meaningful classification axis is **mental mode** (execution vs judgment). The third "light" tier was removed in v0.3.0 because it was unused in real pi-agent sessions.
- **LLM Judge, not regex.** The LLM is the sole classifier. There are no keyword lists, no scoring rules, no heuristic fallbacks. When the Judge is unavailable, hold position on the current tier — never guess.
- **`session_start` is read-only.** The router must never override the user's default model at session start. The first model switch happens during `before_agent_start` if and only if a routing decision demands it.
- **Hard API constraints over soft prompts.** When the provider supports JSON mode (OpenAI-compatible: `response_format: { type: "json_object" }`; Anthropic: assistant prefill), use it. Prompt-only constraints are weak and break on reasoning models.
- **One-way module dependency:** `index.ts → router.ts → judge.ts|tier.ts → config.ts → types.ts`. TUI components live in `src/tui/` and do not pollute the core algorithm.
- **Configuration sinks to `types.ts`.** Magic numbers and defaults live in `DEFAULT_CONFIG`. Nothing else embeds constants.
- **Single entry point.** pi-agent lifecycle hooks are registered only through `index.ts`. Other modules never touch pi's API surface directly.
- **State is centralized.** `RouterState` is the only mutable state object. Functions receive it, modify it, return it.
- **TUI components manage their own input.** When implementing `Focusable`, intercept all keyboard input in `handleInput()` and dispatch to children (Input, SelectList, etc.) manually. `Container` does **not** auto-route keys to focused children — pi's `ModelSelectorComponent` follows this pattern.

## Collaboration Conventions

- **SPEC-driven development.** SPEC changes are discussed before code. The SPEC is the source of truth for design decisions.
- **Phased development.** MVP proves the core path first. Iterate on polish and breadth afterward.
- **Commit messages use module prefix:** `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`.
- **Principle changes update SPEC first.** Any change to philosophy, architecture, or user-facing contract must land in `SPEC.md` (or `AGENTS.md` for developer-policy changes) before code.
- **PRs stay focused.** One logical change per PR. Split large changes into smaller reviewable pieces.