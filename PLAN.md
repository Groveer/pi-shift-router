# Slim Router — Development Plan

## Phase Status

| Phase | Status |
|-------|--------|
| Phase 1 — Core Engine + Heuristic + Basic UI | ✅ Done |
| Phase 2 — LLM Judge | ✅ Done |
| Phase 3 — Interactive Config Wizard | ✅ Done |
| Phase 4 — Polish & Publish | ⏳ Next |

## File Structure

### 文件结构

```
pi-slim-router/
├── package.json            # pi-package manifest
├── tsconfig.json           # TypeScript config (IDE support)
├── src/
│   ├── index.ts            # Extension entry: events + command/tool registration
│   ├── types.ts            # All TypeScript types
│   ├── config.ts           # Config loader (read+parse+validate+cache)
│   ├── tier.ts             # Tier manager (model lookup, auto-assign, priority)
│   ├── judge.ts            # Task classifier (heuristic, Phase 2: +LLM)
│   ├── router.ts           # Route engine: sliding window, upgrade/downgrade logic
│   └── commands.ts         # /router, /route-force, /route status
└── prompts/
    └── judge.md            # Judge system prompt (Phase 2)
```

### 依赖关系

```
index.ts
  ├── config.ts   →  types.ts
  ├── router.ts   →  types.ts, config.ts, tier.ts, judge.ts
  ├── tier.ts     →  types.ts, config.ts
  ├── judge.ts    →  types.ts
  └── commands.ts →  types.ts, config.ts, router.ts
```

### 各模块职责

| 模块 | MVP 核心能力 | 后续扩展 |
|------|-------------|---------|
| **config.ts** | 读 `models-store.json` + 自动分配 Tier + 读/写 `pi-slim-router.json` | Schema 验证、远程配置 |
| **tier.ts** | 查找本 Tier 可用模型、priority 降级 | 动态模型发现 |
| **judge.ts** | 启发式分类（长度 + 关键词 + 多语言） | LLM Judge（fetch 直连） |
| **router.ts** | 滑动窗口维护 + 升级/降级决策 + 调用 `pi.setModel()` | 持久化窗口状态 |
| **commands.ts** | `/router`, `/route-force`, `/route status` | `/route-config` 交互向导 |
| **index.ts** | `session_start` 初始化 + `before_agent_start` 注入路由 | 更丰富的生命周期管理 |

### 实现顺序

1. `types.ts` — 类型定义（无依赖）
2. `config.ts` — 配置加载（只依赖 types.ts）
3. `tier.ts` — Tier 管理（依赖 types.ts, config.ts）
4. `judge.ts` — 启发式分类器（依赖 types.ts）
5. `router.ts` — 路由引擎（依赖所有以上模块）
6. `commands.ts` — 命令（依赖 types.ts, config.ts, router.ts）
7. `index.ts` — 入口组装（依赖所有模块）

### 状态管理

MVP 暂不持久化窗口状态到 session。每次 `session_start` 重置窗口。
后续通过 `pi.appendEntry()` 实现持久化。

### 测试策略

MVP 阶段通过手动在 Pi 中加载使用来验证。后续添加单元测试。
