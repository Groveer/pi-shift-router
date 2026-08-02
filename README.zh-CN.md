# pi-shift-router

> 为 Pi coding agent 自动路由每轮任务 —— 在 Fast 执行模型与 Smart 判断模型间动态切换，LLM Judge 自动分类，支持多模型 fallback 链，零运行时依赖。

[![npm](https://img.shields.io/npm/v/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![Downloads](https://img.shields.io/npm/dm/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Pi Agent](https://img.shields.io/badge/pi--agent-extension-purple)](https://github.com/earendil-works/pi-coding-agent)
[![CI](https://github.com/green-dalii/pi-shift-router/actions/workflows/ci.yml/badge.svg)](https://github.com/green-dalii/pi-shift-router/actions)
[![GitHub stars](https://img.shields.io/github/stars/green-dalii/pi-shift-router.svg)](https://github.com/green-dalii/pi-shift-router)

[English](README.md) | [简体中文]

---

## 摘要

- **是什么**：[pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) 扩展。每轮任务根据心智模式自动路由到 fast 执行模型 或 smart 判断模型。
- **怎么工作**：每轮开始前，用一个小型 LLM Judge（就是 fast 层模型本身）把任务分类为 `fast` 或 `smart`。LLM 作分类器 + 指数退避故障转移。
- **可靠性**：每层多模型 fallback 链 + 429/5xx 下的指数退避冷却 —— 一个 Provider 限流时任务依然进行。
- **零运行时依赖**：纯 TypeScript，单个 npm install + 两层配置即可。
- **稳定状态**：v0.4.0 起 npm 发布（MIT / 176 单测 / Node 24+）。

---

## 目录

- [问题](#问题)
- [解决方案](#解决方案)
- [快速开始](#快速开始)
- [工作原理](#工作原理)
- [对比一览](#对比一览)
- [The Judge](#the-judge)
- [命令](#命令)
- [配置](#配置)
- [架构](#架构)
- [故障排查](#故障排查)
- [贡献](#贡献)
- [许可](#许可)

## 问题

Pi-agent 支持多个 Provider，但每个会话锁死在单一模型上。

- 日常用一个便宜模型：复杂架构任务质量跟不上
- 日常用一个顶级模型：琐碎任务在烧钱
- 每隔几分钟就要手动 `/model` 切换 —— 这不算自动化，是体力活

## 解决方案

**pi-shift-router** 接入 pi-agent 的会话周期，按 **心智模式**（执行 vs 判断）分类每轮任务，无缝切换当前激活的模型。

- **两层路由** — Smart（🧠 CTO）与 Fast（🦾 程序员）。每层可保存一个按优先级排序的模型链 —— 路由器用第一个，后续项作为 primary 不可用时的备用。
- **LLM Judge** — 用 Fast 模型的 API 调用来分类任务是"执行"还是"判断"。成本是几千 token 级别，相对于节省的开销可以忽略不计。
- **滑动窗口** — 防止模型频繁切换：仅当最近 5 轮中 ≥60% 都判定为 fast 时才降级。
- **零配置起步** — 两层默认都为空。直到你配置前，路由器什么都不做。
- **交互式向导** — `/router config` 启动 TUI 向导，复刻 pi 原生 `/model` 的体验：实时模糊搜索、10 项滑动视口、方向键导航、Enter 选中、Esc 取消。可用热键为每层配置多模型 fallback 链（`a` 添加、`x` 删除、`K`/`J` 重排）。
- **原生支持跨 Provider** — Fast 可以是 DeepSeek Flash，Smart 可以是 Kimi K3。任意组合。

### CTO / 程序员类比

> **Smart = CTO**：判断、架构、审查、规划 —— 工作量小但极其关键
> **Fast = 程序员**：执行、写代码、调试、测试 —— 工作量大但模式明确

不是所有任务都需要 CTO 级别的智力。但项目如果没有 CTO 把关，质量底线撑不住。

---

## 快速开始

```bash
# 安装（写入 pi-agent 的 settings.json）
pi install npm:pi-shift-router
```

该命令把包注册到 pi-agent 的 `~/.pi/agent/settings.json` 并下载到 `~/.pi/agent/`。下次启动 pi-agent 时会自动加载扩展。详见 [pi 包管理文档](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/packages.md)。

```bash
# 启动配置向导（在 pi-agent 中）
/router config

# 为 Smart（🧠）和 Fast（🦾）各选一个模型
# 保存并退出 —— 搞定
```

路由器会在下一轮自动激活。运行 `/router status` 查看实时状态。

---

## 工作原理

```mermaid
flowchart TD
    Input["用户发送消息"]
    Input --> Hook["before_agent_start 事件触发"]
    Hook --> Enabled{"路由器已启用？"}
    Enabled -->|否| Skip["pi 使用默认模型"]
    Enabled -->|是| Judge["LLM Judge（用 Fast 模型）"]
    Judge --> Fail{"Judge 成功？"}
    Fail -->|否| Fallback["保持当前挡位"]
    Fail -->|是| Decide

    Decide{"判定结果？"}
    Decide -->|Smart & 当前 Fast| Upgrade["升级 → Smart 模型<br/>(立即，清空窗口)"]
    Decide -->|Fast & 当前 Smart| Trend["检查滑动窗口"]
    Decide -->|与当前相同| Stay["保持（STAY）"]

    Trend --> Stable{"Fast ≥60% of last 5?"}
    Stable -->|是| Down["降级 → Fast 模型"]
    Stable -->|否| Stay

    Upgrade --> Notify["更新状态栏 + toast"]
    Down --> Notify
    Stay --> Done["Agent 用选中的模型处理"]
    Notify --> Done
```

### 关键属性

- **升级**（fast → smart）**立即**。质量优先。
- **降级**（smart → fast）需要**持续趋势**（最近 5 轮中 ≥60%）。保护缓存。
- **手动覆盖**（`/route-force smart`）锁定下一轮的模型，自动清除。
- **每轮 = 一次分类** —— 不在 tool call 粒度上切换。

---

## 对比一览

| | pi-shift-router | pi-router | pi-smart-router |
|---|---|---|---|
| **做什么** | 按心智模式路由 —— 执行任务用轻量模型，判断任务用顶级模型 | 在 Provider 之间故障转移 —— Provider A 挂了切 Provider B | ML 优化的推理管线 —— 12 阶段混合路由 |
| **何时用它** | "这个问题很简单，为什么要用旗舰 token？" | "Anthropic 不可用，切 Google 还能保留上下文" | "我要本地推理 + ONNX 智能路由" |
| **Judge 机制** | LLM-as-judge | 手动策略配置（延迟 / 能力 / 成本） | ONNX embedding + Aho-Corasick + 类型分类器 |
| **路由维度** | 心智模式**（执行 vs 判断） | Provider **可靠性**（这个还活着吗？） | 执行**引擎**（本地 vs 云，成本 vs 延迟） |
| **依赖** | 零运行时依赖（纯 TS） | 零运行时依赖（纯 TS） | ONNX、SQLite、HuggingFace Transformers |
| **本地推理** | 否 | 否 | 是（LM Studio、Ollama） |
| **学习曲线** | 低 —— 选两个模型搞定 | 中低 —— 配置通道和策略 | 高 —— 下载 ONNX 模型，本地编译 |

**一句话**：这三个是互补关系，不是竞争关系。甚至可以同时跑 —— pi-router 处理 Provider 故障转移，pi-smart-router 优化推理引擎，pi-shift-router 保证每个任务用对复杂度。

---

## The Judge

路由器每轮（Agent 开始工作之前）问 **Fast 模型** 一个问题：

> "这一轮是执行（`fast`）还是判断（`smart`）？"

每次调用就是几千 token —— 用的是 Fast 模型本身的定价，相对于节省的开销可以忽略不计。哪怕只是避免一次 Smart 轮的浪费，路由器就回本了。

Judge 使用 **API 层的 JSON mode**（不只是 prompt 指示）：

- **OpenAI 兼容**（DeepSeek、OpenAI）：`response_format: { type: "json_object" }` —— API 直接拒绝非 JSON 输出
- **Anthropic**：assistant message prefill `{` —— 强制以 JSON 开头
- **解析兜底**：JSON 解析 → 宽松 JSON → 裸关键字

Judge 调用期间，状态栏短暂显示 **`⚖ judging…`**，让用户在 200ms–2s 的延迟里有反馈，而不是沉默。

### 调试

开启 verbose 日志可以在控制台看到每一轮的决策细节：

```
/router verbose
```

输出包含：prompt 预览、judge 调用详情（URL、原始响应）、决策结果、模型切换结果。

---

## 命令

| 命令 | 功能 |
|------|------|
| `/router status` | 显示当前挡位、模型、窗口状态和配置摘要 |
| `/router on` | 启用路由 |
| `/router off` | 停用路由 —— pi 回退到默认模型 |
| `/router config` | 启动 TUI 配置向导 |
| `/router quiet` | 切换 toast 通知 |
| `/router verbose` | 切换 verbose 日志（调试） |
| `/route-force <tier>` | 临时锁定 Smart 或 Fast（一轮） |
| `/route-force <provider>/<model>` | 临时锁定指定 provider/model（一轮） |
| `/route-force auto` | 清除手动覆盖 |

---

## 配置

双层配置：用户级（`~/.pi/agent/`）+ 项目级（`.pi/`）。项目级优先。

```json
{
  "enabled": true,
  "tiers": {
    "fast":  { "models": [
      { "provider": "deepseek", "model": "deepseek-v4-flash", "priority": 1 },
      { "provider": "kimi",     "model": "kimi-flash",       "priority": 2 }
    ] },
    "smart": { "models": [{ "provider": "kimi", "model": "kimi-k3", "priority": 1 }] }
  },
  "routing": {
    "mode": "auto",
    "judgeTimeout": 5000,
    "window": { "size": 5, "threshold": 0.6 }
  },
  "ux": {
    "quietMode": false,
    "statusBar": true,
    "inlineToast": true
  }
}
```

### Fallback 链

每层的 `models` 数组是一个**按优先级排序的列表** —— 第一个是 primary，后续项是备用。会话启动时路由器选择第一个有合法 API key 的模型；其余项用于运行时 failover（v0.6.0）。

在 TUI 中通过 `/router config` 可配多模型。向导会打开一个内嵌编辑器：

```
Edit Fast models
  #1  deepseek/deepseek-v4-flash
  #2  kimi/kimi-flash
  #3  openai/gpt-4o-mini

Press: ↑↓ select · A add · X remove · J/K move · D done · Esc cancel
```

- `A` 打开 type-to-filter picker（与 pi 原生 `/model` 一致）
- `X` 删除当前行
- `J` / `K` 与下一行 / 上一行交换（vim 风格）
- `D` 保存退出，`Esc` 取消

字母键不区分大小写——图例里用大写是 TUI 惯例，但 `j` 和 `J` 都生效。`J`/`K` 是普通按键（不需要 Shift），保证跨终端可用。

非 TUI 模式仍然沿用之前按 Provider 分组的单模型选择器。

### 运行时 Failover（v0.6.0）

当模型遇到临时故障（429 限流、5xx、或 Token Plan 配额耗尽）时，路由器会在 pi 自身的重试用尽后接管：

1. **pi 先重试** —— pi 的 provider 层对失败模型指数退避重试（约 3 次），agent 层再重试。路由器刻意让 pi 在 primary 上用尽重试预算。
2. **`agent_end` hook 接管** —— 若本轮仍以 failover 签名失败，路由器将模型标记进**指数退避冷却**（1m、2m、4m、… 封顶 30m），并立即 `setModel` 到**同一层级**的下一个健康模型。pi 待定的重试随即用 fallback 继续 —— 同轮 failover，不跨层级。
3. **Judge 同样 failover** —— 分类器使用 fast 层的完整模型链（按优先级）。若 primary fast 模型 429 或超时，Judge 会先回退到下一个 fast 模型才放弃（并与路由共享同一冷却表，被 Judge 判定失败的模型也会被路由跳过）。
4. **冷却感知路由** —— 后续轮次的 `before_agent_start` 跳过冷却中的模型，primary 在冷却到期前不再被重试。
5. **恢复** —— 2xx 响应立即清除冷却；会话重启全部重置。

Failover 签名：HTTP 429、5xx、`rate limit`、`quota`、`rate_limit_error`、`insufficient_quota`、`Token Plan` / `用量上限`。认证 / 配置错误（400/401）**不会**触发 failover —— 它们需要人工修复。手动覆盖（`/route-force`）始终绕过冷却。

用户反馈：切换时弹出 toast（`⚠️ M3 unavailable (429), switching to deepseek-v4-flash — retry in 1m`），`/router status` 列出活跃冷却项（`⏳ minimax/MiniMax-M3 — retry in 3m12s`）。

---

## 架构

```mermaid
flowchart LR
    subgraph Entry
        I["index.ts<br/>生命周期 hook<br/>init, classify, setModel"]
    end
    subgraph Engine
        R["router.ts<br/>processRoute, 滑动窗口"]
        J["judge.ts<br/>LLM 分类器"]
        T["tier.ts<br/>模型查找"]
    end
    subgraph Persistence
        C["config.ts<br/>JSON 加载/保存"]
    end
    subgraph UX
        M["commands.ts<br/>Slash 命令 + 向导"]
    end

    I --> R & M
    R --> J & T
    M --> C
    T --> C
    C --> Y["types.ts<br/>DEFAULT_CONFIG"]
```

### 依赖链

```
src/
├── index.ts        → router.ts, judge.ts, tier.ts, failover.ts, commands.ts
├── router.ts       → tier.ts, types.ts
├── judge.ts        → types.ts (+ prompts/judge.md)
├── tier.ts         → types.ts
├── failover.ts     → types.ts
├── commands.ts     → config.ts, tier.ts, router.ts, types.ts
├── config.ts       → types.ts
├── tui/
│   └── model-picker.ts  (TUI 组件，仅交互模式激活)
└── types.ts        (零依赖 —— 项目根基)
```

### 文件职责

| 文件 | 职责 |
|------|------|
| `index.ts` | 生命周期 hook：`session_start`（只读）、`before_agent_start`（分类 + 路由）、`agent_end`（failover）、`after_provider_response`（冷却恢复） |
| `router.ts` | `processRoute()`、`applyModelSwitch()`、滑动窗口 |
| `judge.ts` | LLM Judge + 保持当前挡位兜底 |
| `tier.ts` | 模型查找、`findBestModelForTier()`、展示 |
| `failover.ts` | 运行时 failover：指数退避冷却、错误签名、同层 fallback |
| `config.ts` | JSON 持久化、`resolveFastEndpoint()` |
| `commands.ts` | `/router`、`/route-force`、配置向导 |
| `tui/model-picker.ts` | TUI picker，复刻 pi 原生 `/model` UX |
| `tui/fallback-chain-editor.ts` | Chain 编辑器：用热键添加 / 删除 / 重排层级模型 |
| `types.ts` | 所有 interface、`DEFAULT_CONFIG` |

---

## 开发

```bash
git clone https://github.com/green-dalii/pi-shift-router.git
cd pi-shift-router
npm install
npm run build
npm test
```

### 原则

- **简洁 > 复杂**。宁少一行不少一行。
- **两层 > 三层**。执行 vs 判断是唯一有意义的分类轴。
- **LLM Judge，不要正则**。不维护关键字列表。LLM 是唯一的分类器。
- **零外部运行时依赖**。只有 pi-agent SDK。
- **测试覆盖算法**。176 个测试守护路由引擎 + chain 编辑器 + 运行时 failover + Judge fast 链 fallback。

[完整设计文档 →](SPEC.md)

---

## 作者

**pi-shift-router** 由 [green-dalii](https://github.com/green-dalii) 开发并维护。

欢迎贡献 —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 贡献

Bug 报告、特性想法、文档改进、代码改动，都欢迎。先读 [CONTRIBUTING.md](CONTRIBUTING.md)；设计契约见 [SPEC.md](SPEC.md)，开发哲学见 [AGENTS.md](AGENTS.md)。

---

## 故障排查

### Judge 解析失败警告

最常见原因：

- **推理模型 token 不够**。DeepSeek Reasoner 等会把推理内容放在 `reasoning_content`、JSON 放在 `content` 中。路由器默认 `max_tokens: 4000`，极长 prompt 可能不足。试用 `/router verbose` 看原始响应。
- **Provider 不支持 JSON mode**。部分自定义 OpenAI 兼容端点会忽略 `response_format`。
- **API key 失效**。检查 pi-agent 的 `auth.json`，确认 key 可用。

### 向导里“找不到模型”

模型列表来自 pi-agent 的 `models-store.json`。新配置的 provider 不显示，重启 pi-agent 让其重新发现。

### 状态栏一直显示 ⛔

路由器被禁用了。运行 `/router on`。如果 config 里 `enabled: true` 却仍显示 ⛔，看 `/router status` 的 `Config:` 行确认读取的配置文件路径。

### “Model not found” 警告

配置的 model ID 在 Provider 里不存在。更新 model ID 或重新跑 `/router config`（向导只会列出真实存在的模型）。

### 总是被降级到 Fast

要么 Judge 误分类（用 `/router verbose` 查看），要么滑动窗口阈值太激进。调整：

```json
"routing": { "window": { "size": 5, "threshold": 0.8 } }
```

`0.8` 要求最近 5 轮中至少 4 轮是 Fast 才降级。

---

## 许可

[MIT](LICENSE) © 2026 green-dalii 及 pi-shift-router 贡献者。