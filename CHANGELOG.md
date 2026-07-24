# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
