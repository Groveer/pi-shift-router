# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2025-07-11

### Added

- Initial release of Smart Router for pi-agent.
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
