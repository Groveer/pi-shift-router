# Slim Router — Development Principles

## 代码哲学

- **简洁 > 复杂**。多一行就多一个错误入口。能不用 if 就不用 if。能用表达式就别用语句。
- **删代码比加代码更有价值**。每次提交前问自己：这段代码现在真的需要吗？
- **消灭重复**（DRY）。如果两处做类似的事，提取抽象。如果三处，设计模式。
- **显式 > 隐式**。不依赖副作用，不藏状态，不靠"巧合"工作。
- **小文件 > 大文件**。一个文件做一件事，做好。
- **平铺 > 嵌套**。超过两层缩进就是重构信号。提前 return 解嵌套。
- **测试不是可选项**。核心算法必须有测试覆盖。不做 TDD 但要补测试。

## 代码标准

- **TypeScript only**。严禁 `any`（除非对接 pi-agent 未公开 API）。优先 interface 而非 type。
- **没有类**（除非真的需要状态+行为封装）。纯函数 + 数据结构。
- **没有第三方依赖**（除了 pi-agent SDK、pi-tui 和 typebox）。运行时依赖仅 `@earendil-works/pi-coding-agent`（由宿主提供，类型 devDep 列 `@earendil-works/pi-tui` 用于本地构建）。零外部库。
- **副作用隔离**。纯函数在顶层，IO 传进来。
- **错误用返回处理，不吞异常**。`console.warn` 然后 fallback，不崩。

## 架构原则

- **两挡 > 三挡**。执行（fast）vs 判断（smart）是唯一有意义的分类轴。去掉 light 挡（在 Pi 语境中几乎不会用到）。
- **LLM Judge > 正则规则**。不维护 keyword 列表。LLM 是唯一的分类器。失败时 hold 当前挡位。
- **session_start 只读不写**。尊重用户的默认模型选择，不在用户不知情时覆盖。
- **模块单向依赖**：`index.ts` → `router.ts` → `judge.ts|tier.ts` → `config.ts` → `types.ts`。TUI 组件单独放在 `src/tui/`，不污染核心算法。
- **配置下沉**：魔法数字不出现，全部收敛到 `types.ts` 的 `DEFAULT_CONFIG`。
- **接入点唯一**：pi-agent 的生命周期 hook 只通过 `index.ts` 注册。其他模块不直接接触 pi API。
- **状态集中**：`RouterState` 是唯一 mutable 状态对象。函数接收它、修改它、返回它。
- **TUI 组件必须自己 handleInput**：实现 `Focusable` 的组件拦截所有键盘，自己分发到子组件（Input / list）。不要依赖 TUI 自动派发——`Container` 不会自动把键盘路由到第一个 `Focusable` 子组件。

## 协作约定

- 对着 SPEC 开发。SPEC 没写的先讨论再动手。
- 开发分 Phase。MVP 先跑通核心路径，再迭代完善。
- git commit 信息包含模块前缀（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`）。
- 任何原则性变更必须先更新 SPEC，再改代码。
