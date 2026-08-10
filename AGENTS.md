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

- **Two tiers, not three.** The only meaningful classification axis is **role** — fast Engineer (drives the whole turn for routine execution) vs smart CTO (drives the whole turn for complex / high-stakes / irreversible work). Calling the smart tier "judgment" is misleading: the chosen tier does **not** hand off work — it executes the entire agent run (thinking, tool calls, message content) at that tier's intelligence. The third "light" tier was removed in v0.3.0 because it was unused in real pi-agent sessions.
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
- **Hard Stop before `git push` and `npm publish` — explicit user approval required.** The agent must NOT run `git push origin ...` or `npm publish` (or `NPM_CONFIG_CACHE=... npm publish`) without the user first saying "push" / "发布" / "go" / "ship it" in the same turn. The reasoning is that "commit" is local and reversible, but push (and especially publish) are public, irreversible, and visible to every downstream user — silently pushing has shipped broken or unwanted state more than once. Bumping the version in `package.json` is also part of the release workflow and must be coordinated with the user, not done implicitly.
- **Version bump on every release.** Every push that is meant to be `npm publish`-able must bump `package.json` from `X.Y.Z` to the next semver (use `npm version patch` / `minor` / `major` based on the change kind, or edit the file directly) and update `CHANGELOG.md` with a new top entry. The repo version in `package.json` must always match the latest published npm version — a stale `package.json` version is a release-process bug.

### Release Workflow

Every public release (`npm publish`) goes through a fixed 8-step sequence. The agent must follow the order; skipping a step is a release-process bug.

1. **Verify locally.** Run, in order:
   - `node --experimental-vm-modules node_modules/vitest/vitest.mjs run` — all tests pass (currently 204 tests across 11 files).
   - `node node_modules/typescript/lib/tsc.js` — TypeScript strict compile passes.
   - `node scripts/copy-assets.mjs` — syncs `src/prompts/` into `dist/prompts/`.
   - `node scripts/pack-check.mjs` — `pack:check` passes (engines.node, files, etc.).
   - `shazam_verify` (a shell function defined in the pi-agent harness; the agent invokes it via the `shazam_verify` tool). If any of these fail, abort the release and fix the issue first.
2. **Bump version in `package.json`.** Semver:
   - `patch` (0.0.X) — bug fixes, docs-only changes, prompt-only changes, test-only changes.
   - `minor` (0.X.0) — new features, new tier, new command, new TUI component, new docs section.
   - `major` (X.0.0) — breaking config changes, breaking API changes, removal of a feature.
   - The repo `package.json` version must always be the **next** version higher than the latest published npm version (`npm view pi-shift-router version`). A stale `package.json` is a release bug.
3. **Update `CHANGELOG.md`.** New top entry `## [X.Y.Z] — <one-line summary>` with sub-sections `### Added` / `### Changed` / `### Fixed` / `### Removed` (Keep a Changelog format). The summary line must be ≤ 10 words. Each user-facing change gets one bullet.
4. **Update the version mention in `README.md` / `README.zh-CN.md`** if the README has a "version" callout (it does not currently, but if added later it must stay in sync).
5. **Commit the release locally.** One commit,
   - `chore: release vX.Y.Z` (or `feat: ...` / `fix: ...` if the release is a single-purpose change).
   - The commit message body recaps the changelog bullets.
6. **Hard Stop.** Tell the user: "Ready to push and publish vX.Y.Z. Confirm with `push` / `发布` / `go` before I run `git push` and `npm publish`." The agent must NOT proceed past this point without explicit user approval in the same turn.
7. **Push only after the user confirms.** Run `git push origin main` (with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3"` if SSH host key freshness is uncertain). Then create / move the tag (`git tag -a vX.Y.Z -m "vX.Y.Z — <summary>" && git push origin vX.Y.Z`).
8. **Publish only after the user confirms again.** Run `NPM_CONFIG_CACHE=/tmp/npm-cache npm publish --ignore-scripts --registry=https://registry.npmjs.org/`. The `--registry` flag is mandatory; the sandbox npm default registry may not be the public one. The `--ignore-scripts` flag is mandatory because the post-install script tries to run outside the sandbox. `/tmp/npm-cache` is mandatory because the default `~/.npm` cache is root-owned in the sandbox.

**Reversibility rules.** `git commit` is reversible with `git reset`. `git push` is reversible with `git reset --hard HEAD~1 && git push --force-with-lease` (but only if no one has pulled). `npm publish` is **not reversible** — you can `npm unpublish` within 72 hours, but after that the version is permanent. Always wait for explicit user approval before step 7 and 8.