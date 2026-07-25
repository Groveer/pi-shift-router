# Slim Router — Pi-agent 智能路由扩展

## 1. 概述

**Slim Router** 是 Pi-agent 的一个 Extension，实现**跨 Provider、跨模型智能路由**。根据每轮任务需要的**心智模式**（执行 vs 判断），自动选择最优模型。

**项目名：** pi-slim-router（npm 包名）· 仓库 green-dalii/pi-slim-router

### 核心价值

- **质量**：在规划、审核、架构设计等关键环节，自动使用更高智力级别的模型（CTO 模式）
- **成本**：在日常编码、修 bug、写测试等执行阶段，自动使用性价比更高的模型（程序员模式）
- **速度**：执行阶段用低成本模型，响应更快；判断阶段用高智力模型，决策更准
- **零干扰**：两挡默认全部为空，不干扰 Pi 默认模型；用户运行 `/router config` 按需配置

### 类比：CTO 和程序员

> Smart 模式 = CTO（工作量小但极其重要）：架构设计、方案评估、代码审查、路线选择
> Fast 模式 = 程序员（工作量大但模式明确）：写代码、修 bug、写测试、加注释

不是所有任务都需要 CTO 级别的智力，但当一个项目中缺少 CTO 的把关，质量底线就会下降。

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
│  │  ① LLM Judge (用 Fast 挡的模型，~$0.00007/轮)      │   │
│  │     ↓                                               │   │
│  │  ② processRoute()                                   │   │
│  │     ├─ Judge→smart & current=fast → UPGRADE (立即)  │   │
│  │     ├─ Judge→fast & current=smart → 检查窗口↓       │   │
│  │     └─ 否则 → STAY                                 │   │
│  │     ↓                                               │   │
│  │  ③ pi.setModel() (如果需要切换)                     │   │
│  │     ↓                                               │   │
│  │  ④ 状态栏更新 + 可选通知                            │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
│  Agent 开始工作                                          │
│  (多次 Thinking + Tool call, 固定模型)                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

每次 `before_agent_start` = 一轮 agent 循环（含多次 tool call / thinking）。**模型在一轮内部固定不变**。

### 2.2 层级定义

| Tier | 定位 | 适用场景 |
|------|------|---------|
| **🧠 Smart (CTO)** | 判断模式：评估、规划、审核、方向性决策 | 架构设计、方案评估、代码审查、安全审计、性能优化、技术选型。**工作少但关键** |
| **🦾 Fast (程序员)** | 执行模式：遵循已知模式的日常开发 | 写代码、修 bug、写测试、写文档、加注释、小重构。**工作多但模式明确** |

### 2.3 层级之间的转换规则

```
   Fast (execution)  ←───────────────→  Smart (judgment)
         ↑                                     ↑
    immediate on                        window majority
    "smart" judge                       (≥60% of last 5)
```

| 方向 | 条件 | 原理 |
|------|------|------|
| **↑ fast → smart** | **立即** | 质量优先。1 次 Judge 判定 smart 即切换 |
| **↓ smart → fast** | **窗口多数** | 缓存保护。最近 5 轮 ≥60% 为 fast 才降级 |

**升级时清空窗口**。降级后窗口继续累积。

---

## 3. 窗口趋势检测算法

### 3.1 设计原则

两挡设计的窗口比三挡大为简化，只有一个关注点：**何时允许从 smart 降回 fast**。

- 升级始终即时，不需要窗口（因为升级总是正确的方向）
- 降级需要确认趋势，防止因单一"ok"、"谢谢"等消息触发不必要的模型切换

### 3.2 滑动窗口

```
窗口上限 = config.routing.window.size（默认 5）
降级阈值 = config.routing.window.threshold（默认 0.6）

降级条件（smart → fast）：
  window.filter(tier === "fast").length / window.length ≥ threshold

窗口处理：
  - 每次 processRoute 后 push 当前 Judge 结果
  - 超出 size 上限时丢弃最早记录
  - 升级时清空窗口
```

### 3.3 场景推演

```
初始状态：Fast

t1: "写一个排序函数"        Judge→fast    保持 fast    窗口: [fast]
t2: "设计用户鉴权架构"      Judge→smart   升级 smart   窗口: []（清空）
t3: "把这个鉴权加上"        Judge→fast    保持 smart   窗口: [fast]
t4: "补充注释"              Judge→fast    保持 smart   窗口: [fast, fast]
t5: "写单元测试"            Judge→fast    降级 fast   窗口: [fast, fast, fast]（3/5≥60%）
t6: "这个方案对不对？"      Judge→smart   升级 smart   窗口: []（清空）
```

---

## 4. LLM Judge 系统

### 4.1 为什么用 LLM 做 Judge

- **语义理解**：正则无法判断"这支付系统的架构设计"和"查下天气预报"的区别
- **适应性强**：不需要维护关键词黑/白名单，同一套 prompt 适配中英文
- **零维护**：换 prompt 即可调整行为，无须改代码
- **成本极低**：使用 **Fast 挡模型**执行判断，DeepSeek Flash 级别模型 ≈ $0.00007/轮

### 4.2 Judge Prompt 设计

Judge 的分类维度是**心智模式**而非话题：

```
## fast (programmer mode)
- Writing code, fixing bugs, adding tests, small refactors
- Following an already-established design or pattern
- Reading, explaining, summarizing existing code
- Repetitive, well-scoped, or well-defined tasks
- "Make it work" — the path is clear, just needs execution

## smart (cto mode)
- Architectural design, system design, technology selection
- Code review, design review, quality assessment
- Planning, multi-step strategy, ambiguous requirements
- Security audit, performance optimization investigation
- "Is this the right approach?" — the path is not yet clear
```

### 4.3 Judge 模型的选择

Judge 使用 **Fast 挡的第一个模型**：

1. 首选：`config.tiers.fast.models[0]`（用户配置的执行模型，通常最便宜）
2. 降级：有 API Key 的最便宜的模型

**为什么用 Fast 模型做 Judge？**
- Fast 挡模型虽然是执行型，但**分类任务远比重建代码简单**。DeepSeek V4 Flash / Claude Sonnet 足以准确做出二分类
- 成本极低（对比 Smart 模型 $15/M，Fast 模型 $0.15/M => 100 倍差）
- 避免鸡生蛋问题（用 Smart 模型判断"该不该用 Smart"在逻辑上是对的，但在成本上违背了路由目的）

### 4.4 Judge API 调用

直连管道，不经过 Pi Agent Loop：

```typescript
// 超时 5s（config.routing.judgeTimeout），超时后返回 fallback
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeout);
const result = await classifyLLM(prompt, fastEndpoint, controller.signal);
clearTimeout(timer);
```

支持 OpenAI-compatible 和 Anthropic 两种 API 格式。

### 4.5 Judge 失败时的降级回退

**没有启发式规则**。当 LLM Judge 不可用时，返回 `{ tier: "fast", source: "fallback" }`。Router 处理为 stay（当前挡位不变），只打日志不干扰用户。

---

## 5. 配置系统

### 5.1 配置文件位置

| 层级 | 路径 | 优先级 | 用途 |
|------|------|--------|------|
| 默认 | `types.ts` 的 `DEFAULT_CONFIG` | 最低 | 代码内嵌默认值 |
| 用户 | `~/.pi/agent/pi-slim-router.json` | 中 | 个人偏好，git 不跟踪 |
| 项目 | `<cwd>/.pi/pi-slim-router.json` | **最高** | 团队共享，git 跟踪 |

**加载顺序**：defaults ← user ← project（project 覆盖一切）。

### 5.2 配置结构

```typescript
interface SlimRouterConfig {
  enabled: boolean;
  tiers: {
    fast:  TierConfig;   // 执行模型
    smart: TierConfig;   // 判断模型
  };
  routing: {
    mode: "auto" | "manual" | "off";
    judgeTimeout: number;  // ms，默认 5000
    window: { size: number; threshold: number };  // 默认 {5, 0.6}
  };
  ux: {
    quietMode: boolean;
    statusBar: boolean;
    inlineToast: boolean;
  };
}
```

### 5.3 配置验证

`validateConfig()` 仅做警告：

| 情况 | 处理 |
|------|------|
| 挡位为空 | 无警告（空挡 = 不启用该挡的路由功能） |
| Provider 不存在 | 警告 |
| 模型不存在 | 警告 |
| 两挡相同模型 | 警告（路由无意义） |

**不阻塞启动**。验证失败不影响 Pi 使用。

---

## 6. 命令系统

### 6.1 命令清单

| 命令 | 功能 |
|------|------|
| `/router status` | 显示当前挡位、模型、窗口状态、配置摘要 |
| `/router on` | 启用路由 |
| `/router off` | 禁用路由 — pi 回退到默认模型 |
| `/router config` | 打开交互式配置向导（TUI） |
| `/router quiet` | 切换安静模式（开关） |
| `/route-force <tier\|model>` | 手动覆盖下一轮模型 |

### 6.2 `/router status` 输出

```
Mode: AUTO  Enabled: ✅  Quiet: 🔇

Current: [🧠 kimi-k3]
Window: [s, f, f, f]  (4 entries)
Counts: S=1 F=3
Manual: ✗ None

Config: /project/.pi/pi-slim-router.json

  🦾 Fast         deepseek/deepseek-v4-flash
  🧠 Smart        kimi/kimi-k3
```

### 6.3 手动覆盖机制

`/route-force fast` 或 `/route-force smart` 或 `/route-force provider/model`：

- 强制使用指定模型/挡位，持续**一轮**
- 下一轮 `before_agent_start` 结束后自动清除
- 适合用户临时需要某一级别智力的场景

---

## 7. UX 设计

### 7.1 核心原则

> 用户只应该**在挡位发生变化时**收到通知。

| 情况 | 是否通知 | 原因 |
|------|---------|------|
| **升级**（fast→smart） | ✅ 通知 | 用户需要知道模型已升级处理复杂任务 |
| **降级**（smart→fast） | ✅ 通知 | 成本优化行为，应让用户感知 |
| **保持** | ❌ 不通知 | "和上次一样"无信息量 |

### 7.2 三通道通知系统

| 通道 | 位置 | 内容 | 行为 |
|------|------|------|------|
| **Status Bar**（常驻） | 底部 footer | `[🧠 kimi-k3]` | 持续显示当前状态，可供用户眼 |
| **Inline Toast**（挡位切换） | 消息流 | `[🧠 kimi-k3]` | 切换时出现，不打扰 |
| **Detail View**（命令） | `/router status` | 完整状态 | 用户主动查询 |

### 7.3 安静模式

`/router quiet` 或 UX 设置中禁用 Inline Toast。状态栏仍然显示。适合对通知敏感的用
户。

### 7.4 配置向导的 TUI 模型选择器

`/router config` 的模型选择步骤复用 pi 原生 `/model` 的交互——一个 `Input`（搜索框）+ 一
个 10 条视口的列表，所有事件由一个 `ModelPickerComponent` 容器统一分发。

**实现位置**：`src/tui/model-picker.ts`，基于 `@earendil-works/pi-tui`。

**非 TUI 模式**：自动 fallback 到 `ctx.ui.select()` 平铺列表。

---

## 8. 实现计划

### Phase 1 — 核心引擎 ✓

- [x] SPEC 编写
- [x] 项目初始化（tsconfig、package.json、构建链）
- [x] 配置系统（加载/验证/缓存）
- [x] Tier 管理系统（查找模型、优先级排序）
- [x] pi.setModel() 集成
- [x] LLM Judge（调用外部 LLM API）
- [x] 滑动窗口算法

### Phase 2 — 交互配置 ✓

- [x] `/router config` 交互向导
- [x] TUI 模型选择器（匹配 pi 原生 `/model` UX）
- [x] Provider-first 流程：选 Provider → 选模型
- [x] 两挡配置：Fast + Smart
- [x] 用户/项目双层保存

### Phase 3 — 社区建设

- [ ] npm publish
- [ ] 多语言 Judge Prompt（英文已验证，中文/日文）
- [ ] 性能基准：分类准确率、延迟分布、缓存命中率
- [ ] 用户反馈收集

### Phase 4 — 可选增强

- [ ] 缓存感知路由：当两挡模型属于同一 Provider 系列时，窗口阈值自动调高
- [ ] 自定义 Judge Prompt 路径
- [ ] 统计面板：会话级成本节省报告
