# Model Pairings

> This page teaches **how to choose**, not **how to fill** — your provider setup is yours. Data is snapshotted from [models.dev](https://models.dev/) on 2026-08-05; refresh with `curl -s https://models.dev/api.json | jq` to see the latest.

## Two rules of thumb

> **Fast tier**: if your provider exposes `deepseek-v4-flash` (2026-07), prefer it for `fast` — the 0731 refresh pushed quality close to Opus 5 / GLM-5.2 territory while keeping prices at the low end of the table.
>
> **Smart tier**: keep `smart` on a frontier cloud model. Local smart is impractical on hardware under ~80 GB of VRAM/unified memory, and even at 96 GB the cost/quality trade-off almost never beats a flat-fee token plan.

## Pattern 1 — Token-plan bundles (one key, many models)

Candidate model IDs you can mix across the chain — not a single canonical pairing. The providers below are well-known aggregate / token-bundle gateways that proxy Anthropic, OpenAI, Google, DeepSeek, xAI, Z.AI, Qwen, Moonshot, and others under one billing account.

| Plan | `fast` candidates 🦾 | `smart` candidates 🧠 |
|---|---|---|
| **Alibaba Token Plan** (intl + CN) | `qwen3.7-plus`, `qwen3.6-flash`, `deepseek-v4-flash` | `qwen3.8-max`, `qwen3.7-max`, `kimi-k3` |
| **Vercel AI Gateway** | any of the providers below through one gateway | any of the providers below |
| **OpenRouter** | 200+ models; `auto` is **not** a valid Judge target (opaque) | 200+ models |
| **Hugging Face Inference** | `Qwen/Qwen3.5-9B`, `Qwen/Qwen3.6-35B-A3B` | `Qwen/Qwen3.6-27B`, `google/gemma-4-31B-it` |
| **Nebius Token Factory** | `deepseek-ai/DeepSeek-V4-Flash`, `moonshotai/Kimi-K2.7-Code` | `Kimi-K3`, `zai-org/GLM-5.2`, `Qwen/Qwen3.7-Max` |
| **NovitaAI** | `deepseek-ai/DeepSeek-V4-Flash`, `Qwen/Qwen3.6-27B` | `moonshotai/Kimi-K3`, `Qwen/Qwen3.7-Max` |

## Pattern 2 — Local models by VRAM / unified memory

All picks below were verified against HuggingFace's `safetensors` total weight size on 2026-08. Older generations (2025 and earlier), end-device outputs (<7 B), and pre-Qwen3.5 / pre-DeepSeek-V3 models were excluded as too dated.

> fp16 is a benchmark artifact, not a runtime format. Production local deployments use **q4-k-m / NVFP4 / MXFP4 / AWQ-int4 / 1–2 bit ternary**. Nothing in `fast` below runs at fp16.
>
> The `AxxB` suffix on a MoE model name means **active parameters per token**. `DeepSeek-V4-Flash-0731` is 83.4 B total / ~13 B active; int4 disk = 41.7 GB. Quant size scales with **active parameters**, not total.

| VRAM / unified memory | Local `fast` candidates | Quant | Local `smart` candidates (64 GB+) |
|---|---|---|---|
| **≤ 16 GB** (RTX 4070 12 GB, M-series 16 GB entry tiers) | `LiquidAI/LFM2.5-8B-A1B` (8.5 B total, 2026-05), `ibm-granite/granite-4.1-8b` (8.8 B, 2026-04), `ornith-ai/Ornith-1.0-9B-GGUF` (~9 B Q4_K_M ≈ 5.6 GB) | q4-k-m | — |
| **16–32 GB** (RTX 4090 24 GB, M3 Pro 18 GB, M4 Pro 24 GB) | `Qwen/Qwen3.6-27B` (27.8 B, q4 ≈ 14 GB, current HF top), `Qwen/Qwen3.8-27B` (27 B-class, when released — watch the Qwen org page), `nvidia/Qwen3.6-27B-NVFP4` (NVFP4 ≈ 14 GB), `google/gemma-4-26b-a4b-it` (26.5 B, q4 ≈ 13 GB), `Qwen/Qwen3.6-35B-A3B` (36 B, q4 ≈ 18 GB) | q4-k-m / NVFP4 | — |
| **32–64 GB** (M2 Ultra 64 GB, RTX 4090 48 GB) | `nvidia/NVIDIA-Nemotron-3-Nano-Omni-30B-A3B-Reasoning` (30 B q4 ≈ 15 GB), `google/gemma-4-31B-it` (31.3 B q4 ≈ 16 GB) | NVFP4 / q4-k-m | — |
| **64–128 GB** (A100 80 GB, RTX 6000 Ada 48 GB ×2) | `poolside/Laguna-XS-2.1` (33.4 B q4 ≈ 17 GB, 2026-06), `farbodtavakkoli/OTel-2.0-LLM-31B-IT` (32.1 B q4 ≈ 16 GB, Gemma4 base, 2026-07) | q4-k-m / NVFP4 | `prism-ml/Bonsai-27B-gguf` (27 B, 1.71-bit ternary ≈ 6 GB on disk, runs on a phone; on 64 GB use the 2-bit MLX/GGUF for quality, 2026-07), `ornith-ai/Ornith-1.0-35B-GGUF` (35 B MoE multimodal, 2026-06), `InternScience/Agents-A1` (35.1 B MoE agentic, q4-k-m ≈ 18 GB, 2026-06) |
| **≥ 128 GB** (M3 Ultra 192 GB, M2 Ultra 192 GB, **NVIDIA DGX Spark 128 GB GB10 unified**, RTX 4090 ×4) | `poolside/Laguna-S-2.1` (117.6 B q4 ≈ 59 GB, 2026-07), `mistralai/Mistral-Medium-3.5-128B` (127.7 B q4 ≈ 64 GB, 2026-03) | q4 / NVFP4 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` (120 B, NVFP4 ≈ 60 GB), `nvidia/DeepSeek-V4-Flash-NVFP4` (83.4 B / ~13 B active, NVFP4, 2026-05-18, NVIDIA-published), `unsloth/DeepSeek-V4-Flash-GGUF` (83.4 B / ~13 B active, q4 ≈ 42 GB, 2026-07), `bartowski/DeepSeek-V4-Flash-0731-GGUF` (83.4 B / ~13 B active, q4 0731 refresh, 2026-07-31), `Qwen/Qwen3.6-27B-FP8` (NVFP4-equivalent ~14 GB) |

Notes:

- **Quantized variants ship as separate HF repos**: `nvidia/Qwen3.6-35B-A3B-NVFP4`, `cyankiwi/Qwen3.6-27B-AWQ-INT4`, `OsaurusAI/Ornith-1.0-35B-MXFP4`, `prism-ml/Bonsai-27B-gguf`, `poolside/Laguna-S-2.1-NVFP4` — ollama / vLLM / MLX pick them up automatically.
- **Any runtime exposing an OpenAI-compatible API works** — the plugin binds to none specifically. Common choices: **ollama** (`ollama run qwen3.6:27b` → server on `:11434`), **LM Studio** (MLX + GGUF), **vLLM**, **llama.cpp** / **llama-server**, **exo**, **llamafile**.
- **The Judge also needs a JSON-mode endpoint.** Qwen 3.5+ and Gemma 4 expose `tool_call=true`, so they satisfy the constraint — but a local Judge adds ~0.5–2 s per turn. Recommended: local `fast` + local-or-cloud `smart` + Judge on whichever `smart` you trust most.

## Pattern 3 — Same-provider tier ladder (simplest)

One provider, one bill, one rate-limit pool. Use this if you already have a paid account and don't want to juggle keys.

| Provider | `fast` 🦾 | `smart` 🧠 | Note |
|---|---|---|---|
| **Anthropic** | `claude-sonnet-5` | `claude-opus-5` or `claude-fable-5` | Sonnet 5 is the current `fast` tier. |
| **OpenAI** | `gpt-5.6-luna` | `gpt-5.6-sol` | GPT-5.6 has `luna` < `terra` < `sol` internal tiering. |
| **Google** | `gemini-3.5-flash-lite` | `gemini-3.6-flash` | Gemini 3.x, 1 M context on both tiers. |
| **Qwen (Alibaba)** | `qwen3.7-plus` | `qwen3.8-max` | Native `plus` / `max` split. |
| **DeepSeek** | `deepseek-v4-flash` | `deepseek-v4-pro` | `flash` ≈ mini pricing tier, `pro` ≈ flagship. |
| **Z.AI (GLM)** | `glm-5` or `glm-5-turbo` | `glm-5.2` | GLM-5 series. |
| **xAI (Grok)** | `grok-4.5-fast` | `grok-4.5` | Grok 4.5 generation. |

## Pattern 4 — Cross-provider pairing (best-of-breed)

When you want the strongest model in each tier, regardless of who sells it. The default `fast` pick below is `deepseek-v4-flash` wherever available; the default `smart` pick is `claude-opus-5`, with `gpt-5.6-sol` and `kimi-k3` as cross-provider fallbacks.

| Scenario | `fast` 🦾 | `smart` 🧠 |
|---|---|---|
| Coding + lowest cost | `deepseek/deepseek-v4-flash` | `anthropic/claude-opus-5` |
| Coding + multi-provider fallback | `deepseek-v4-flash` + `glm-5.2` (fallback) | `claude-opus-5` + `gpt-5.6-sol` + `kimi-k3` (fallback chain) |
| Coding + flat-fee (best $/quality) | `alibaba-token-plan/deepseek-v4-flash` | `alibaba-token-plan/qwen3.8-max` |
| 1 M context, long repo / PDF research | `deepseek-v4-flash` | `google/gemini-3.6-pro` or `kimi-k3` |
| Multimodal (image / video) | `deepseek-v4-flash` | `anthropic/claude-opus-5` (vision) or `google/gemini-3.6-pro` |
| Multilingual, Chinese-first | `deepseek-v4-flash` | `alibaba/qwen3.8-max` |
| Europe / GDPR preference | `deepseek-v4-flash` (via OpenRouter) | `mistral/mistral-medium-2604` |

---

For live pricing and the full catalog per provider, see [models.dev](https://models.dev/). Model IDs above are real as of the snapshot date; if a provider returns `model_not_found`, run `curl -s https://models.dev/api.json | jq '.<provider>.models | keys'` and update.
