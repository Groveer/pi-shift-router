<!--
SEO 元数据（用户不可见，供爬虫 / LLM 解析）：
- name: pi-shift-router
- type: software / npm 包 / pi-coding-agent 扩展
- license: MIT
- language: TypeScript
- runtime: Node.js >= 24
- dependencies: 零运行时依赖
- npm: https://www.npmjs.com/package/pi-shift-router
- repo: https://github.com/green-dalii/pi-shift-router
- docs: README.md / README.zh-CN.md / SPEC.md / CONTRIBUTING.md
- first-published: v0.4.0
- latest: v0.8.2
- alternate-names: shift router, pi extension, model router, two-tier router, auto router, tier model router, model failover router
- search-intents: "自动路由 pi agent 每轮", "LLM 作为分类器", "两层模型路由", "遇 429 模型的自动 failover", "成本与质量模型选择", "pi-coding-agent 扩展", "模型冷却指数退避", "JSON-mode 分类器"
- features: 两层路由、LLM Judge、JSON-mode 分类器、滑动窗口降级门、多模型
  fallback 链、TUI chain 编辑器、指数退避运行时 failover（429/5xx）、路由与
  Judge 共享冷却、原生跨 Provider、零配置起步、token throughput 遥测、/router stats 命令
- direct-competitor: pi-model-router（三层 + 预算 + 关键词规则；同类问题，不同实现选择）
- author: green-dalii（https://github.com/green-dalii）
-->

# pi-shift-router

> 为 [pi-coding-agent](https://github.com/earendil-works/pi) 每轮自动分配 **fast Programmer** 或 **smart CTO** 角色。LLM Judge 判定本轮角色；多模型 fallback 链保证稳定性；零运行时依赖。**两层模型路由**，一个配置文件，零运行时依赖。

[![npm](https://img.shields.io/npm/v/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![Downloads](https://img.shields.io/npm/dm/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Pi Agent](https://img.shields.io/badge/pi--agent-extension-purple)](https://github.com/earendil-works/pi)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-green)](https://nodejs.org)
[![CI](https://img.shields.io/github/actions/workflow/status/green-dalii/pi-shift-router/ci.yml)](https://github.com/green-dalii/pi-shift-router/actions)
[![Stars](https://img.shields.io/github/stars/green-dalii/pi-shift-router.svg)](https://github.com/green-dalii/pi-shift-router)

[English](README.md) | [简体中文]

---

## 摘要

- **这是什么东西** — 一个 [pi-coding-agent](https://github.com/earendil-works/pi) 扩展，为每一轮任务自动挑选一个“角色”：**fast Programmer**（负责执行，套用已知模式写代码）和 **smart CTO**（负责复杂、高风险、不可逆的判断与决策）。注意 smart 角色不是个“裁判” —— 一旦被选中，它就是那个实际负责写代码、思考、调工具、干完全程活儿的模型。
- **怎么跑起来的** — 每一轮开始前，先用 Fast 模型本身做一次小型 LLM Judge，判断本轮该走 `fast` 还是 `smart`。判完之后，被选中的模型接管整轮 —— 所有的思考、所有的工具调用、所有的消息内容，都会在那个模型的智能水平上走完。
- **不会中途断掉** — 每层都有多模型 fallback 链；遇到 429/5xx 会指数退避冷却。一个 Provider 限流不会让任务停下来。
- **零依赖** — 纯 TypeScript，一个 `npm install`，配两层即可。
- **稳定状态** — 从 v0.4.0 起在 npm 发布（MIT / 204 个单测 / Node 24+）。

### 在 pi 里看起来是这样

```text
🦾 [deepseek-v4-flash] → 修这个失败的测试
⚖ judging…
🧠 [claude-opus-5]              ← 架构问题自动升级到 Smart
⚠️ deepseek-v4-flash 429 → switching to glm-5.2 — retry in 1m
🦾 [glm-5.2]                    ← 同层 failover（v0.6.0）
```

状态栏徽章自动跟着跳；切换时会有 toast 说明原因。

---

## 目录

- [摘要](#摘要)
- [它做什么](#它做什么)
- [快速开始](#快速开始)
  - [安装](#安装)
  - [验证](#验证)
- [工作原理](#工作原理)
- [命令](#命令)
- [配置参考](#配置参考)
- [模型选择推荐](#模型选择推荐)
- [对比一览](#对比一览)
- [常见问题](#常见问题)
- [调参指南](#调参指南)
- [故障排查](#故障排查)
- [致谢](#致谢)

---

## 它做什么

**pi-shift-router** 根据**“这件事该怎么干”**对每轮任务分类，在两个角色之间路由：

| 角色 | 档位 | Emoji | 选中后这一轮它实际干什么 | 什么时候用 |
|------|------|-------|------------------------------|--------|
| **Programmer** | Fast | 🦾 | 埋头执行：写代码、跑测试、修 bug、套既定模式 | 例行、路径明确、风险低 |
| **CTO** | Smart | 🧠 | 整轮接管：架构、设计 review、安全审计、多步规划、不可逆操作、深度思考 | 高风险、不可逆、路径不清，或你明说要“仔细想想” |

Fast 不是真的程序员 —— 它是个负责执行的模型；Smart 不是真的 CTO —— 它是个负责复杂判断的模型，而且 **它自己动手干所有活**（写代码、调工具、跑循环）。LLM Judge 只是每次轮开始前一次很轻的分类调用；分完之后被选中的档位整轮接管 agent run。

**默认什么都不做** —— 两层默认都是空的，你跑了配置才会生效。命令：`/router config`。

> **Smart = CTO**：活不多但每件都关键 —— 定方向、拍架构、审代码；风险高时亲自接管整轮。
> **Fast = Programmer**：活多、模式清晰 —— 写代码、跑测试、修 bug；路径清楚时亲自接管整轮。

不是每件事都需要 CTO 级别的智力。但项目要是没有 CTO 把关，质量底线撑不住。

---

## 快速开始

**你需要的** — Node.js ≥ 24、pi-agent ≥ 0.80、至少一个 Provider 账号（已经写在 pi-agent 的 `auth.json` 里）、每层至少一个模型。

### 安装

```bash
pi install npm:pi-shift-router
```

插件会被注册到 `~/.pi/agent/settings.json`，下次启动 pi 时自动加载。git 仓库安装或本地路径安装见 [pi 包管理文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)。

### 验证

打开 TUI 向导，为每层选一个 Fast 和 Smart 模型（多个也行，会组成 fallback 链）：

```text
/router config
```

存到用户作用域或项目作用域都行 —— 两边同时设的话，项目级优先。完整 JSON schema 见 [配置参考](#配置参考)。

接着跑：

```text
/router status
```

就能看到当前的 tier、作用城、配置的 Judge 阈值以及 streaming 遥测数据。下一轮发消息就会触发首次 Judge 调用。

---

## 工作原理

```mermaid
flowchart TD
    Input["用户发送消息"]
    Input --> Hook["before_agent_start 触发"]
    Hook --> Enabled{"路由器已启用？"}
    Enabled -->|否| Skip["pi 用默认模型"]
    Enabled -->|是| Judge["LLM Judge（Fast 层模型，JSON mode）"]
    Judge --> Fail{"Judge 成功？"}
    Fail -->|否| Fallback["保持当前挡位"]
    Fail -->|是| Decide
    Decide{"分类结果？"}
    Decide -->|Smart & 当前 Fast| Upgrade["升级 → Smart 模型（立即）"]
    Decide -->|Fast & 当前 Smart| Trend["检查滑动窗口"]
    Decide -->|与当前相同| Stay["保持（STAY）"]
    Trend --> Stable{"Fast ≥60% of last 5?"}
    Stable -->|是| Down["降级 → Fast 模型"]
    Stable -->|否| Stay
    Upgrade & Down --> Failover["遇 429/5xx：标记冷却 + 切到同层下一个健康模型"]
    Failover & Stay --> Done["Agent 用选中的模型处理"]
```

三个关键属性：

- **升级立即**（Fast → Smart）。质量优先。
- **降级需持续且高置信的趋势**（fast 投票加权比 ≥ `threshold` 默认 0.6；低于 `minConfidence` 的投票被忽略）。保护缓存。
- **每轮只分类一次** —— 不在 tool call 粒度上切换。

**JSON mode（API 层强制，非仅 prompt）**：OpenAI 兼容 API 用 `response_format: { type: "json_object" }`（API 直接拒绝非 JSON 输出）；Anthropic 用 assistant prefill `{` 强制 JSON 起始。Judge 调用期间状态栏显示 `⚖ judging…`。

### 运行时 Failover（v0.6.0）

Primary 模型遇到 429 / 5xx / 配额 / Token Plan 耗尽时，pi 先重试（provider ×3 + agent ×3），然后路由器接管：

1. 把失败模型标记进**指数退避冷却**（1m、2m、4m、… 封顶 30m）。
2. 立即 `setModel` 到**同一层**的下一个健康模型（不跨层）。
3. pi 待定的重试用 fallback 继续 —— 同轮 failover。
4. 后续轮次的 `before_agent_start` 跳过冷却中的模型。
5. 2xx 响应立即清除冷却；会话重启全部重置。

Judge 也走完整个 fast 链才放弃，与路由共享同一冷却表。手动覆盖（`/route-force`）始终绕过冷却。认证 / 配置错误（400/401）不触发 failover。

---

## 命令

| 命令 | 功能 |
|------|------|
| `/router status` | 显示当前挡位、模型、窗口状态、配置摘要 |
| `/router on` / `/router off` | 启用 / 停用路由 |
| `/router config` | 启动 TUI 配置向导 |
| `/router quiet` | 切换 toast 通知 |
| `/router verbose` | 切换 verbose 日志（调试） |
| `/route-force <tier>` | 临时锁定 Smart 或 Fast（一轮） |
| `/route-force <provider>/<model>` | 临时锁定指定 provider/model（一轮） |
| `/route-force auto` | 清除手动覆盖 |

---

## 配置参考

> **推荐配置方式：`/router config` —— TUI 向导。** 正常情况下不需要手写 JSON。仅在脚本化、跨机共享配置、固定到项目仓库时使用下方 JSON 参考。

**TUI 可配项（`/router config`）：**

- 总开关（`/router on` / `/router off`）
- 每层模型 chain —— 添加 / 删除 / 重排（`a`、`x`、`J`/`K`、`d` 保存、`Esc` 取消）
- 保存作用域：用户级（`~/.pi/agent/pi-shift-router.json`）或项目级（`<cwd>/.pi/pi-shift-router.json`）；项目级优先。

**只能手改 JSON 的项（高级，不在 TUI 里）：**

- `routing.judgeTimeout`、`routing.window.minConfidence`、`routing.window.threshold`
- `ux.quietMode`、`ux.routerLogVerbose`

手改后调一次 `/router config` 重新加载，或重启 pi。

### JSON Schema（参考）

两层文件，TUI 向导写入“常规项”，手写编辑“高级项”：

```text
~/.pi/agent/pi-shift-router.json         （用户级 —— 默认生效）
<cwd>/.pi/pi-shift-router.json           （项目级 —— 同名字段覆盖用户级）
```

```text
pi-shift-router.json
├── enabled                    boolean  总开关；默认 true
├── tiers
│   ├── fast
│   │   └── models[]           按优先级排序；首个为 primary，其余为 fallback
│   │       ├── provider       string   必须与 pi-agent 的 auth.json 中某个 Provider 对应
│   │       ├── model          string   该 Provider 下的模型 ID
│   │       └── priority       integer  1 = primary，2 = 第一个 fallback，…
│   └── smart                  与 fast 同形
├── routing
│   ├── mode                   "auto" | "manual"；默认 "auto"
│   ├── judgeTimeout           ms；默认 5000
│   └── window
│       ├── size               滑动窗口长度；默认 5
│       ├── threshold          Fast 份额权重上限，触发降级；默认 0.6
│       └── minConfidence      低于该置信度的投票被忽略；默认 0.5
└── ux
    ├── quietMode              静默 inline toast；默认 false
    ├── statusBar              显示 🦾 / 🧠 徽章；默认 true
    ├── inlineToast            模型切换提示；默认 true
    └── routerLogVerbose       调试日志；默认 false
```

**最小配置**（每层一个模型，其余全默认）：

```text
enabled:  true
tiers:
  fast:   [{ provider: openai, model: gpt-5.6-luna }]
  smart:  [{ provider: openai, model: gpt-5.6-sol }]
```

**多 Provider + 每层 fallback chain**（典型生产配置）：

```text
enabled:  true
tiers:
  fast:
    - { provider: deepseek,   model: deepseek-v4-flash, priority: 1 }
    - { provider: z.ai,       model: glm-5.2,           priority: 2 }
    - { provider: xai,        model: grok-4.5-fast,     priority: 3 }
  smart:
    - { provider: anthropic,  model: claude-opus-5,     priority: 1 }
    - { provider: openai,     model: gpt-5.6-sol,       priority: 2 }
    - { provider: moonshotai, model: kimi-k3,           priority: 3 }
```

逐字段默认值：

| 字段 | 默认 | 含义 |
|------|------|------|
| `enabled` | `true` | 总开关。`/router off` 停用。 |
| `tiers.<tier>.models[]` | `[]` | 按 `priority` 排序。首个命中；其余项作运行时备用。 |
| `routing.judgeTimeout` | `5000` | ms。Judge 调用超时。 |
| `routing.window.size` / `threshold` | `5` / `0.6` | 滑动窗口降级门。 |
| `routing.window.minConfidence` | `0.5` | 低于该置信度的投票被忽略。 |
| `ux.quietMode` / `statusBar` / `inlineToast` / `routerLogVerbose` | 各自 | 表面控制。 |

---

## 模型选择推荐

这一节不提供可复制的 JSON 片段（各家 Provider 差异太大），只讲**选型逻辑**。数据快照于 [models.dev](https://models.dev/)，抓取时间 **2026-08-05**；用 `curl -s https://models.dev/api.json | jq` 看最新。

> **Fast 档经验法则**：如果你使用的 Provider 提供 `deepseek-v4-flash`（2026-07 发布），fast 首选它 —— 0731 刷新把质量拉到了接近 Opus 5 / GLM-5.2 的水平，但价格仍处在表中低位。
>
> **Smart 档经验法则**：smart 始终走云。低于 ~80 GB 显存/统一内存的硬件跑本地 smart 极其不划算；96 GB 以上也几乎永远不如 flat-fee 套餐。

### Pattern 1 — Token-plan 套餐（一个 key 走多模型）

列出的是你可混合在 chain 中的候选 ID，不是唯一推荐搭配。下面这些 Provider 都是全球知名的聚合 / Token-bundle 网关，统一账号接入 Anthropic / OpenAI / Google / DeepSeek / xAI / Z.AI / Qwen / Moonshot 等。

| Plan | fast 🦾 候选 | smart 🧠 候选 |
|---|---|---|
| **Alibaba Token Plan**（intl + CN） | `qwen3.7-plus`、`qwen3.6-flash`、`deepseek-v4-flash` | `qwen3.8-max`、`qwen3.7-max`、`kimi-k3` |
| **Vercel AI Gateway** | 上述任意走同一网关 | 上述任意 |
| **OpenRouter** | 200+ 个模型；`auto` **不能**当 Judge target（不透明） | 200+ 个模型 |
| **Hugging Face Inference** | `Qwen/Qwen3.5-9B`、`Qwen/Qwen3.6-35B-A3B` | `Qwen/Qwen3.6-27B`、`google/gemma-4-31B-it` |
| **Nebius Token Factory** | `deepseek-ai/DeepSeek-V4-Flash`、`moonshotai/Kimi-K2.7-Code` | `Kimi-K3`、`zai-org/GLM-5.2`、`Qwen/Qwen3.7-Max` |
| **NovitaAI** | `deepseek-ai/DeepSeek-V4-Flash`、`Qwen/Qwen3.6-27B` | `moonshotai/Kimi-K3`、`Qwen/Qwen3.7-Max` |

### Pattern 2 — 本地模型按显存 / 统一内存分级

下列推荐均在 2026-08 针对 HuggingFace `safetensors` 权重大小逐个核实。2025 化石模型、端侧产物（<7 B）以及 Qwen3.5 / DeepSeek-V3 以前的型号均已排除（太老）。

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
- **任意一个暴露 OpenAI-compatible API 的运行时都可以**。常见选择：**ollama**（`ollama run qwen3.6:27b` 默认起 `:11434`）、**LM Studio**（MLX + GGUF）、**vLLM**、**llama.cpp** / **llama-server**、**exo**、**llamafile**。
- **Judge 也需要 JSON-mode 端点**。Qwen 3.5+ 和 Gemma 4 都 `tool_call=true`，满足 Judge 的 JSON-mode 约束；但本地 Judge 会增加 ~0.5–2 s/turn。推荐：本地 fast + 本地或云 smart + Judge 放在你最信任的 smart 上。

### Pattern 3 — 同 Provider 自带 tier ladder（最简）

一个 Provider、一份账本、一个 rate limit 池。已有某 Provider 付费账户且不想多 key 管理时用这个。

| Provider | fast 🦾 | smart 🧠 | 备注 |
|---|---|---|---|
| **Anthropic** | `claude-sonnet-5` | `claude-opus-5` 或 `claude-fable-5` | Sonnet 5 是当前 fast 档。 |
| **OpenAI** | `gpt-5.6-luna` | `gpt-5.6-sol` | GPT-5.6 内部 `luna` < `terra` < `sol` 三档。 |
| **Google** | `gemini-3.5-flash-lite` | `gemini-3.6-flash` | Gemini 3.x，两档均 1 M 上下文。 |
| **Qwen (Alibaba)** | `qwen3.7-plus` | `qwen3.8-max` | 原生 `plus` / `max` 分级。 |
| **DeepSeek** | `deepseek-v4-flash` | `deepseek-v4-pro` | `flash` ≈ mini 价格档，`pro` ≈ 旗舰。 |
| **Z.AI (GLM)** | `glm-5` 或 `glm-5-turbo` | `glm-5.2` | GLM-5 系列。 |
| **xAI (Grok)** | `grok-4.5-fast` | `grok-4.5` | Grok 4.5 代。 |

### Pattern 4 — 跨 Provider 拼装（最佳单项）

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

---

## 对比一览

两者解决同一个问题（按轮 agent 路由到不同档位模型），但在“什么才算好的分类”这个根本问题上走了相反的路。

| | 🦾 **pi-shift-router**（本插件） | pi-model-router |
|---|---|---|
| **🧠 分类器** | ✅ LLM Judge（JSON mode 强制）—— 始终走 LLM，凭自然语言推理 | ⚠️ 可选 LLM 分类器 → 启发式 / 关键词兑底 |
| **🪜 层数** | ✅ 2 层（fast / smart）—— 面小，容易讲清楚 | 3 层（high / medium / low）—— 旋钮多 |
| **📝 自定义规则** | ✅ 无 —— Judge 读自然语言信号 | ⚠️ 关键词 override（手写 / 正则 等）—— 要维护 |
| **💰 预算上限** | — | USD 会话预算，超额自动 high → medium |
| **🗂️ 持久化** | 仅本会话 | 跨会话、跨分支（`router-state`） |
| **🛡️ 运行时 failover** | ✅ 429/5xx + 指数退避冷却，与 Judge 共享 | Profile 级 fallback 链 |
| **📦 依赖** | ✅ 零运行时依赖 | 依赖 pi SDK 的 npm 包 |

**两种哲学：**

- **🦾 pi-shift-router 押“少即是多”** —— 2 层足够思考清晰，Judge 只是单次 LLM 调用，prompt 可以读可以改；没有关键词表要维护。Judge 走 LLM 推理，能处理你没提前预见过的 prompt（不会出现“新场景出现 → 必须加新规则”的事）。暴露面越小，意外越少。
- **pi-model-router 押“控制感”** —— 3 层 + 显式预算上限 + 规则 override 表达力更强，能强制设 USD 顶、能用关键词把特定表达钉到特定 tier。但规则列表本身变成要维护的产物：每加一个 Provider、每出现一种新 prompt 风格都可能要加一条规则；启发式兑底不透明 —— LLM 分类器不可用时，关键词层会静默地给出不一样的选择。

**按需求选：**

- **🦾 pi-shift-router** —— 要零依赖、JSON-mode LLM Judge、运行时 failover（429/5xx 冷却），并且希望代码面小到一晚上能读完。
- **pi-model-router** —— 要 USD 预算上限、跨会话状态、关键词钉选。

---

## 常见问题

### 不配置任何模型会怎样？

两层默认都为空。路由器不起作用，pi 用默认模型。运行 `/router config` 配置。

### Judge 会增加明显延迟吗？

一次 Judge 调用是几千 token、用 Fast 模型本身的价格。端到端分类往返通常 200ms–2s。状态栏 `⚖ judging…` 提示期间进度。

### Primary 模型 429 或超时？

v0.6.0 起指数退避冷却：primary 标记冷却（1m → 2m → 4m … 封顶 30m），同层下一个健康模型接管。2xx 响应立即清除冷却。

### 能跨 Provider 混用吗？

可以。每层是一个有序的 `{provider, model, priority}` 列表，任意组合。

### 会不会过早降级 Smart？

仅当最近 5 轮中 fast 投票的**加权比** ≥ `window.threshold`（默认 0.6）时才降级；低 `window.minConfidence`（默认 0.5）以下的投票被忽略。改成 `threshold: 0.8` 可延长 Smart 停留。升级（Fast → Smart）始终立即。

### 和 pi-model-router 的区别？

直接竞品 —— 同一个问题（每轮任务交给哪个 model tier），不同实现路线。完整差异见 [对比一览](#对比一览)。选哪个取决于你接受哪套取舍：要零依赖 + JSON Judge + 运行时 failover + 小到一晚上能读完的面，还是三层 + USD 预算上限 + 关键词规则 + 跨会话状态。

### 能不能临时禁用而不卸载？

`/router off` 本会话停用；`/router on` 重新启用。开关在配置文件里持久化。

### Judge 有额外费用吗？

Judge 用的是 Fast 层模型（通常是你最便宜的）。一次分类几千 token，相对避免误调 Smart 的节省完全忽略不计。

---

## 调参指南

每个参数都有取舍。按你的工作负载选择：

| 你的会话看起来像… | 试试… | 为什么 |
|---|---|---|
| 很多例行任务（CRUD、测试、文档）；架构很少 | `threshold: 0.5`, `minConfidence: 0.7` | 激进降级 —— 减少误调 Smart 的次数 |
| 重架构 / 规划 / 代码审查 | `threshold: 0.8`, `minConfidence: 0.4` | 保守降级 —— 多留在 Smart |
| 混合 —— 有时连续 20 轮快任务，有时规划 | 默认值（`threshold: 0.6`, `minConfidence: 0.5`） | 平衡 |
| Judge 倾向过度自信（多数投票 ≥0.9） | `minConfidence: 0.7` | 剥离过度自信投票 |
| Judge 倾向不确定（许多投票 0.3–0.6） | `minConfidence: 0.3` | 不丢弃不确定投票 |
| Primary fast 模型频繁 429 | `tiers.fast.models[1]` 加 Provider | 加 fallback 伙伴，v0.6.0 接管运行时 |
| 重 streaming / 长 agent 运行 | 监控 `/router stats` tokens/sec | 查看每轮实际吞吐 |

### 旋钮详解

**`routing.judgeTimeout` (ms)** — Judge API 调用超时。默认 `5000`。慢 Provider 提高；不稳定网络降低。

**`routing.window.size`** — 滑动窗口长度。默认 `5`。越大越稳定（反应越慢），越小越敏捷（可能抖动）。

**`routing.window.threshold`** (0–1) — fast 投票加权比阈值。默认 `0.6`。
- `0.5`：fast 略占多数即降级
- `0.6`：平衡（默认）
- `0.8`：fast 显著占多数才降级
- `1.0`：永不降级（禁用滑动窗口）

**`routing.window.minConfidence`** (0–1) — 低于此置信度的投票被丢弃。默认 `0.5`。设为 `0` 恢复 v0.6.0 的等权计数；设为 `0.7+` 仅计清晰投票。

**`tiers.<tier>.models[]`** — 按优先级排序。第一项是 primary，后续项是 runtime fallback（v0.6.0）。最便宜的健康模型放第一。

**`ux.routerLogVerbose`** — 设为 `true`（或 `/router verbose`）在控制台看决策日志。校准 threshold 时很有用。

### 读 `/router stats`

```
Tier: smart / p/claude-opus-5
Window: 3 entries (confidence: high=2 mid=1 low=0 none=0)
Transitions: ↑upgrade=1 ↓downgrade=0
Tokens: total 12,345 | speed current=23 avg=25 tok/s
Cooldowns: none
```

- **`high` / `mid` / `low` / `none`** — 窗口置信度分布。如果 `none` 多，说明 Judge 没返回 confidence（旧版本或 prompt 没刷新）。重跑 `/router config` 刷新。
- **`avg tok/s`** — 最近几轮吞吐。用于发现 Provider 降速。
- **`upgrade` / `downgrade`** — 层级切换次数。降级太频繁 → 提高 threshold；太少 → 降低。

---

## 故障排查

### Judge 解析失败

- **推理模型 token 不够** —— DeepSeek Reasoner 等把推理放在 `reasoning_content`、JSON 放在 `content`。默认 `max_tokens: 4000`；极长 prompt 可能不足。`/router verbose` 看原始响应。
- **Provider 不支持 JSON mode** —— 部分自定义 OpenAI 兼容端点忽略 `response_format`。
- **API key 失效** —— 检查 pi-agent 的 `auth.json`。

### "Judge fetch failed for … : TypeError: Cannot read 'slice' of undefined"

v0.8.0 修复（commit `de6073a`+）。根因：`JSON.stringify(undefined)` 返回的是 `undefined`（不是字符串 `"undefined"`）。当 Judge 端点返回 200 但 body 没有 `choices[]`（如某些 Provider 的错误结构），verbose 日志会在 `content.slice(...)` 崩溃。修复方式：`jsonStr()` 包装器对 undefined 返回 `"undefined"`。如果你在旧版本仍看到，重新安装：`pi remove pi-shift-router && pi install <path-to-this-repo>`（例如在仓库根目录跑 `pi install .`）。

### 向导"找不到模型"

模型列表来自 pi-agent 的 `models-store.json`。新增 provider 后重启 pi-agent 让其重新发现。

### 状态栏一直显示 ⛔

路由器被禁用：`/router on`。若 config 里 `enabled: true` 仍显示 ⛔，看 `/router status` 的 `Config:` 行确认读取的配置路径。

### "Model not found" 警告

配置的 model ID 在 Provider 中不存在。更新 ID 或重跑 `/router config`（向导只会列出真实存在的模型）。

### 总是被降级到 Fast

Judge 误分类（`/router verbose` 查看）或阈值太激进。调高：

```json
"routing": { "window": { "size": 5, "threshold": 0.8, "minConfidence": 0.5 } }
```

---

## 致谢

- **[pi-coding-agent](https://github.com/earendil-works/pi)** by earendil-works —— host agent。
- **[pi-tui](https://www.npmjs.com/package/@earendil-works/pi-tui)** —— TUI 原语。
- **[pi-model-router](https://github.com/yeliu84/pi-model-router)** —— 直接路由竞品：三层、USD 预算上限、关键词 override、跨会话持久化。完整差异见 [对比一览](#对比一览)。

---

**作者 & 许可** — pi-shift-router 由 [green-dalii](https://github.com/green-dalii) 开发并维护，[MIT](LICENSE) © 2026。