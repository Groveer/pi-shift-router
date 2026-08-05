<!--
SEO metadata (not user-visible, parsed by crawlers / LLMs):
- name: pi-shift-router
- type: software / npm package / pi-coding-agent extension
- license: MIT
- language: TypeScript
- runtime: Node.js >= 24
- dependencies: zero runtime deps
- npm: https://www.npmjs.com/package/pi-shift-router
- repo: https://github.com/green-dalii/pi-shift-router
- docs: README.md / README.zh-CN.md / SPEC.md / CONTRIBUTING.md
- first-published: v0.4.0
- latest: v0.6.0
- features: two-tier routing, LLM judge, JSON-mode classifier, sliding-window
  downgrade gate, multi-model fallback chains, TUI chain editor,
  exponential-backoff runtime failover (429/5xx), shared cooldown map
  between routing and Judge, zero-config defaults, cross-provider native
- complementary: pi-model-router (3-tier + budget + rules), pi-smart-router (ML inference, local ONNX)
- author: green-dalii (https://github.com/green-dalii)
-->

# pi-shift-router

> Auto-routing Pi coding agent turns between fast execution and smart reasoning models — an LLM judge picks the right tier per turn, multi-model fallback chains keep you running, zero runtime dependencies.

[![npm](https://img.shields.io/npm/v/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![Downloads](https://img.shields.io/npm/dm/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Pi Agent](https://img.shields.io/badge/pi--agent-extension-purple)](https://github.com/earendil-works/pi-coding-agent)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-green)](https://nodejs.org)
[![CI](https://img.shields.io/github/actions/workflow/status/green-dalii/pi-shift-router/ci.yml)](https://github.com/green-dalii/pi-shift-router/actions)
[![Stars](https://img.shields.io/github/stars/green-dalii/pi-shift-router.svg)](https://github.com/green-dalii/pi-shift-router)

[English] | [简体中文](README.zh-CN.md)

---

## TL;DR

- **What it is** — A [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension that routes every turn to either a fast execution model or a smart judgment model.
- **How it works** — Before each turn, a small LLM Judge (the fast-tier model itself) classifies the task as `fast` or `smart`.
- **Reliability** — Multi-model fallback chains per tier + exponential-backoff cooldown on 429/5xx — turns keep flowing when one provider rate-limits.
- **Zero dependencies** — Pure TypeScript. Single `npm install`, two-tier config, done.
- **Stable since** — v0.4.0 (npm, MIT, 202 unit tests, Node 24+).

### In pi, it looks like this

```text
🦾 [MiniMax-M3] → fix the failing test
⚖ judging…
🧠 [kimi-k3]              ← upgraded for the architecture question
⚠️ MiniMax-M3 429 → switching to deepseek-v4-flash — retry in 1m
🦾 [deepseek-v4-flash]     ← same-tier failover (v0.6.0)
```

Status bar badge changes tier automatically; toasts explain any switch.

---

## Contents

- [What it does](#what-it-does)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Commands](#commands)
- [Configuration](#configuration)
- [Recommended Model Pairings](#recommended-model-pairings)
- [How It Compares](#how-it-compares)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

---

## What it does

**pi-shift-router** classifies every turn by **mental mode** and routes between two models:

| | Tier | Emoji | When |
|---|------|-------|------|
| Execution mode | **Fast** | 🦾 | Coding, debugging, tests, docs, following patterns |
| Judgment mode | **Smart** | 🧠 | Architecture, review, planning, security audit |

**Zero behavior change by default** — both tiers start empty. The router does nothing until you assign models via `/router config`.

> **Smart = CTO** (judgment, architecture, review, planning)
> **Fast = Programmer** (execution, coding, debugging, testing)

Not every task needs a CTO. But projects without CTO oversight don't sustain quality.

---

## Quick Start

**Prerequisites** — Node.js ≥ 24, pi-agent ≥ 0.80, one provider account with API key in pi-agent's `auth.json`, one model for each tier.

**Install**

```bash
pi install npm:pi-shift-router
```

Registers in `~/.pi/agent/settings.json` and auto-loads on next pi launch. See [pi's packages docs](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/packages.md) for git / local-path install.

**Configure**

Inside pi, run `/router config` and pick one Fast + one Smart model. Save to user or project scope.

**Verify**

`/router status` shows your tiers and models; the next turn triggers the first Judge call.

---

## How It Works

```mermaid
flowchart TD
    Input["User sends a message"]
    Input --> Hook["before_agent_start fires"]
    Hook --> Enabled{"Router enabled?"}
    Enabled -->|No| Skip["pi uses default model"]
    Enabled -->|Yes| Judge["LLM Judge (Fast tier's model, JSON mode)"]
    Judge --> Fail{"Judge OK?"}
    Fail -->|No| Fallback["Hold position — stay on current tier"]
    Fail -->|Yes| Decide
    Decide{"Classified as?"}
    Decide -->|Smart & on Fast| Upgrade["UPGRADE → Smart model (immediate)"]
    Decide -->|Fast & on Smart| Trend["Check sliding window"]
    Decide -->|Same as current| Stay["STAY — no switch"]
    Trend --> Stable{"Fast ≥60% of last 5?"}
    Stable -->|Yes| Down["DOWNGRADE → Fast model"]
    Stable -->|No| Stay
    Upgrade & Down --> Failover["On 429/5xx: mark cooldown + switch to next healthy model in tier"]
    Failover & Stay --> Done["Agent processes with selected model"]
```

Three properties that matter:

- **Upgrades are immediate** (Fast → Smart). Quality first.
- **Downgrades need sustained trend** (≥60% of last 5 turns are Fast). Cache protection.
- **One classification per turn.** No thrashing during tool calls.

**JSON-mode enforcement** (not just prompt instructions): OpenAI-compatible APIs use `response_format: { type: "json_object" }` (the API rejects non-JSON completions); Anthropic uses assistant prefill `{` to force JSON-start output. While the Judge is in flight, the status bar shows `⚖ judging…`.

### Runtime failover (v0.6.0)

When the primary model hits 429 / 5xx / quota / Token-Plan exhaustion, pi retries first (provider ×3, agent ×3), then the router takes over:

1. Mark the failing model into **exponential-backoff cooldown** (1m, 2m, 4m, … capped at 30m).
2. Immediately `setModel` to the next healthy model **in the same tier** (no cross-tier).
3. pi's pending retry continues with the fallback — same-turn failover.
4. Subsequent turns skip cooled models in `before_agent_start`.
5. A 2xx response clears the cooldown; session restart resets everything.

The Judge also walks the full fast-tier chain before giving up, sharing the same cooldown map as routing. Manual override (`/route-force`) always bypasses cooldowns. Auth/config errors (400/401) never trigger failover.

---

## Commands

| Command | What it does |
|---------|--------------|
| `/router status` | Show tier, model, window, config summary |
| `/router on` / `/router off` | Enable / disable routing |
| `/router config` | Launch the TUI configuration wizard |
| `/router quiet` | Toggle inline toast notifications |
| `/router verbose` | Toggle verbose console logging |
| `/route-force <tier>` | Pin Smart or Fast for the next turn |
| `/route-force <provider>/<model>` | Pin a specific model for the next turn |
| `/route-force auto` | Clear manual override |

---

## Configuration

Two-layer config: user (`~/.pi/agent/pi-shift-router.json`) + project (`<cwd>/.pi/pi-shift-router.json`). Project wins on conflict.

```json
{
  "enabled": true,
  "tiers": {
    "fast":  { "models": [
      { "provider": "deepseek", "model": "deepseek-v4-flash", "priority": 1 },
      { "provider": "kimi",     "model": "kimi-k3",          "priority": 2 }
    ] },
    "smart": { "models": [{ "provider": "kimi", "model": "kimi-k3", "priority": 1 }] }
  },
  "routing": { "mode": "auto", "judgeTimeout": 5000, "window": { "size": 5, "threshold": 0.6 } },
  "ux": { "quietMode": false, "statusBar": true, "inlineToast": true, "routerLogVerbose": false }
}
```

| Field | Default | Meaning |
|-------|---------|---------|
| `enabled` | `true` | Master switch. Use `/router off` to disable. |
| `tiers.<tier>.models[]` | `[]` | Ordered by `priority`. First hit wins; rest are run-time fallbacks. |
| `routing.judgeTimeout` | `5000` | ms. Judge API call timeout. |
| `routing.window.size` / `threshold` | `5` / `0.6` | Sliding-window downgrade gate. |
| `ux.quietMode` / `statusBar` / `inlineToast` / `routerLogVerbose` | various | Surface controls. |

Each tier's `models` array is an **ordered priority list** — first entry is the primary; later entries stand by as fallback. Configure multiple models via `/router config`'s TUI chain editor (`a` add, `x` remove, `J`/`K` reorder, `d` save, `Esc` cancel).

---

## Recommended Model Pairings

No JSON snippets here — your provider setup is yours. This section teaches **how to choose**, not **how to fill**. Data is snapshotted from [models.dev](https://models.dev/) on 2026-08-05; refresh with `curl -s https://models.dev/api.json | jq` to see the latest.

> **Fast tier rule of thumb**: if your provider exposes `deepseek-v4-flash-0731` (2026-07-31), prefer it for `fast` — the 0731 update pushed quality close to Opus 4.8 / GLM-5.2 territory while keeping prices at the low end of the table.
>
> **Smart tier rule of thumb**: keep `smart` on a frontier cloud model. Local smart is impractical on hardware under ~80 GB of VRAM/unified memory, and even at 96 GB the cost/quality tradeoff almost never beats a flat-fee token plan.

### Pattern 1 — Token-plan bundles (one key, many models)

Combines an Alibaba international/CN entry into one row (same product, two regional endpoints). Lists candidate model IDs you can mix across the chain — not a single canonical pairing.

| Plan | `fast` candidates 🦾 | `smart` candidates 🧠 |
|---|---|---|
| **Alibaba Token Plan** (intl + CN) | `qwen3.7-plus`, `qwen3.6-flash`, `deepseek-v4-flash-0731` | `qwen3.8-max`, `qwen3.7-max`, `kimi-k2.7-code` |
| **OpenCode Go** | `deepseek-v4-flash`, `gpt-5.6-luna (2× usage)`, `hy3`, `qwen3.6-plus` | `qwen3.7-max`, `qwen3.8-max`, `kimi-k3`, `grok-4.5`, `glm-5.2` |
| **OpenCode Zen** (free tier included) | `deepseek-v4-flash-free`, `ling-3.0-flash-free`, `laguna-s-2.1-free`, `gemini-3.5-flash-lite` | `claude-opus-5`, `kimi-k3`, `gpt-5.6-sol`, `glm-5.2` |
| **Moonshot Token Plan** | `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` | `kimi-k3` |
| **MiniMax Token Plan** | `MiniMax-M2.7-highspeed` | `MiniMax-M3` (1 M ctx, multimodal) |
| **Xiaomi Token Plan** | `mimo-v2.5` | `mimo-v2.5-pro` |
| **Vercel AI Gateway** | any of the above through one gateway | any of the above |
| **OpenRouter** | 337 models; `auto` is **not** a valid Judge target (opaque) | 337 models |
| **Hugging Face Inference** | `Qwen/Qwen3.5-9B`, `Qwen/Qwen3.6-35B-A3B` | `Qwen/Qwen3.6-27B`, `google/gemma-4-31B-it` |
| **Nebius Token Factory** | `deepseek-ai/DeepSeek-V4-Flash-0731`, `moonshotai/Kimi-K2.7-Code` | `Kimi-K3`, `MiniMaxAI/MiniMax-M3`, `zai-org/GLM-5.2` |
| **NovitaAI** | `inclusionai/ling-2.6-flash`, `qwen/qwen3.5-27b` | `qwen/qwen3.7-max`, `moonshotai/kimi-k3` |

### Pattern 2 — Local models by VRAM / unified memory

All picks below were verified against HuggingFace's `safetensors` total weight size on 2026-08. 

> fp16 is a benchmark artifact, not a runtime format. Production local deployments use **q4-k-m / NVFP4 / MXFP4 / AWQ-int4 / 1–2 bit ternary**. The table below reflects that — nothing in `fast` runs at fp16.
>
> The `AxxB` suffix on a MoE model name means **active parameters per token**. `DeepSeek-V4-Flash-0731` is 83.4 B total / ~13 B active; int4 disk = 41.7 GB. Quant size scales with **active parameters**, not total.

| VRAM / unified memory | Local `fast` candidates | Quant | Local `smart` candidates (64 GB+) |
|---|---|---|---|
| **≤ 16 GB** (RTX 4070 12 GB, M-series 16 GB entry tiers) | `LiquidAI/LFM2.5-8B-A1B` (8.5 B total, 2026-05), `ibm-granite/granite-4.1-8b` (8.8 B, 2026-04), `ornith-ai/Ornith-1.0-9B-GGUF` (~9 B Q4_K_M ≈ 5.6 GB) | q4-k-m | — |
| **16–32 GB** (RTX 4090 24 GB, M3 Pro 18 GB, M4 Pro 24 GB) | `Qwen/Qwen3.6-27B` (27.8 B, q4 ≈ 14 GB, current HF top), `Qwen/Qwen3.8-27B` (27 B-class, when released — watch the Qwen org page), `nvidia/Qwen3.6-27B-NVFP4` (NVFP4 ≈ 14 GB), `google/gemma-4-26b-a4b-it` (26.5 B, q4 ≈ 13 GB), `Qwen/Qwen3.6-35B-A3B` (36 B, q4 ≈ 18 GB) | q4-k-m / NVFP4 | — |
| **32–64 GB** (M2 Ultra 64 GB, RTX 4090 48 GB) | `nvidia/NVIDIA-Nemotron-3-Nano-Omni-30B-A3B-Reasoning` (30 B q4 ≈ 15 GB), `google/gemma-4-31B-it` (31.3 B q4 ≈ 16 GB) | NVFP4 / q4-k-m | — |
| **64–128 GB** (A100 80 GB, RTX 6000 Ada 48 GB ×2) | `poolside/Laguna-XS-2.1` (33.4 B q4 ≈ 17 GB, 2026-06), `farbodtavakkoli/OTel-2.0-LLM-31B-IT` (32.1 B q4 ≈ 16 GB, Gemma4 base, 2026-07) | q4-k-m / NVFP4 | `prism-ml/Bonsai-27B-gguf` (27 B, 1.71-bit ternary ≈ 6 GB on disk, runs on phone; on 64 GB use the 2-bit MLX/GGUF for quality, 2026-07), `ornith-ai/Ornith-1.0-35B-GGUF` (35 B MoE multimodal, 2026-06), `InternScience/Agents-A1` (35.1 B MoE agentic, q4-k-m ≈ 18 GB, 2026-06) |
| **≥ 128 GB** (M3 Ultra 192 GB, M2 Ultra 192 GB, **NVIDIA DGX Spark 128 GB GB10 unified**, RTX 4090 ×4) | `poolside/Laguna-S-2.1` (117.6 B q4 ≈ 59 GB, 2026-07), `mistralai/Mistral-Medium-3.5-128B` (127.7 B q4 ≈ 64 GB, 2026-03) | q4 / NVFP4 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` (120 B, NVFP4 ≈ 60 GB), `nvidia/DeepSeek-V4-Flash-NVFP4` (83.4 B / ~13 B active, NVFP4, 2026-05-18, NVIDIA-published), `unsloth/DeepSeek-V4-Flash-GGUF` (83.4 B / ~13 B active, q4 ≈ 42 GB, 2026-07), `bartowski/DeepSeek-V4-Flash-0731-GGUF` (83.4 B / ~13 B active, q4 0731 refresh, 2026-07-31), `Qwen/Qwen3.6-27B-FP8` (NVFP4-equivalent ~14 GB) |

Notes:

- **Quantized variants ship as separate HF repos**. `nvidia/Qwen3.6-35B-A3B-NVFP4`, `cyankiwi/Qwen3.6-27B-AWQ-INT4`, `OsaurusAI/Ornith-1.0-35B-MXFP4`, `prism-ml/Bonsai-27B-gguf`, `poolside/Laguna-S-2.1-NVFP4` — ollama / vLLM / MLX pick them up automatically.
- **Pick a runtime that exposes an OpenAI-compatible API** — the plugin does not bind to any specific one. Common choices: **ollama** (`ollama run qwen3.6:27b` → server on `:11434`), **LM Studio** (MLX + GGUF), **vLLM**, **llama.cpp** / **llama-server**, **exo**, **llamafile**.
- **Judge also needs a JSON-mode endpoint**. Qwen 3.5+ and Gemma 4 expose `tool_call=true`, so they satisfy the Judge's JSON-mode constraint — but local Judge adds ~0.5–2 s per turn. Recommended: `fast` local + `smart` local-or-cloud + Judge on whichever `smart` you trust most.

### Pattern 3 — Same-provider tier ladder (simplest)

One provider, one bill, one rate-limit pool. Use this if you already have a paid account with the provider and don't want to juggle keys.

| Provider | `fast` 🦾 | `smart` 🧠 | Note |
|---|---|---|---|
| **Anthropic** | `claude-sonnet-5` | `claude-opus-5` or `claude-fable-5` | Haiku 4.5 is the old `fast` tier; Sonnet 5 replaced it. |
| **OpenAI** | `gpt-5.6-luna` | `gpt-5.6-sol` | GPT-5.6 has luna < terra < sol internal tiering. |
| **Google** | `gemini-3.5-flash-lite` | `gemini-3.6-flash` | Gemini 3.x, 1 M context on both tiers. |
| **Qwen (Alibaba)** | `qwen3.7-plus` | `qwen3.8-max` | Native `plus` / `max` split. |
| **Moonshot Kimi** | `kimi-k2.7-code` or `kimi-k2.7-code-highspeed` | `kimi-k3` | K2.7-code = `fast`, K3 = `smart`. |
| **DeepSeek** | `deepseek-v4-flash-0731` | `deepseek-v4-pro` | `flash` ≈ mini pricing tier, `pro` ≈ flagship. |
| **MiMo (Xiaomi)** | `mimo-v2.5` | `mimo-v2.5-pro` | v2.5 is the current generation. |
| **Z.AI (GLM)** | `glm-5` or `glm-5-turbo` | `glm-5.2` | GLM-5 series. |

### Pattern 4 — Cross-provider pairing (best-of-breed)

When you want the strongest model in each tier, regardless of who sells it. The default `fast` pick below is `deepseek-v4-flash-0731` wherever available.

| Scenario | `fast` 🦾 | `smart` 🧠 |
|---|---|---|
| Coding + lowest cost | `deepseek/deepseek-v4-flash-0731` | `anthropic/claude-opus-5` |
| Coding + flat-fee (best $/quality) | `alibaba-token-plan/deepseek-v4-flash-0731` | `alibaba-token-plan/qwen3.8-max` |
| 1 M context, long repo / PDF research | `deepseek-v4-flash-0731` | `moonshotai/kimi-k3` |
| Multimodal (image / video) | `deepseek-v4-flash-0731` | `minimax-cn/MiniMax-M3` |
| Multilingual, Chinese-first | `deepseek-v4-flash-0731` | `alibaba/qwen3.8-max` |
| Europe / GDPR preference | `deepseek-v4-flash-0731` (via OpenRouter) | `mistral/mistral-medium-2604` |
| Hardware-accelerated inference | `groq/deepseek-v4-flash-0731` or `groq/qwen3.6-27b` | `togetherai/deepseek-v4-flash-0731` |

---

For live pricing and the full model catalog per provider, see [models.dev](https://models.dev/). Model IDs above are real as of the snapshot date; if a provider returns `model_not_found`, run `curl -s https://models.dev/api.json | jq '.<provider>.models | keys'` and update.

---

## How It Compares

| | pi-shift-router (this plugin) | pi-model-router | pi-smart-router |
|---|---|---|---|
| **Tiers** | 2 (fast/smart) | 3 (high/medium/low) | n-stage ML pipeline |
| **Classifier** | LLM Judge (JSON mode) | Optional LLM classifier → heuristic fallback | ONNX + Aho-Corasick |
| **Custom rules** | — | Keyword overrides | — |
| **Budget cap** | — | USD session budget; auto-downgrades high→medium | — |
| **Phase memory** | Sliding window for downgrade gate | `phaseBias` stickiness across turns | — |
| **Persistence** | Session-scoped | Cross-session, cross-branch (`router-state`) | Per-session |
| **Runtime failover** | 429/5xx + exponential-backoff cooldown | Profile-level fallback chain | — |
| **Deps** | Zero runtime (TS only) | npm package on pi SDK | ONNX, SQLite, HF |

**Pick by need:**

- **pi-shift-router** — LLM-as-classifier with zero runtime deps and runtime failover (429/5xx cooldown).
- **pi-model-router** — 3-tier routing, USD budget cap, keyword rules, persistent state across branches.
- **pi-smart-router** — ML-optimized local inference (ONNX).

These are complementary, not competitive — they sit at different layers of the stack.

---

## FAQ

### What if I don't configure any models?

Both tiers start empty. The router is a no-op; pi uses its default model. Run `/router config`.

### Does the Judge add noticeable latency?

A Judge call costs a few thousand tokens at your Fast-tier pricing. End-to-end classification round-trip is typically 200ms–2s. The status bar shows `⚖ judging…` during the call.

### What if my primary model 429s or times out?

Exponential-backoff cooldown (v0.6.0): primary goes into cooldown (1m → 2m → 4m … capped 30m) and the next healthy model in the same tier takes over. A 2xx response clears the cooldown immediately.

### Does this work across different providers?

Yes. Each tier stores an ordered list of `{provider, model, priority}` pairs. Mix freely.

### Will it downgrade Smart prematurely?

Only when the **weighted** ratio of fast votes in the last 5 classified turns is ≥ `window.threshold` (default `0.6`). Low-confidence votes below `window.minConfidence` (default `0.5`) are ignored. Raise `threshold` to `0.8` to stay on Smart longer. Upgrades (Fast → Smart) are always immediate.

### What's the difference from `pi-model-router` and `pi-smart-router`?

They solve different problems and can be used together — see the [comparison table](#how-it-compares).

### Can I disable the router temporarily without uninstalling?

`/router off` disables for the current session; `/router on` re-enables. Toggle persists in the config file.

### Is there cost overhead from the Judge?

The Judge uses the Fast-tier model (typically your cheapest). Savings from avoiding unnecessary Smart-tier turns dwarf this cost.

---

## Troubleshooting

### Judge unparseable warning

- **Reasoning model ran out of tokens** — DeepSeek Reasoner emits `reasoning_content` then JSON in `content`. Router sets `max_tokens: 4000`; very long prompts may overflow. Run `/router verbose` to inspect.
- **Provider doesn't support JSON mode** — some custom OpenAI-compatible endpoints ignore `response_format`.
- **API key invalid** — check pi-agent's `auth.json`.

### "Judge fetch failed for … : TypeError: Cannot read 'slice' of undefined"

This was fixed in v0.8.0 (commit `de6073a`+). Root cause: `JSON.stringify(undefined)` returns `undefined`, not the string `"undefined"`. When the Judge endpoint returned 200 but with an error-shaped body (no `choices[]`), the verbose log crashed on `content.slice(...)`. Now wrapped in a `jsonStr()` helper that returns `"undefined"` for undefined input. If you still see this on older installed versions, reinstall with `pi remove pi-shift-router && pi install /Users/greener/project/slimrouter`.

### "No models match" in wizard

Models come from pi-agent's `models-store.json`. Restart pi-agent after adding a new provider.

### Status bar shows `⛔`

Router disabled — run `/router on`. If `enabled: true` in config but still shows `⛔`, check the `Config:` line in `/router status`.

### "Model not found" warning

Model ID doesn't exist in the provider. Update the ID or re-pick via `/router config` (only shows real models).

### Router keeps downgrading to Fast

Judge misclassifying (use `/router verbose`), or `window.threshold` too aggressive. Raise to `0.8`:

```json
"routing": { "window": { "size": 5, "threshold": 0.8, "minConfidence": 0.5 } }
```

---

## Acknowledgements

- **[pi-coding-agent](https://github.com/earendil-works/pi-coding-agent)** by earendil-works — the host agent.
- **[pi-tui](https://www.npmjs.com/package/@earendil-works/pi-tui)** — TUI primitives used by the model picker.
- **[pi-smart-router](https://github.com/beettlle/pi-smart-router)** — complementary ML-optimized inference routing (local ONNX).
- **[pi-model-router](https://github.com/yeliu84/pi-model-router)** — complementary 3-tier routing with USD budget + keyword rules.

---

**Author & License** — pi-shift-router by [green-dalii](https://github.com/green-dalii), licensed under [MIT](LICENSE) © 2026.