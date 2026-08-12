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
| v0.8.1 | Judge crash fix + README badges restored | ✅ |
| v0.8.2 | Docs + Judge prompt clarity (role-not-judgment framing) | ✅ |
| v0.8.3 | Judge cooldown sharing + README restructure + packaging | ✅ |
| v0.9.0 | Cost telemetry + `/router status` restructure + cooldown rescale (4xx/5xx split) | ✅ |
| v0.9.1 | Slogan philosophy + CTO/Engineer terminology unification | ✅ |
| v0.10.0 | Cache-aware routing (same-family threshold + warm-cache guard) + coverage reporting | ✅ |

## Planned

| Feature | Version | Notes |
|---------|---------|-------|
| Cost telemetry — deep view | v0.9.0 ✅ done | Smart vs Fast spend breakdown + savings vs **all-turns-on-smart** baseline (`config.tiers.smart.models[0]` pricing × session tokens). Data: pi-agent `message_end.usage.cost.total` + `models-store.json`. |
| Cooldown backoff rescale | v0.9.0 ✅ done | 4× multiplier, 6h cap, **4xx starts at 16m** (client-side rate limits outlive 5xx blips), 5xx keeps 1m. |
| Examples directory | ongoing | Sample configs (frontend / ML / cross-provider cost-saving) for documentation. |
| Tool-result classification | TBD | SPEC §9: classify tool calls (long shell output may indicate debugging, not a question). |
| Coverage reporting | ✅ done | `vitest --coverage` in CI (v8 provider, thresholds ≥90% lines/functions/statements, ≥85% branches on `src/router.ts` + `src/failover.ts`). Current: router 100% / failover 95.5%. |

> **Withdrawn from earlier drafts.** Per-tier thinking level was proposed but is largely redundant — tier classification already encodes prompt complexity, so a static per-tier thinking rule rarely saves more than it complicates. Adaptive (per-prompt) thinking adds machinery without a clear win because the smart tier is already gated on real complexity. Dropped from v0.8.x.
>
> **Multilingual Judge prompt/input work** was dropped on ROI grounds — LLMs are multilingual; generating zh / ja / es / fr versions of `judge.md` solves a problem that doesn't exist.

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