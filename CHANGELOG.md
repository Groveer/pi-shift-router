# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Renamed from `pi-slim-router` to `pi-shift-router` in v0.4.0.** Earlier versions
> (0.1.0 – 0.3.1) were developed under the `pi-slim-router` working name and never
> published to npm. The plugin was first published to npm as `pi-shift-router` at v0.4.0.

## [0.8.0] — Token throughput + `/router stats` + Tuning Guide

### Added

- **Status bar shows tokens/sec** — when a message finishes streaming, the footer displays `[🧠 kimi-k3 • 23 tok/s]` based on `usage.output / elapsed_ms`. Hooked via `message_start` (records stream start timestamp) + `message_end` (computes throughput, pushes into a 5-sample sliding window).
- **`/router stats`** — new command showing:
  - window size + confidence distribution (high/mid/low/none buckets)
  - cumulative `↑upgrade` / `↓downgrade` counts
  - cumulative output tokens + current / average tokens-per-second
  - active cooldowns with remaining time
- **New pure module `src/stats.ts`** — `computeStats(state, config, now?)` for testable snapshots; `formatStats(state, config)` for the command output.
- **`RouterState` extended** with `totalOutputTokens`, `recentSpeeds`, `streamingStartTime`, `upgradeCount`, `downgradeCount`. Backwards-compatible defaults (zero).
- **Pure helpers in `src/failover.ts`**: `tokensPerSecond(output, elapsedMs)`, `recordSpeed(speeds, tps)` + `SPEED_WINDOW_SIZE = 5`. Unit-tested.
- **`formatTierDisplayWithSpeed(tier, modelId, tps)`** in `src/tier.ts` — drops the suffix when speed is 0.
- **Tuning Guide section** in both READMEs: workload-to-recommendation table, knob-by-knob explanation, sample `/router stats` reading guide.
- **14 new tests** (188 → 202): stats snapshot, confidence bucketing, speed helpers, status-bar formatting.

### Changed

- `processRoute` now increments `state.upgradeCount` / `state.downgradeCount` on tier transitions (for stats).
- `/router` autocomplete now includes `stats`.

---

## [0.7.0] — Confidence-weighted sliding window

### Added

- **Confidence-weighted sliding window** — Judge now emits `{"tier":"...","confidence":0.0-1.0}` instead of just the tier. Entries whose confidence is below `routing.window.minConfidence` (default `0.5`) are ignored by the downgrade gate. The downgrade ratio is the **sum of confidences for fast entries / count of considered entries**, so a single low-confidence vote can't nudge the gate either way.
- **New config field** `routing.window.minConfidence` (default `0.5`). Entries below this threshold are skipped entirely. Set to `0` to restore pure-count behavior.
- **`JudgeResult.confidence?: number`** and **`WindowEntry.confidence?: number`** propagate confidence from the Judge through the window.
- **Judge prompt** now explicitly requests a `confidence` field with the rationale ("higher = clearer signal, low means mixed signals"). The strict `must appear on its own with no extra prose` wording is preserved.
- **12 new tests** (176 → 188): confidence parsing, weighted downgrade, low-confidence skip, threshold gating, default 1.0 for legacy entries, window-size cap interaction with confidence.

### Changed

- `routing.window.minConfidence` added to `DEFAULT_CONFIG.routing.window`.
- `analyzeDowngrade` now exported (was internal) for direct unit testing.
- `parseResponse` returns `ParsedJudgeResponse` (`{tier, confidence?}`) instead of bare `Tier`.

---

## [0.6.0] — Runtime failover (exponential backoff)

### Added

- **Runtime failover** (SPEC §8.5): when a model fails mid-turn with a
  transient provider error, the router takes over after pi's own retries
  give up.
  - `agent_end` hook inspects the transcript for a failover signature
    (429 / 5xx / `rate limit` / `quota` / `rate_limit_error` /
    `insufficient_quota` / `Token Plan` / `用量上限`), marks the model
    into exponential-backoff cooldown (1m, 2m, 4m, … capped at 30m),
    and immediately calls `setModel` to the next healthy model **in the
    same tier** — pi's pending retry then continues with the fallback.
  - Cooldown-aware selection in `before_agent_start` (`processRoute` and
    first-turn resolution) skips models in cooldown.
  - `after_provider_response` hook clears a model's cooldown on a 2xx
    response (immediate recovery).
  - **Judge uses the full fast-tier chain** — `resolveFastEndpoints()`
    resolves every fast model (priority order) and `classify()` walks it:
    a 429/5xx/timeout on the primary fast model falls back to the next
    one instead of giving up. The Judge shares the same cooldown map, so
    a model that fails the Judge is also skipped by routing.
  - `detectFailoverError` is signature-matching only (not a routing
    decision) — auth/config errors (400/401) never trigger failover.
  - `/route-force` (manual override) always bypasses cooldowns.
  - Toast notification on failover
    (`⚠️ M3 unavailable (429), switching to deepseek-v4-flash — retry in 1m`);
    `/router status` lists active cooldowns (`⏳ minimax/MiniMax-M3 — retry in 3m12s`).
  - New `src/failover.ts` module (pure functions, unit-tested):
    `markModelFailed`, `isModelInCooldown`, `clearModelCooldown`,
    `remainingCooldownMs`, `detectFailoverError`, `findFailoverModel`,
    `planTurnFailover`, `findTierForModel`.
- **56 new tests** (114 → 176): cooldown state machine, error signatures,
  same-tier fallback selection, turn-failure detection, cooldown-aware
  routing, manual-override bypass, tier reverse-lookup, Judge fast-chain
  fallback (429/5xx/timeout/unparseable), `resolveFastEndpoints` chain
  resolution.
- **`vitest.config.ts`**: sandbox-compatible worker pool (single-thread
  `threads`) + explicit `css: false`; added a valid empty `postcss.config.js`
  so vite stops searching parent directories.

### Changed

- `RouterState` gains `modelCooldowns: Map<string, CooldownEntry>`.
- `findBestModelForTier()` accepts an optional `isCooldown` predicate.
- `processRoute()` accepts an optional `now` parameter (testability).

## [0.5.0] — Multi-model fallback chain editor

### Added

- **Multi-model per tier with a hotkey-driven chain editor (TUI)** —
  `/router config <tier>` now opens a new in-TUI editor instead of single-model pick.
  - `a` add (opens the existing type-to-filter model picker)
  - `x` remove current
  - `K` / `J` swap current with previous / next (vim-style)
  - `d` save, `Esc` cancel
  - `↑↓` navigate, type-to-filter for adding
  - Schema already supported `models: ModelRef[]`; this surfaces the capability.
  - Non-TUI mode (non-interactive sessions) keeps the previous provider-grouped flow.
- **21 new tests** on chain-editor operations (59 → 80 total): add, remove,
  move-up, move-down, reassign-priorities, plus immutability and edge cases.

### Changed

- **License: Apache 2.0 → MIT** (more permissive for downstream use).
- **README.md + README.zh-CN.md:**
  - Tagline rewritten for SEO/GEO keywords (Pi coding agent, LLM judge,
    multi-model fallback, zero runtime deps).
  - JSON config example now shows multi-model per tier (priority array).
  - New **Fallback chains** subsection explaining chain semantics + hotkeys.
  - Module Map updated with `tui/fallback-chain-editor.ts`.
  - Roadmap updated: v0.4.0 / v0.4.1 marked shipped; v0.5.0 added.
- "How It Compares" table: removed `~$0.0006/call` pricing claim (kept neutral
  "a few thousand tokens per call") to comply with pricing-sensitivity guidelines.
- Chinese README: comparison-table "路由维度" column corrected from "复杂度"
  to "心智模式" (was inconsistent with the English version).
- Chinese README `命令` table: added `/route-force <provider>/<model>` variant.
- `scripts/pack-check.mjs`: dropped unused `typeImportPatterns` (LSP hint).

### Fixed

- **Judge prompt now respects user explicit intent about model quality.**
  When the user asks for "use the strongest model", "think carefully",
  "最强大模型", "仔细想想", or any equivalent phrasing in any language,
  the Judge classifies the turn as `smart` regardless of whether the
  underlying task is execution-heavy. Conversely, explicit asks for speed
  ("just give me a quick answer", "别想太多") route to `fast`. The prompt
  now lists four classification signals (task content, user intent,
  stakes/reversibility, ambiguity) with explicit conflict-resolution
  priority. This is implemented at the prompt level (LLM-as-classifier),
  not via regex/keyword matching, to keep the LLM as the sole classifier.
- **Chain editor reorder hotkey silently failed on many terminals.**
  The first attempt matched `data === "K"` (uppercase Shift+k), which only
  worked when the terminal emitted Shift+k as a literal `"K"`. The second
  attempt used the ANSI Shift+↑/↓ escape sequences (`\x1b[1;2A` /
  `\x1b[1;2B`), but macOS Terminal.app and several other terminals send
  the *same* sequence for Shift+↑ and plain ↑, so reorder still did not
  fire. Root cause: any modifier+arrow chord (Shift/Alt/Ctrl+arrow) is
  not portable across terminals. **Final fix: reorder now uses plain
  `J` / `K` keys** (vim-style: `k` = up, `j` = down) — no Shift needed,
  identical on every terminal, case-insensitive (`j`/`J`/`k`/`K` all
  work). Shift+↑↓ escape sequences are still accepted as a best-effort
  fallback where the terminal supports them. The J/K check runs before
  navigation (pi-tui's vim-mode may also bind j/k to select-up/down).
  Single-letter keys display uppercase (TUI convention) while remaining
  case-insensitive at the input layer.
- README's **Local install** section rewritten to avoid the
  `.pi/extensions/<name>.ts` symlink pattern — the original guidance caused
  duplicate plugin instances (`router:1` + `router:2`) when developing from a
  project directory that already contained the local bridge file alongside the
  npm-installed copy. New flow uses `pi install <path>` for dev iteration.
- Added README section **Releasing a new version** documenting the publish flow
  (npm version bump → prepublishOnly → publish → tag → push).

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
