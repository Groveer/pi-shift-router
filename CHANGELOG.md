# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Renamed from `pi-slim-router` to `pi-shift-router` in v0.4.0.** Earlier versions
> (0.1.0 – 0.3.1) were developed under the `pi-slim-router` working name and never
> published to npm. The plugin was first published to npm as `pi-shift-router` at v0.4.0.

## [0.4.1] — 2026-08-16

### Fixed

- **`/router config` failed with `Cannot find package '@earendil-works/pi-coding-agent'`**
  when installed via `pi install npm:pi-shift-router` (the canonical install path).
  Three coupled mistakes caused the runtime failure:
  1. `@earendil-works/pi-coding-agent` was declared as `peerDependencies` (npm does
     not auto-install peer deps in pi's isolated extensions subtree).
  2. `src/tui/model-picker.ts` used a value-import for `getSelectListTheme`, so
     TypeScript compiled it into the runtime JS.
  3. Local development masked the bug because the `.pi/extensions/` bridge loads
     extensions through pi-agent's own loader, which has access to its host deps.
  Fix:
  - Move `@earendil-works/pi-coding-agent` from `peerDependencies` to `devDependencies`
    (runtime does not need it; only types do via `import type`).
  - Switch all pi-coding-agent imports to `import type`.
  - Reimplement `getSelectListTheme` locally using the `Theme` instance that
    `ctx.ui.custom()` injects as a factory parameter.

### Added

- **`pack:check` script** (`scripts/pack-check.mjs`) — a publish-state validator
  that catches the same class of bug above automatically. Checks: host packages
  are not in `dependencies`, compiled output contains no runtime value-imports of
  host packages, required files (README / LICENSE / CHANGELOG / dist/index.js /
  dist/prompts/judge.md) exist and are matched by `files`, `pi.extensions` paths
  resolve on disk, `engines.node` is declared. Wired into `prepublishOnly` and CI.

## [0.4.0] — 2026-08-15

### Added

- **Comprehensive unit test suite** (47 new tests): tier management, config validation,
  judge JSON parser. Total 59 tests covering the core algorithm and edge cases.
- **GitHub Actions CI** on Node 24 (matrix extensible). Runs typecheck, test, build,
  and a smoke check that `dist/` and `dist/prompts/judge.md` exist.
- **Chinese README** (`README.zh-CN.md`) with bilingual language navigation.
- **Troubleshooting section** in README: common Judge parse errors, missing models,
  aggressive downgrade threshold.

### Changed

- **Documentation overhaul**: AGENTS.md, PLAN.md, SPEC.md, README.md all rewritten
  in idiomatic English (was previously mixed Chinese/English). Adds TOC, Prerequisites,
  Install, Demo, Roadmap, Acknowledgements.
- **Project rename**: `pi-slim-router` → `pi-shift-router` (npm name, GitHub repo,
  internal identifiers, all references). The rename reflects the project's core
  "shift gears between execution and judgment" mental model.
- **Install instructions** updated to `pi install npm:pi-shift-router` (the actual
  pi package manager command), with link to pi's packages docs.
- **Pricing claims removed**: README no longer cites specific per-call cost numbers
  (varies by provider/time). Now uses qualitative "a few thousand tokens at your
  Fast-tier pricing".
- **Author attribution**: explicit credit to green-dalii in README.
- **`@earendil-works/pi-tui` moved from devDependencies to dependencies** because
  it is a runtime import (`src/tui/model-picker.ts`).

### Removed

- `typebox` from peerDependencies (was never used).
- Outdated references to three-tier architecture and heuristic Judge from docs.

## [0.3.1] — 2026-08-12

### Added

- **`routerLogVerbose` UX flag** — prints router decisions, judge calls, window state
  to console for advanced users. Toggle via `/router verbose`, `/router config` → UX
  settings, or directly in JSON.
- **Transient `⚖ judging…` status badge** — shown during the Judge API call so the
  user sees the router is working instead of a silent delay between message send and
  first response token. Restored via `try/finally`.

### Changed

- **Judge prompt asks for JSON**: `{"tier":"fast"}` or `{"tier":"smart"}`.
- **API-level JSON constraints** (hard, not just prompt):
  - OpenAI-compatible (DeepSeek, OpenAI): `response_format: { type: "json_object" }`.
  - Anthropic: assistant prefill `{"` to force JSON-start output.
- **`max_tokens: 200 → 4000`** to leave room for CoT reasoning on DeepSeek Reasoner-class
  models (whose `reasoning_content` is bounded by `max_tokens`).
- **`parseResponse` three-layer fallback**: JSON parse → loose JSON → bare keyword.
  Falls back from `content` to `reasoning_content` for CoT models.

### Fixed

- DeepSeek V4 Flash responses were returning `content:""` with `finish_reason:"length"`
  because `max_tokens:10` was too small for chain-of-thought. Now reliably returns
  valid JSON.

## [0.3.0] — 2026-08-09

### Changed (Breaking)

- **Three tiers → Two tiers**: `light`/`medium`/`flagship` → `fast` (🦾 programmer) / `smart` (🧠 CTO).
  Classification dimension changed from **task topic** (QA vs coding vs design) to **mental mode**
  (execution vs judgment). See SPEC §2.2 for the new framing.

- **`session_start` no longer calls `pi.setModel()`** — the router is now read-only at session start.
  It respects whatever model the user has configured in pi. Model switching only happens during
  `before_agent_start` when the routing decision demands it.

- **Config format flattened**: removed `judge.provider`/`judge.model`/`judge.timeout` (Judge always
  uses Fast tier's model). Removed `routing.upgrade` / `routing.downgrade.flagship` / `routing.downgrade.medium`
  / `routing.downgrade.maxWindowSize`. Replaced with `routing.window: { size, threshold }` and
  `routing.judgeTimeout`.

- `resolveJudgeEndpoint()` → `resolveFastEndpoint()`. Judge model = Fast tier's model.

### Added

- Proper CTO/Programmer framing throughout documentation — README, SPEC, AGENTS.

### Removed

- `classifyHeuristic()` — no more regex/keyword fallback. LLM Judge is the sole classifier.
  On failure, simply holds position (fast tier, no switch).
- `UpgradeConfig`, `DowngradeConfig`, `DowngradeTierConfig`, `JudgeConfig` interfaces.
- Light/Medium/Flagship tier references from all source files, config files, and tests.

### Tests

- Rewrote all 12 tests for two-tier: upgrade (fast→smart), downgrade (smart→fast with window),
  stay, window cap, manual override, judge fallback.
- Removed three-tier-specific tests (multi-step downgrades, cross-tier upgrade window cleanup).

## [0.2.0] — 2026-08-01

### Added

- **TUI model picker** (`src/tui/model-picker.ts`) matching pi's native `/model` UX: real-time fuzzy filtering, sliding 10-item viewport, scroll indicator, arrow keys / Enter / Esc. Built on `@earendil-works/pi-tui`'s `Container` + `Input` + `fuzzyFilter` primitives, following the same pattern as pi's `ModelSelectorComponent`.
- Provider-first wizard flow: pick provider → enter the new picker.
- Selected model (●) and judge model (⚖) indicators in the picker.

### Changed

- Wizard model selection now uses the TUI picker in interactive mode; non-TUI modes fall back to a flat list via `ctx.ui.select()`.
- Replaced `ctx.ui.textInput()` (does not exist) with `ctx.ui.input()`.
- Internal: `pickModel` now consumes the TUI picker factory; the legacy letter-index and pagination-button flows are removed.

### Dependencies

- `devDependencies`: added `@earendil-works/pi-tui@^0.81.0` for type definitions and local builds. At runtime the package is resolved through the host pi-coding-agent installation.

## [0.1.0] — 2026-07-23

### Added

- Initial release of Slim Router for pi-agent.
- Three-tier routing architecture: Flagship (🧠), Medium (🦾), Lightweight (⚡).
- Two-stage judge: LLM classification with heuristic fallback.
- Sliding window trend detection for upgrade/downgrade decisions.
- Interactive configuration wizard (`/router config`) with model selection.
- `/router` commands: on, off, status, quiet, config.
- `/route-force` command for manual model override.
- Status bar integration showing current tier and model.
- Automatic judge endpoint resolution from Light tier model.
- All tiers start empty — zero interference with pi default behavior.

### Changed

- License: MIT → Apache 2.0.
- Project documentation: README, CONTRIBUTING, SPEC, CHANGELOG.

### Removed

- Auto-assignment of models by price on first launch.
- Separate `/route-config` command (merged into `/router config`).
- Separate Judge model configuration (always uses Light tier's model).
- Multi-select model picker (replaced with single-select radio).
