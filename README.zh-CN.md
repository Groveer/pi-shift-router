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
- latest: v0.6.0
- features: 两层路由、LLM Judge、JSON-mode 分类器、滑动窗口降级门、多模型
  fallback 链、TUI chain 编辑器、指数退避运行时 failover（429/5xx）、路由与
  Judge 共享冷却、原生跨 Provider、零配置起步
- complementary: pi-model-router（三层 + 预算 + 规则）、pi-smart-router（ML 推理，本地 ONNX）
- author: green-dalii（https://github.com/green-dalii）
-->

# pi-shift-router

> 为 Pi coding agent 自动路由每轮任务 —— 在 Fast 执行模型与 Smart 判断模型间动态切换，LLM Judge 自动分类，支持多模型 fallback 链，零运行时依赖。

[![npm](https://img.shields.io/npm/v/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![Downloads](https://img.shields.io/npm/dm/pi-shift-router.svg)](https://www.npmjs.com/package/pi-shift-router)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-green)](https://nodejs.org)
[![CI](https://img.shields.io/github/actions/workflow/status/green-dalii/pi-shift-router/ci.yml)](https://github.com/green-dalii/pi-shift-router/actions)
[![Stars](https://img.shields.io/github/stars/green-dalii/pi-shift-router.svg)](https://github.com/green-dalii/pi-shift-router)

[English](README.md) | [简体中文]

---

## 摘要

- **是什么** — [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) 扩展。每轮任务按心智模式自动路由到 fast 执行模型 或 smart 判断模型。
- **怎么工作** — 每轮开始前，用 Fast 模型本身做小型 LLM Judge，分类为 `fast` 或 `smart`。
- **可靠性** — 每层多模型 fallback 链 + 429/5xx 下的指数退避冷却 —— 一个 Provider 限流时任务依然进行。
- **零依赖** — 纯 TypeScript，单个 `npm install` + 两层配置即可。
- **稳定状态** — v0.4.0 起 npm 发布（MIT / 202 单测 / Node 24+）。

### 在 pi 中长这样

```text
🦾 [MiniMax-M3] → 修这个失败的测试
⚖ judging…
🧠 [kimi-k3]              ← 架构问题自动升级到 Smart
⚠️ MiniMax-M3 429 → switching to deepseek-v4-flash — retry in 1m
🦾 [deepseek-v4-flash]     ← 同层 failover（v0.6.0）
```

状态栏徽章自动切换；toast 解释每次变更。

---

## 目录

- [它做什么](#它做什么)
- [快速开始](#快速开始)
- [工作原理](#工作原理)
- [命令](#命令)
- [配置](#配置)
- [对比一览](#对比一览)
- [常见问题](#常见问题)
- [故障排查](#故障排查)
- [致谢](#致谢)

---

## 它做什么

**pi-shift-router** 按**心智模式**（执行 vs 判断）对每轮任务分类，并在两个模型间路由：

| | 层级 | Emoji | 何时用 |
|---|------|-------|--------|
| 执行模式 | **Fast** | 🦾 | 写代码、调试、测试、文档、套用模式 |
| 判断模式 | **Smart** | 🧠 | 架构、审查、规划、安全审计 |

**默认无任何行为** —— 两层默认都为空，配置前路由器不起任何作用（`/router config`）。

> **Smart = CTO**：判断、架构、审查、规划 —— 工作量小但极其关键
> **Fast = 程序员**：执行、写代码、调试、测试 —— 工作量大但模式明确

不是所有任务都需要 CTO 级别的智力。但项目如果没有 CTO 把关，质量底线撑不住。

---

## 快速开始

**前置** — Node.js ≥ 24、pi-agent ≥ 0.80、至少一个 Provider 账号（在 pi-agent 的 `auth.json` 里），每层各一个模型。

**安装**

```bash
pi install npm:pi-shift-router
```

写入 `~/.pi/agent/settings.json`，下次启动 pi 时自动加载。git / 本地路径安装见 [pi 包管理文档](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/packages.md)。

**配置**

在 pi 里运行 `/router config`，为 Fast 和 Smart 各选一个模型。保存到用户或项目作用域。

**验证**

`/router status` 显示层级和模型；下一轮触发首次 Judge 调用。

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

## 配置

双层配置：用户级（`~/.pi/agent/pi-shift-router.json`）+ 项目级（`<cwd>/.pi/pi-shift-router.json`）。项目级优先。

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

| 字段 | 默认 | 含义 |
|------|------|------|
| `enabled` | `true` | 总开关。`/router off` 停用。 |
| `tiers.<tier>.models[]` | `[]` | 按 `priority` 排序。首个命中；其余项作运行时备用。 |
| `routing.judgeTimeout` | `5000` | ms。Judge 调用超时。 |
| `routing.window.size` / `threshold` / `minConfidence` | `5` / `0.6` / `0.5` | 滑动窗口降级门；低于 `minConfidence` 的投票被忽略。 |
| `ux.quietMode` / `statusBar` / `inlineToast` / `routerLogVerbose` | 各自 | 表面控制。 |

每层的 `models` 是一个**按优先级排序的列表** —— 第一个是 primary，后续项是备用。`/router config` 打开 TUI chain 编辑器（`a` 添加、`x` 删除、`J`/`K` 重排、`d` 保存、`Esc` 取消）。

---

## 对比一览

| | pi-shift-router（本插件） | pi-model-router | pi-smart-router |
|---|---|---|---|
| **层数** | 2（fast / smart） | 3（high / medium / low） | n 阶段 ML 管线 |
| **分类器** | LLM Judge（JSON mode 强制） | 可选 LLM 分类器 + 启发式兜底 | ONNX + Aho-Corasick |
| **自定义规则** | — | 关键词覆盖 | — |
| **预算上限** | — | USD 会话预算；超额自动 high→medium | — |
| **Phase 记忆** | 滑动窗口降级门 | `phaseBias` 跨轮粘性 | — |
| **持久化** | 会话级 | 跨会话、跨分支（`router-state`） | 每会话 |
| **运行时 failover** | 429/5xx + 指数退避冷却 | Profile 级 fallback 链 | — |
| **依赖** | 零运行时（纯 TS） | pi SDK 上 npm 包 | ONNX、SQLite、HF |

**按需求选：**

- **pi-shift-router** —— LLM 作分类器，零运行时依赖，运行时 failover（429/5xx 冷却）。
- **pi-model-router** —— 三层路由、USD 预算上限、关键词规则、跨分支持久状态。
- **pi-smart-router** —— 本地 ONNX ML 推理。

三者互补，不竞争 —— 在栈的不同层上各司其职。

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

### 和 pi-model-router、pi-smart-router 的区别？

解决不同问题，可以叠加用 —— 见 [对比一览](#对比一览)。

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
Tier: smart / p/MiniMax-M3
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

- **[pi-coding-agent](https://github.com/earendil-works/pi-coding-agent)** by earendil-works —— host agent。
- **[pi-tui](https://www.npmjs.com/package/@earendil-works/pi-tui)** —— TUI 原语。
- **[pi-smart-router](https://github.com/beettlle/pi-smart-router)** —— 互补的 ML 优化推理路由（本地 ONNX）。
- **[pi-model-router](https://github.com/yeliu84/pi-model-router)** —— 互补的三层路由 + USD 预算 + 关键词规则。

---

**作者 & 许可** — pi-shift-router 由 [green-dalii](https://github.com/green-dalii) 开发并维护，[MIT](LICENSE) © 2026。