# 模型选型目录

> 本页只讲选型逻辑，不承诺固定搭配——各家 Provider 差异太大。数据快照于 [models.dev](https://models.dev/)，抓取时间 2026-08-05；用 `curl -s https://models.dev/api.json | jq` 看最新。

## 两条经验法则

> **Fast 档**：如果你使用的 Provider 提供 `deepseek-v4-flash`（2026-07 发布），fast 首选它 —— 0731 刷新把质量拉到了接近 Opus 5 / GLM-5.2 的水平，但价格仍处在表中低位。
>
> **Smart 档**：smart 始终走云。低于 ~80 GB 显存/统一内存的硬件跑本地 smart 极其不划算；96 GB 以上也几乎永远不如 flat-fee 套餐。

## Pattern 1 — Token-plan 套餐（一个 key 走多模型）

列出的是你可混合在 chain 中的候选 ID，不是唯一推荐搭配。下面这些 Provider 都是全球知名的聚合 / Token-bundle 网关，统一账号接入 Anthropic / OpenAI / Google / DeepSeek / xAI / Z.AI / Qwen / Moonshot 等。

| Plan | fast 🦾 候选 | smart 🧠 候选 |
|---|---|---|
| **Alibaba Token Plan**（intl + CN） | `qwen3.7-plus`、`qwen3.6-flash`、`deepseek-v4-flash` | `qwen3.8-max`、`qwen3.7-max`、`kimi-k3` |
| **Vercel AI Gateway** | 上述任意走同一网关 | 上述任意 |
| **OpenRouter** | 200+ 个模型；`auto` **不能**当 Judge target（不透明） | 200+ 个模型 |
| **Hugging Face Inference** | `Qwen/Qwen3.5-9B`、`Qwen/Qwen3.6-35B-A3B` | `Qwen/Qwen3.6-27B`、`google/gemma-4-31B-it` |
| **Nebius Token Factory** | `deepseek-ai/DeepSeek-V4-Flash`、`moonshotai/Kimi-K2.7-Code` | `Kimi-K3`、`zai-org/GLM-5.2`、`Qwen/Qwen3.7-Max` |
| **NovitaAI** | `deepseek-ai/DeepSeek-V4-Flash`、`Qwen/Qwen3.6-27B` | `moonshotai/Kimi-K3`、`Qwen/Qwen3.7-Max` |

## Pattern 2 — 本地模型按显存 / 统一内存分级

下列推荐均在 2026-08 针对 HuggingFace `safetensors` 权重大小逐个核实。2025 年及以前的旧型号、端侧产物（<7 B）以及 Qwen3.5 / DeepSeek-V3 之前的型号均已排除。

> fp16 只是 benchmark 产物，不是运行时格式。真实本地部署几乎全用 **q4-k-m / NVFP4 / MXFP4 / AWQ-int4 / 1–2 bit ternary**。下表 fast 档一律量化，不出现 fp16。
>
> MoE 型号名里的 `AxxB` 后缀表示**每个 token 激活的参数**。`DeepSeek-V4-Flash-0731` 总量 83.4 B / 激活 ~13 B；int4 磁盘 ≈ 41.7 GB。量化体积按**激活参数**算，不按总量。

| 显存 / 统一内存 | 本地 fast 🦾 候选 | 量化 | 本地 smart 🧠 候选（64 GB+） |
|---|---|---|---|
| **≤ 16 GB**（RTX 4070 12 GB、M 系列 16 GB 入门档） | `LiquidAI/LFM2.5-8B-A1B`（8.5 B、2026-05）、`ibm-granite/granite-4.1-8b`（8.8 B、2026-04）、`ornith-ai/Ornith-1.0-9B-GGUF`（~9 B Q4_K_M ≈ 5.6 GB） | q4-k-m | — |
| **16–32 GB**（RTX 4090 24 GB、M3 Pro 18 GB、M4 Pro 24 GB） | `Qwen/Qwen3.6-27B`（27.8 B、q4 ≈ 14 GB、当前 HF top）、`Qwen/Qwen3.8-27B`（27 B 级、发布后关注 Qwen 官方页面）、`nvidia/Qwen3.6-27B-NVFP4`（NVFP4 ≈ 14 GB）、`google/gemma-4-26b-a4b-it`（26.5 B、q4 ≈ 13 GB）、`Qwen/Qwen3.6-35B-A3B`（36 B、q4 ≈ 18 GB） | q4-k-m / NVFP4 | — |
| **32–64 GB**（M2 Ultra 64 GB、RTX 4090 48 GB） | `nvidia/NVIDIA-Nemotron-3-Nano-Omni-30B-A3B-Reasoning`（30 B q4 ≈ 15 GB）、`google/gemma-4-31B-it`（31.3 B q4 ≈ 16 GB） | NVFP4 / q4-k-m | — |
| **64–128 GB**（A100 80 GB、RTX 6000 Ada 48 GB ×2） | `poolside/Laguna-XS-2.1`（33.4 B q4 ≈ 17 GB、2026-06）、`farbodtavakkoli/OTel-2.0-LLM-31B-IT`（32.1 B q4 ≈ 16 GB、Gemma4 base、2026-07） | q4-k-m / NVFP4 | `prism-ml/Bonsai-27B-gguf`（27 B、1.71-bit ternary ≈ 6 GB、手机也能跑；64 GB 上用 2-bit MLX/GGUF 保留质量、2026-07）、`ornith-ai/Ornith-1.0-35B-GGUF`（35 B MoE 多模态、2026-06）、`InternScience/Agents-A1`（35.1 B MoE、agentic、q4-k-m ≈ 18 GB、2026-06） |
| **≥ 128 GB**（M3 Ultra 192 GB、M2 Ultra 192 GB、**NVIDIA DGX Spark 128 GB GB10 unified**、RTX 4090 ×4） | `poolside/Laguna-S-2.1`（117.6 B q4 ≈ 59 GB、2026-07）、`mistralai/Mistral-Medium-3.5-128B`（127.7 B q4 ≈ 64 GB、2026-03） | q4 / NVFP4 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`（120 B、NVFP4 ≈ 60 GB）、`nvidia/DeepSeek-V4-Flash-NVFP4`（83.4 B / 激活 ~13 B、NVFP4、2026-05-18、NVIDIA 发布）、`unsloth/DeepSeek-V4-Flash-GGUF`（83.4 B / 激活 ~13 B、q4 ≈ 42 GB、2026-07）、`bartowski/DeepSeek-V4-Flash-0731-GGUF`（83.4 B / 激活 ~13 B、q4、0731 刷新版、2026-07-31）、`Qwen/Qwen3.6-27B-FP8`（NVFP4-等价 ~14 GB） |

说明：

- **量化仓库以独立 HF repo 形式发布**：`nvidia/Qwen3.6-35B-A3B-NVFP4`、`cyankiwi/Qwen3.6-27B-AWQ-INT4`、`OsaurusAI/Ornith-1.0-35B-MXFP4`、`prism-ml/Bonsai-27B-gguf`、`poolside/Laguna-S-2.1-NVFP4`，ollama / vLLM / MLX 会自动识别。
- **任何暴露 OpenAI-compatible API 的运行时都可以**。常见选择：**ollama**（`ollama run qwen3.6:27b` 默认起 `:11434`）、**LM Studio**（MLX + GGUF）、**vLLM**、**llama.cpp** / **llama-server**、**exo**、**llamafile**。
- **Judge 也需要 JSON-mode 端点**。Qwen 3.5+ 和 Gemma 4 都 `tool_call=true`，满足 Judge 的 JSON-mode 约束；但本地 Judge 会增加 ~0.5–2 s/turn。推荐：本地 fast + 本地或云 smart + Judge 放在你最信任的 smart 上。

## Pattern 3 — 同 Provider 自带 tier ladder（最简）

一个 Provider、一张账单、一个限流池。已有某 Provider 付费账户且不想多 key 管理时用这个。

| Provider | fast 🦾 | smart 🧠 | 备注 |
|---|---|---|---|
| **Anthropic** | `claude-sonnet-5` | `claude-opus-5` 或 `claude-fable-5` | Sonnet 5 是当前 fast 档。 |
| **OpenAI** | `gpt-5.6-luna` | `gpt-5.6-sol` | GPT-5.6 内部 `luna` < `terra` < `sol` 三档。 |
| **Google** | `gemini-3.5-flash-lite` | `gemini-3.6-flash` | Gemini 3.x，两档均 1 M 上下文。 |
| **Qwen (Alibaba)** | `qwen3.7-plus` | `qwen3.8-max` | 原生 `plus` / `max` 分级。 |
| **DeepSeek** | `deepseek-v4-flash` | `deepseek-v4-pro` | `flash` ≈ mini 价格档，`pro` ≈ 旗舰。 |
| **Z.AI (GLM)** | `glm-5` 或 `glm-5-turbo` | `glm-5.2` | GLM-5 系列。 |
| **xAI (Grok)** | `grok-4.5-fast` | `grok-4.5` | Grok 4.5 代。 |

## Pattern 4 — 跨 Provider 拼装（最佳单项）

需要在两个档都拿到各 Provider 的最强能力。默认 fast 选 `deepseek-v4-flash`（只要有）；默认 smart 选 `claude-opus-5`，用 `gpt-5.6-sol` 与 `kimi-k3` 作跨 Provider fallback。

| 场景 | fast 🦾 | smart 🧠 |
|---|---|---|
| Coding + 最低价 | `deepseek/deepseek-v4-flash` | `anthropic/claude-opus-5` |
| Coding + 多 Provider fallback | `deepseek-v4-flash` + `glm-5.2`（fallback） | `claude-opus-5` + `gpt-5.6-sol` + `kimi-k3`（fallback chain） |
| Coding + flat-fee（最佳 $/质量） | `alibaba-token-plan/deepseek-v4-flash` | `alibaba-token-plan/qwen3.8-max` |
| 1 M 上下文、长 repo / PDF 研究 | `deepseek-v4-flash` | `google/gemini-3.6-pro` 或 `kimi-k3` |
| 多模态（图 / 视频） | `deepseek-v4-flash` | `anthropic/claude-opus-5`（视觉） 或 `google/gemini-3.6-pro` |
| 多语言、中文优先 | `deepseek-v4-flash` | `alibaba/qwen3.8-max` |
| 欧洲 / GDPR 优先 | `deepseek-v4-flash`（OpenRouter 转） | `mistral/mistral-medium-2604` |

---

实时定价与每个 Provider 完整模型列表见 [models.dev](https://models.dev/)。表中模型 ID 截至快照日均验证存在；若 Provider 返回 `model_not_found`，运行 `curl -s https://models.dev/api.json | jq '.<provider>.models | keys'` 查最新。
