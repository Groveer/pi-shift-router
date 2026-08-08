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
| Cost telemetry — deep view | v0.8.4 | Smart vs Fast spend breakdown; `models-store.json` provides per-model pricing; pi-agent's `message_end.usage.cost.total` already gives per-message USD. Estimate savings as `actual_total` vs `what-it-would-have-cost-on-most-expensive-model-used`. |
| Multilingual Judge input regression | v0.8.4 | Tiny test suite (zh-CN / ja / es /fr prompts, 5–10 each) run through the real `classify()` to confirm classification is robust on multilingual user input. Not translations of `judge.md`. If a model drifts, improve `judge.md`'s language-neutrality. |
| Cache-aware routing | v1.0.0 | When fast/smart share provider family, raise downgrade threshold (0.6 → 0.9) to protect prompt cache. Pure logic, no heuristics. |
| Examples directory | ongoing | Sample configs (frontend / ML / cross-provider cost-saving) for documentation. |
| Coverage reporting | ongoing | Add `vitest --coverage` to CI; target ≥ 90% on `src/router.ts` and `src/failover.ts`. |

> **Withdrawn from earlier drafts.** Per-tier thinking level was proposed but is largely redundant — tier classification already encodes prompt complexity, so a static per-tier thinking rule rarely saves more than it complicates. Adaptive (per-prompt) thinking adds machinery without a clear win because the smart tier is already gated on real complexity. Dropped from v0.8.x.
>
> **Multilingual Judge *prompt* translation** was also dropped — generating zh / ja / es / fr versions of `judge.md` is solving a problem that doesn't exist (LLMs are multilingual; the English prompt works on non-English user input). Replaced with the input regression test above.

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