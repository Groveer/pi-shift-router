# Slim Router — Pi-agent 智能路由扩展

## 1. 概述

**Slim Router** 是 Pi-agent 的一个 Extension，实现**多 Provider、多模型智能路由**。根据用户每次输入的任务性质，自动选择最合适的模型，在**输出质量**和**成本效率**之间取得最优平衡。

**项目名：** pi-slim-router（npm 包名）· 仓库 green-dalii/pi-slim-router

### 核心价值

- **质量**：复杂任务自动使用旗舰模型（Kimi K3、Qwen Max 等）
- **成本**：简单任务自动使用轻量模型（DeepSeek Flash、MiMo 等），不浪费旗舰模型的昂贵 token
- **缓存友好**：降级策略保护 Provider 侧的 prompt caching，防止频繁切换导致缓存失效
- **零配置**：三档默认全部为空，不干扰 Pi 默认模型；用户运行 `/router config` 进入交互向导分配

### 为什么不是手动 `/model` 切换

Pi-agent 已支持多 Provider 和 `/model` 切换，但存在三个问题：

1. **每次只能手动切换**，无法根据任务自动变化
2. **用户需要记住每个模型的强弱和价格**，认知负担大
3. **一个会话绑定一个模型**，简单回答也调用旗舰模型，或复杂任务也被轻量模型限制

Slim Router 解决了这三点：**自动、透明、动态适配**。

---

## 2. 架构

### 2.1 整体流程

```
用户输入
  │
  ▼
┌──────────────────────────────────────────────────────────┐
│  Pi-agent before_agent_start 事件                        │
│                                                          │
│  ┌─── Slim Router ──────────────────────────────────┐   │
│  │                                                    │   │
│  │  ① 读取配置（缓存）                                 │   │
│  │  ② 检查是否有手动覆盖 (/route-force)               │   │
│  │  ③ 如果有覆盖 → 直接跳转到目标模型                  │   │
│  │  ④ 如果是自动模式 → 执行 Judge                     │   │
│  │     ├─ Judge 模型调用（LLM 分类）                   │   │
│  │     └─ 失败时 → 启发式评分降级                      │   │
│  │  ⑤ 趋势检测 → 决定是否切换层级                      │   │
│  │  ⑥ pi.setModel(目标模型)                           │   │
│  │  ⑦ 输出路由日志（通知用户）                         │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
│  return → 正常处理流程（用选定模型）                      │
└──────────────────────────────────────────────────────────┘
```

### 2.2 层级定义

| Tier | 定位 | 适用场景 |
|------|------|---------|
| **🧠 Flagship** | 规划、统筹、方向性决策、审核评估、复杂高难度开发/输出 | 架构设计、安全审计、多步骤推理、大型重构、策略规划 |
| **🦾 Medium** | 多数执行阶段，日常开发/输出 | 编写代码、撰写文档、调试排错、常规分析、重构 |
| **⚡ Light** | 大吞吐任务、智能要求不高、重复性、简单调研 | 简单问答、确认、状态查询、查阅资料、格式整理 |

### 2.3 层级之间的转换规则

```
                 ┌──────────┐
            ┌────┤ Flagship ├────┐
            │    └────┬─────┘    │
            │         │          │
            │   ┌─────▼─────┐    │
            ├───┤   Medium  ├────┤
            │   └─────┬─────┘    │
            │         │          │
            │   ┌─────▼─────┐    │
            └───┤   Light   ├────┘
                └───────────┘
```

**任何层级之间可以直接切换**（不分步降级）。

| 方向 | 条件 | 原理 |
|------|------|------|
| **↑ 升级** | **立即** | 质量优先。1 次 Judge 判定为目标层级即立刻切换 |
| **↓ 降级** | **趋势检测** | 保护缓存。需要窗口内足够多的样本 + 高置信度 |

---

## 3. 趋势检测降级算法（核心）

### 3.1 为什么不能"数连续次数"

简单数连续次数存在的问题：
- **混入干扰**：复杂对话中用户偶尔说"好的"、"明白"，不应触发降级
- **缺乏弹性**：固定阈值无法适应不同对话节奏
- **忽略了信号分布**：3 次 medium + 2 次 light 比 5 次 light 需要不同的处理

### 3.2 滑动窗口趋势检测

每次 Judge 产出结果后，放入一个**从上次层级变更开始累积**的滑动窗口。

```
窗口定义：
  - 从上次层级切换（升级或降级）之后的全部 Judge 结果
  - 窗口只累计，不滑动（不清除历史）
  
  但窗口有上限（防无限增长）：
  - maxWindowSize = 10 次（超出后丢弃最早的记录）
```

**降级触发条件：**

```
对于旗舰 → 降级
  必要条件：窗口长度 ≥ 4
  触发条件：窗口内某层级占比 ≥ 75%
  动作：直接降到该层级（不分步）

对于均衡 → 降级（降至轻量）
  必要条件：窗口长度 ≥ 3
  触发条件：窗口内 light 占比 ≥ 75%
  动作：直接降到 LIGHT

对于均衡 → 升级（升至旗舰）← 立即升级规则已覆盖
```

### 3.3 升级条件（无条件立即）

```
任何判定结果为 flagship → pi.setModel(旗舰模型)

从 light 到 medium：任何 medium 判定 → 立即升级
从 light 到 flagship：任何 flagship 判定 → 立即升级
从 medium 到 flagship：任何 flagship 判定 → 立即升级
```

### 3.4 升级时对窗口的处理

**升级时不清空窗口，但会清除层级较低的那些记录：**

```
当前窗口：[l, l, m, l, l, l]（在 light 层级，5次有1次medium）
第7轮判定为 flagship → 立即升到旗舰
窗口处理：✗ 不清空
         ✓ 只清除与"降级判定"相关的记录
         → 窗口收缩为 [m]（保留唯一一次非light的判定）
```

这样做的原因：
- 不清空窗口 → 保留"用户刚表达过复杂需求"的证据
- 降级相关的 light 记录可丢弃 → 因为用户已经表达了更复杂的需求方向
- 如果后续又全是简单问题，只要累积足够的 light 判定，仍然可以降下去

### 3.5 场景推演

#### 场景 A：复杂对话中夹带简单回复（缓存保护）

```
窗口状态     判定       层级         动作
──────      ──        ──          ──
                     🚀 Flagship  (初始状态)
[]           flagship  🚀 旗舰     窗口=[f]
[f]          light     🚀 旗舰     窗口=[f,l]
[f,l]        medium    🚀 旗舰     窗口=[f,l,m]
[f,l,m]      medium    🚀 旗舰     窗口=[f,l,m,m]
[f,l,m,m]    medium    🦾 均衡     ⚡ 触发降级！(75%≥medium, 窗口≥4)

→ 5 轮对话（2 个简单）才触发一次降级。缓存只断裂一次 ✓
```

#### 场景 B：话题真正转变（直接降级到 Light）

```
窗口     判定       层级         动作
──      ──        ──          ──
                   🚀 旗舰     (初始)
[]        flagship  🚀 旗舰    窗口=[f]
[f]       light     🚀 旗舰    窗口=[f,l]
[f,l]     light     🚀 旗舰    窗口=[f,l,l]
[f,l,l]   light     🚀 旗舰    窗口=[f,l,l,l]
[f,l,l,l] light     ⚡ LIGHT!  触发降级！(100% light, 窗口≥4)

→ 直接降到 Light，缓存只断裂 1 次。然后持续享受低价 ✓
```

#### 场景 C：混合信号不降级

```
窗口       判定       层级     动作
──        ──        ──      ──
                     🚀 旗舰  (初始)
[]          medium    🚀 旗舰  窗口=[m]
[m]         frlag     🚀 旗舰  窗口=[m,f]
[m,f]       light     🚀 旗舰  窗口=[m,f,l]
[m,f,l]     medium    🚀 旗舰  窗口=[m,f,l,m]
[m,f,l,m]   medium    🚀 精英  窗口=[m,f,l,m,m]
                           → 0% light, 0% flagship, 80% medium
                           → 但窗口里还有旗舰记录 → 信号混乱
                           → 触发条件是某层级≥75%，目前没有达到
                           → 但不等于不能降级，看看占比：
                           medium占比80%≥75%，所以会降到medium

→ 正确的处理：80% medium ≥75% → 降到 🦾 均衡 ✓
```

#### 场景 D：升级重置窗口逻辑

```
窗口           判定         层级        动作
──            ──          ──          ──
                         ⚡ Light     (初始)
[]             light       ⚡ Light    窗口=[l]
[l]            light       ⚡ Light    窗口=[l,l]
[l,l]          medium      🦾 Medium   ⚡ 立即升级！
               窗口保留 [m]，丢弃 [l,l]（因为已不在 light 层级）

[m]            light       🦾 均衡    窗口=[m,l]
[m,l]          light       🦾 均衡    窗口=[m,l,l]
[m,l,l]        light       ⚡ Light    ⚡ 触发降级！(100% light, 窗口≥3)
```

---

## 4. LLM Judge 系统

### 4.1 为什么用 LLM 做 Judge

- **语义理解**：正则无法判断"这个支付系统的架构设计"和"查下天气预报"的区别
- **适应性强**：不需要维护关键词黑/白名单
- **零维护**：只要换 Judge Prompt 就能调整行为

### 4.2 Judge Prompt 设计

```markdown
You are a task complexity classifier for an AI coding assistant.
Given the user's request, classify it into exactly one of three tiers.

RESPOND WITH ONLY ONE WORD: light, medium, or flagship.

## Definitions

**LIGHT** — Simple, repetitive, or low-intelligence tasks.
- Simple Q&A, greetings, confirmations ("ok", "thanks", "yes")
- Status checks, quick lookups
- Formatting, trivial edits, repetitive batch work
- "search for ...", "what is ..." (simple fact retrieval)
- Short commands, one-line requests

**MEDIUM** — Everyday coding and analysis work.
- Writing code, fixing bugs, refactoring (moderate scope)
- Documentation, code review (normal scope)
- Debugging, testing, routine analysis
- Most day-to-day development tasks

**FLAGSHIP** — High-value, complex, or strategic work.
- Architecture design, system design, trade-off analysis
- Security audit, performance optimization
- Large-scale refactoring, multi-step planning
- Ambiguous requirements needing deep reasoning
- Code review for critical systems, strategic decisions
- Any task where a mistake would be costly

## Examples

Input: "ok" → light
Input: "search for React hooks documentation" → light
Input: "fix this bug in the login function" → medium
Input: "implement the payment module" → medium
Input: "design a microservices architecture" → flagship
Input: "security audit of the authentication flow" → flagship

## User Request

{prompt}
```

### 4.3 Judge 模型的选择

- **使用 light tier 的模型**：用户为 light tier 配置的模型同时也是 Judge 模型
- **理由**：light tier 本来就是为低成本高频任务设计的，用它做 Judge 符合这个定位
- **回退**：如果 light tier 未配置或不可用，自动选择全局成本最低且有 auth 的模型
- **未来可扩展**：如需独立配置 Judge，可在 v0.2.0 增加 `judge.provider` / `judge.model` 字段

### 4.4 Judge API 调用（直连管道，不经过 Pi Agent Loop）

Judge 调用使用原生 `fetch()` 直接向 Provider API 发起请求，**不经过 Pi 的 agent 推理管道**。

#### 为什么 Judge 不走 Pi 管道

| 对比维度 | 走 Pi 管道 | 直连 Provider API |
|----------|-----------|-------------------|
| 延迟 | 需加载 system prompt、工具列表、session 状态 | 一次简单 HTTP 请求 |
| 成本 | 消耗完整上下文 tokens | 仅发送 Judge Prompt + 用户输入 |
| 独立性 | 受当前模型切换影响 | 始终使用同一轻量模型 |
| 复杂度 | 需处理工具注册、事件生命周期 | 一条 fetch 搞定 |

> **正常业务请求**（用户的实际对话内容）仍然走 Pi 的完整推理管道，包含上下文管理、工具调用、会话持久化等一切现有能力。只有 Judge 分类这一小步走直连管道。

使用 `fetch()` 直接调用 Provider API（复用 pi 已有的 auth 配置）：

```typescript
async function judgeTask(prompt: string, config: Config): Promise<Tier> {
  const { baseUrl, apiKey, modelId } = resolveJudgeConfig(config);

  if (apiType === "openai-completions") {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase();

    if (["light", "medium", "flagship"].includes(answer)) {
      return answer as Tier;
    }
  }

  // Anthropic-style API fallback
  // ... (支持不同 API 格式)

  return "medium"; // fallback
}
```

### 4.5 多 API 格式兼容

Judge 需要支持不同 Provider 的 API 格式。配置中记录每个 Provider 的 `api` 类型：

```typescript
async function judgeTask(prompt: string, config: Config): Promise<Tier> {
  const { baseUrl, apiKey, modelId, apiType } = resolveJudgeConfig(config);

  switch (apiType) {
    case "openai-completions":
      return judgeViaOpenAI(baseUrl, apiKey, modelId, prompt);
    case "anthropic-messages":
      return judgeViaAnthropic(baseUrl, apiKey, modelId, prompt);
    default:
      return judgeViaOpenAI(baseUrl, apiKey, modelId, prompt); // fallback
  }
}
```

### 4.6 Judge 失败时的降级回退

如果 Judge 调用失败（网络错误、超时、解析失败），**不做任何猜测，直接保持当前位置**。

```typescript
// SPEC §4.6 fallback: hold position, do NOT guess
const FALLBACK_RESULT: JudgeResult = { tier: "medium", source: "fallback" };
```

**为什么不用启发式正则：**

- LLM Judge 的全部价值在于语义理解与可扩展
- 一旦添加启发式正则黑名单，就是重新引入“需要维护的关键词列表”
- 启发式的“最劣猜测”可能会随机切到错误档位，破坏缓存
- Judge 挂掉时，保持当前 tier 远比跳到错误 tier 安全

记录一条警告日志供用户调试，不影响路由决策。

---

## 5. 配置系统

### 5.1 配置文件位置

两层配置（按优先级叠加，project 胜出）：

| 层 | 路径 | 用途 | 是否提交 git |
|----|------|------|-------------|
| **User** | `~/.pi/agent/pi-slim-router.json` | 个人偏好（在不同项目中复用） | 否 |
| **Project** | `<cwd>/.pi/pi-slim-router.json` | 团队共享（项目约定） | 是 |

合并顺序：`defaults → user → project`（project 胜出）。

### 5.2 配置结构

```jsonc
{
  "$schema": "./pi-slim-router-schema.json",  // IDE 自动补全支持

  "enabled": true,               // 是否启用智能路由

  "judge": {
    "provider": "auto",          // "auto" 自动选择，或指定 provider 名
    "model": "auto",             // "auto" 自动选择，或指定 model id
    "timeout": 5000              // Judge 调用超时（ms）
  },

  "tiers": {
    "light": {
      "label": "Lightweight",
      "models": [
        { "provider": "deepseek", "model": "deepseek-v4-flash", "priority": 1 }
      ],
      "description": "简单问答、确认、状态查询、重复性任务（同时作为 Judge 模型）"
    },
    "medium": {
      "label": "Balanced",
      "models": [
        { "provider": "deepseek", "model": "deepseek-v4-pro", "priority": 1 }
      ],
      "description": "日常编码、调试、文档、常规分析"
    },
    "flagship": {
      "label": "Flagship",
      "models": [
        { "provider": "opencode-go", "model": "kimi-k3", "priority": 1 }
      ],
      "description": "架构设计、大型重构、安全审计、多步推理"
    }
  },

  "routing": {
    "mode": "auto",              // "auto" | "manual" | "off"

    "upgrade": {
      "immediate": true          // 任何更高 tier 判定 → 立即升级
    },

    "downgrade": {
      "flagship": {
        "minObservations": 4,    // 旗舰→降级：最少观察次数
        "threshold": 0.75        // 旗舰→降级：目标层级占比阈值
      },
      "medium": {
        "minObservations": 3,    // 均衡→降级：最少观察次数
        "threshold": 0.75        // 均衡→降级：目标层级占比阈值
      },
      "maxWindowSize": 10        // 窗口最大容量
    }
  },

  "ux": {
    "quietMode": false,          // true = 静默模式（仅 status bar，不弹 toast）
    "statusBar": true,           // 是否在 Pi 底部状态栏显示
    "inlineToast": true          // 是否在会话中显示切换 toast
  }
}
```

### 5.3 首次启动（已删除：自动分配算法）

~~首次启动时（无配置文件），按模型 input 价格自动分配到三档。~~

**该设计已被移除。** 不同 Provider 之间价格体系不可比，按价格分配会导致模型能力误排。

现在首次启动时三档均为空（`models: []`），插件不干扰 Pi 当前使用的模型。用户可通过 `/router config` 命令手动配置各档位的模型。

启动时若检测到三档配置完全相同（包括初始空状态），会打印提示引导用户配置。

### 5.4 配置验证

启动时验证配置合法性（非致命，作为警告记录）：
- 每个模型的 `provider` 必须在已注册 Provider 中
- 每个模型的 `model` 必须存在
- 同一模型出现在多个 Tier 时警告（路由退化为 pass-through）
- 空 tier 是允许的（三档默认全空，不报错）

---

## 6. 命令系统

### 6.1 命令清单

| 命令 | 功能 | 示例 |
|------|------|------|
| `/router` | 显示当前路由状态 | `/router` |
| `/router on\|off` | 启用/禁用路由 | `/router on` |
| `/router config` | 交互式配置引导 | `/router config` |
| `/router status` | 显示详细状态（窗口、层级、延迟等） | `/router status` |
| `/router quiet` | 切换静默模式 | `/router quiet` |
| `/route-force <tier\|model>` | 强制本轮使用指定模型/层级 | `/route-force flagship` |
| `/route-force auto` | 清除手动覆盖，恢复自动 | `/route-force auto` |

**注：** 原独立命令 `/route-config` 已合并为 `/router config` 子命令；`/route-force` 保留为顶级命令（用户对其语义有认知惯性）。

### 6.2 路由状态显示

```text
┌─ Slim Router ───────────────────────────────┐
│ Status: ✅ Active                             │
│ Mode:   Auto                                  │
│ Tier:   🚀 Flagship → Kimi K3 (opencode-go)   │
│ Judge:  DeepSeek V4 Flash (opencode-go)       │
│                                               │
│ Window: [f, m, l, f, f, f]  (4/4 ≥75%)       │
│ Cache:  warm (6 turns, ~28K tokens prefix)    │
│ Manual: ✗ No override                         │
└───────────────────────────────────────────────┘
```

### 6.3 手动覆盖机制

```
/route-force <tier>          → 使用该 tier 的第一个可用模型
/route-force <provider/model> → 使用精确指定的模型

覆盖行为：
  - 只生效一轮
  - 下一轮用户输入时自动恢复 auto 模式
  - 对覆盖的模型不做 Judge 评估（直接使用）
  - 覆盖结束后，窗口恢复为覆盖前的状态（不清除）
```

---

## 7. UX 设计 — 既要清晰，又不打扰

### 7.1 核心原则

> 用户只应该在路由状态**发生变化**时收到通知。"和上次一样"的情况不产生任何噪音。

| 情况 | 是否通知 | 原因 |
|------|---------|------|
| **Tier 升级**（light→medium, any→flagship） | ✅ 通知 | 任务变复杂，用户需要知道模型已升级 |
| **Tier 降级**（flagship→medium/light, medium→light） | ✅ 通知 | 成本优化行为，应让用户感知 |
| **手动覆盖生效/失效** | ✅ 通知 | 用户操作需要明确反馈 |
| **路由启用/禁用** | ✅ 通知一次 | 状态变更需要确认 |
| **错误**（Judge 失败、模型不可用等） | ✅ 通知 | 需要用户注意 |
| **层级不变** | ❌ 不通知 | 最常见情况，零噪音 |

### 7.2 三通道通知系统

| 通道 | 位置 | 用途 | 显示内容 |
|------|------|------|---------|
| **Status Bar** 🟢 | Pi 底部状态栏（`ctx.ui.setStatus`） | 一直显示当前状态，从不消失 | `⚡L DeepSeek Flash` |
| **Inline Toast** 📋 | 会话中一条消息 | 仅 tier 变更时出现 | 见下方格式 |
| **Detail View** 🔍 | `/route status` 命令 | 完整信息（窗口、计数等） | 完整状态面板 |

### 7.3 Status Bar（常驻）

```
⚡L:DS-Flash | 🦾M:DS-Pro | 🚀F:Kimi-K3     [SlimRouter ✅]
```

格式：`{Tier图标}{层级}:{模型缩写}`，当没有启用路由时显示 SlimRouter ⛔。

### 7.4 Inline Toast（仅变更时出现）

设计要点：**一行内完成，不展开**

```
🔄 Slim Router: 🚀 Kimi K3  ← 检测到复杂架构任务
```

```
🔄 Slim Router: ⚡ DeepSeek Flash
```

```
🔄 Slim Router: 🦾 DeepSeek Pro
```

格式：固定前缀 + 目标 tier 图标 + 模型名。不写原因（原因在 `/route status` 里）。

### 7.5 Detail View

```
┌─ Slim Router ═══════════════════════════════┐
│ Status: ✅ Active                             │
│ Mode:   Auto                                  │
│ Tier:   🚀 Flagship — Kimi K3 (opencode-go)   │
│ Judge:  DeepSeek V4 Flash (opencode-go)       │
│                                                │
│ Window: [f, m, l, f, f, f]  (threshold 4/4)   │
│ History: Flagship(6) Medium(1) Light(1)        │
│ Coverage: ↑83% flagship 下一轮不降级            │
│ Manual: ✗ No override                          │
└════════════════════════════════════════════════┘
```

### 7.6 安静模式（可选）

```jsonc
{
  "ux": {
    "quietMode": false,        // true = 只显示 status bar，不弹 inline toast
    "statusBar": true,          // status bar 总开关
    "inlineToast": true         // inline toast 总开关
  }
}
```

用户如果觉得通知太多，可以 `/router quiet` 一键切换安静模式。

### 7.7 配置向导的 TUI 模型选择器

`/router config` 的模型选择步骤**复用 pi 原生 `/model` 的交互范式**——一个 `Input`（搜索框）+ 一个 10 条视口的列表，所有事件由一个 `ModelPickerComponent` 容器（实现 `Focusable`）统一分发：

- **键入** → 转发给 `searchInput.handleInput()` → 立刻 `fuzzyFilter()` 过滤 → 列表实时缩窄
- **↑ / ↓** → 调整 `selectedIndex`（循环），`updateList()` 重画 10 条
- **PageUp / PageDown** → ±10 跳
- **Enter** → 选中当前行
- **Esc / Ctrl+C** → 取消

视口使用 `startIndex = clamp(selectedIndex - 5, 0, total - 10)`，保证选中行始终大致居中。底部显示滚动指示 `(${selectedIndex + 1}/${total})`。

**实现位置**：`src/tui/model-picker.ts`，基于 `@earendil-works/pi-tui` 的 `Container` / `Input` / `fuzzyFilter` / `getKeybindings` 组件。结构与 pi 内部的 `ModelSelectorComponent` 同构。

**非 TUI 模式**（`-p` 打印 / RPC / JSON）`ctx.ui.custom` 不可用，wizard 自动 fallback 到 `ctx.ui.select()` 平铺列表，label 包含完整 `${provider}/${model}` 路径以保证 Enter 键匹配。

---

## 8. 实现计划

### Phase 1 — 核心引擎

- [x] SPEC 编写 ✓
- [ ] 项目初始化（tsconfig、package.json、构建链）
- [ ] 配置系统（加载/验证/自动分配/缓存）
- [ ] Tier 管理系统（查找模型、优先级排序）
- [ ] pi.setModel() 集成
- [ ] 启发式 Judge（Judge 失败降级）

### Phase 2 — LLM Judge

- [ ] Judge 系统（调用外部 LLM API）
- [ ] Judge Prompt 设计（多语言支持）
- [ ] 缓存敏感窗口算法实现
- [ ] 路由决策引擎（升级/降级/Auto模式）

### Phase 3 — 命令与 UI

- [ ] `/router` 命令（状态显示）
- [ ] `/route-force` 命令（手动模式）
- [ ] `/route-config` 交互式配置引导
- [ ] 路由变更通知机制

### Phase 4 — 发布准备

- [ ] README 编写
- [ ] 错误处理与边界情况
- [ ] 文档（配置说明、架构说明）
- [ ] 发布为 npm pi-package

---

## 9. 边界情况与错误处理

### 9.1 模型不可用

```
场景：pi.setModel(targetModel) 返回 false（API Key 不存在）
处理：
  1. 尝试该 Tier 内 priority 次高的模型
  2. 如果全部失败 → 回退到当前模型（不改动）
  3. 记录错误日志，通知用户
```

### 9.2 无可用 Judge 模型

```
场景：用户只有一个高成本模型，不想用它做 Judge
处理：
  1. 完全启用启发式模式（仅用 heuristics）
  2. 需要至少 2 个不同类型的模型才能自动启用 Judge
  3. 用户可在配置中手动指定 Judge 模型
```

### 9.3 单 Provider/单模型用户

```
场景：用户只有一个 Provider 和一个模型
处理：
  1. 自动检测 → 禁用 Slim Router（无路由必要）
  2. 显示提示："只有 1 个模型可用，路由器无必要的路由选择。"
```

### 9.4 窗口无限增长

```
场景：长期对话，窗口无限累积
处理：
  maxWindowSize = 10（默认）
  超出的最早记录被丢弃
```

### 9.5 手动覆盖后恢复

```
场景：用户 /route-force flagship 执行一轮，下一轮恢复 auto
处理：
  1. 清除手动覆盖标记
  2. 窗口保持覆盖前的状态（不清除）
  3. 对新的用户输入执行正常的 Judge + 趋势检测
```

---

## 10. 技术决策

### 10.1 为什么使用 Pi-agent Extension API 而非独立服务

- **复用 Provider 配置**：直接读取 auth.json + models-store.json
- **会话上下文**：Extension 可以访问当前会话，无需额外状态同步
- **无缝集成**：`pi.setModel()` 是原生 API，切换模型后上下文自动保留
- **零部署**：用户只需安装 Extension，开箱即用

### 10.2 为什么 Judge 用直连 API 而非通过 Pi 推理管道

- **速度**：直接 API 调用比经过 Pi 的完整推理流程快（省掉 system prompt 拼接、工具注册、session 管理等开销）
- **控制**：可以精确控制 Judge 的 max_tokens、temperature，不受当前模型影响
- **成本**：用最便宜的模型做 Judge，几毛钱成本
- **独立性**：Judge 不受当前会话模型切换影响（Judge 和业务模型走不同的通道）
- **架构清晰**：
  ```
  ┌──── 用户输入 ────┐
       │          
       ├──► [Judge 管道]  fetch() → Provider API → tier 判定  ← 直连
       │
       └──► [业务管道]  Pi Agent Loop → pi.setModel(判定结果) → 正常对话  ← 走 Pi
  ```

### 10.3 为什么选择滑动窗口而非 Markov chain 等更复杂的算法

- **可解释性**：窗口内容可以完整展示给用户
- **简单可靠**：参数少、调优容易
- **计算成本**：O(n) 实时计算，零额外 API 调用
- **足够有效**：75% 阈值 + 最少观察次数的组合，已经能覆盖所有实际场景

---

## 11. 项目结构

```
pi-slim-router/
├── SPEC.md                     # 本文件
├── package.json                # npm 包描述（pi-package，含 pi 清单）
├── tsconfig.json               # TypeScript 配置
├── README.md                   # 用户文档
├── CONTRIBUTING.md             # 贡献指南
├── CHANGELOG.md                # 变更日志
├── LICENSE                     # Apache 2.0
│
├── src/
│   ├── index.ts                # Extension 入口
│   ├── config.ts               # 配置加载/验证/缓存（用户级 + 项目级双层）
│   ├── router.ts               # 路由引擎（趋势检测、切换决策）
│   ├── judge.ts                # LLM Judge 调用（无 fallback regex）
│   ├── tier.ts                 # Tier 管理（模型查找）
│   ├── commands.ts             # 命令注册（/router, /route-force 等）
│   ├── types.ts                # TypeScript 类型定义
│   └── prompts/
│       └── judge.md            # Judge 系统 Prompt（唯一真相源）
│
├── tests/                      # vitest 测试套件
│   └── router.test.ts          # 路由算法 + judge fallback 测试
│
├── scripts/
│   └── copy-assets.mjs         # 构建后拷贝非 TS 资源到 dist/
│
└── dist/                       # 构建产物（发布到 npm）
```

发布时通过 `package.json` 的 `pi` 清单注册：

```json
{
  "name": "pi-slim-router",
  "version": "0.1.0",
  "keywords": ["pi-package", "pi-extension"],
  "pi": {
    "extensions": ["./dist/index.js"],
    "minPiVersion": "0.80.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.80.0",
    "typebox": ">=0.30.0"
  }
}
```

## 12. Pi-agent 扩展规范遵循

作为正式发布的 pi-package，本项目遵循以下规范：

- **`pi.extensions` 指向编译产物 `dist/index.js`**（非 `src/`），与 pi-shazam / pi-smart-router 等成熟扩展保持一致
- **`pi.minPiVersion` 显式声明兼容版本**，避免在过低版本的 pi 上加载时崩溃
- **peerDependencies 仅声明 pi-coding-agent 与 typebox**，不引入运行时依赖
- **配置双层（用户级 + 项目级）**，符合 pi-agent 生态约定
- **错误永不抛出到 pi 主循环**，所有 catch 路径只 console.warn
- **测试覆盖核心算法**（vitest，§3 路由规则 + §4.6 fallback）
