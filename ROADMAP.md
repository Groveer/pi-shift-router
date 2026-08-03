# Roadmap

Release history and planned work for **pi-shift-router**.

## Released

| Version | Highlights | Status |
|---------|-----------|--------|
| v0.1.0 | Core engine + LLM Judge | ✅ |
| v0.2.0 | TUI model picker + wizard | ✅ |
| v0.3.0 | Two-tier redesign (CTO / Programmer) | ✅ |
| v0.3.1 | Judge JSON-mode + judging indicator + verbose log | ✅ |
| v0.4.0 | First npm publish (international docs + i18n + CI) | ✅ |
| v0.4.1 | Runtime `Cannot find package` fix + `pack:check` guard | ✅ |
| v0.5.0 | Multi-model fallback chain editor | ✅ |
| v0.6.0 | Runtime failover (exponential backoff, same-tier) | ✅ |
| v0.7.0 | Confidence-weighted sliding window | ✅ |
| v0.8.0 | Token throughput + `/router stats` + Tuning Guide | ✅ |

## Planned

| Feature | Version | Notes |
|---------|---------|-------|
| Per-tier thinking level | v0.9.0 | `TierConfig.thinking`; `applyModelSwitch` sets `pi.setThinkingLevel`. Fast=off, Smart=high by default. Zero deps. |
| Cost telemetry — deep view | v0.9.0 | Smart vs Fast spend breakdown; estimate savings from tier transitions. |
| Multilingual Judge prompt validation | v0.9.0 | Test-driven: validate zh-CN / ja / es / fr prompt inputs. |
| Cache-aware routing | v1.0.0 | When fast/smart share provider family, raise downgrade threshold (0.6 → 0.9) to protect prompt cache. Pure logic, no heuristics. |
| Examples directory | ongoing | Sample configs (frontend / ML / cross-provider cost-saving) for documentation. |
| Coverage reporting | ongoing | Add `vitest --coverage` to CI; target ≥ 90% on `src/router.ts` and `src/failover.ts`. |

## Explicitly excluded (by design)

These are deliberate non-goals, kept consistent with SPEC §0 ("Design Philosophy") and `AGENTS.md`:

- **3-tier routing** — execution vs judgment is the only meaningful axis (SPEC v0.3.0).
- **Keyword/custom rules** — would violate "LLM Judge is the sole classifier" principle.
- **USD budget cap** — pi-shift-router is a routing layer, not a billing layer.
- **Heuristic Judge fallback** — the LLM Judge either returns or holds position; no keyword/length heuristics substitute.
- **Cross-session persistent state** — `session_start` is read-only by design; profile state stays session-scoped.
- **Local ML / ONNX inference** — a different design space; `pi-smart-router` already occupies it.
- **Runtime npm dependencies** — would violate "zero runtime deps" principle.

## See also

- [README.md](README.md) — user-facing docs
- [CHANGELOG.md](CHANGELOG.md) — per-version change log
- [SPEC.md](SPEC.md) — full design contract
- [AGENTS.md](AGENTS.md) — development principles