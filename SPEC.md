# pi-shift-router — Pi-agent Intelligent Model Router

## 1. Overview

**pi-shift-router** is a [pi-agent](https://github.com/earendil-works/pi-coding-agent) extension that performs **cross-provider, cross-model intelligent routing**. On every turn it classifies the task's **mental mode** (execution vs judgment) and selects the best-fit model automatically.

**Project:** `pi-shift-router` (npm) · Repository: [green-dalii/pi-shift-router](https://github.com/green-dalii/pi-shift-router)

### Core Value

- **Quality**: critical steps (planning, review, architecture) automatically use the higher-intelligence model (Smart / CTO mode).
- **Cost**: everyday execution (coding, debugging, testing) automatically uses the cheaper model (Fast / Programmer mode).
- **Speed**: cheap models respond faster on execution tasks; strong models think more carefully on judgment tasks.
- **Zero interference by default**: both tiers start empty. The router does nothing until you assign models via `/router config`.

### The CTO / Programmer Analogy

> **Smart = CTO** (small workload, critically important): architecture, evaluation, code review, route selection.
> **Fast = Programmer** (large workload, well-defined patterns): writing code, fixing bugs, adding tests, writing comments.

Not every task needs CTO-level intelligence. But projects without CTO oversight don't sustain quality.

---

## 2. Architecture

### 2.1 End-to-End Flow

```
User sends message
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│  Pi-agent before_agent_start event                          │
│                                                              │
│  ┌─── pi-shift-router ──────────────────────────────────┐       │
│  │                                                    │       │
│  │  ① Status bar: "⚖ judging…" (transient)           │       │
│  │      ↓                                              │       │
│  │  ② LLM Judge (uses Fast tier's model, ~$0.0006/call) │       │
│  │      ↓                                              │       │
│  │  ③ processRoute()                                   │       │
│  │     ├─ judge→smart  & current=fast → UPGRADE (now)  │       │
│  │     ├─ judge→fast   & current=smart → check window  │       │
│  │     └─ otherwise                                STAY │       │
│  │      ↓                                              │       │
│  │  ④ pi.setModel() if switchTo                         │       │
│  │      ↓                                              │       │
│  │  ⑤ Status bar restored + optional toast              │       │
│  │                                                    │       │
│  └────────────────────────────────────────────────────┘       │
│                                                              │
│  Agent starts working                                        │
│  (multiple thinking + tool calls — model stays fixed)        │
│                                                              │
└────────────────────────────────────────────────────────────┘
```

`before_agent_start` fires once per turn. The **model does not change during a turn**, even across multiple tool calls and thinking steps.

### 2.2 Tiers

| Tier | Mental Mode | Use Cases |
|------|-------------|-----------|
| **🧠 Smart (CTO)** | Judgment: evaluation, planning, review, direction-setting | Architecture design, technology selection, code review, security audit, performance optimization. **Small workload, critically important.** |
| **🦾 Fast (Programmer)** | Execution: following known patterns | Writing code, fixing bugs, adding tests, writing docs, adding comments, small refactors. **Large workload, well-defined patterns.** |

### 2.3 Transition Rules

```
   Fast (execution)  ←───────────────→  Smart (judgment)
         ↑                                     ↑
    immediate on                        window majority
    "smart" judge                       (≥60% of last 5)
```

| Direction | Condition | Rationale |
|-----------|-----------|-----------|
| **↑ fast → smart** | **Immediate** | Quality first. A single "smart" judge triggers the upgrade. |
| **↓ smart → fast** | **Window majority** | Cache protection. Requires ≥60% of the last 5 turns to be "fast". |

The window is cleared on upgrade. Downgrades accumulate entries normally.

---

## 3. Sliding Window Trend Detection

### 3.1 Design Principle

Two-tier design reduces the window problem to a single question: **when is it safe to drop from smart back to fast?**

- Upgrades are always immediate — no window needed.
- Downgrades require trend confirmation, to prevent a single "ok" / "thanks" from triggering an unnecessary model switch.

### 3.2 Window

```
Window size = config.routing.window.size           (default 5)
Threshold    = config.routing.window.threshold     (default 0.6)

Downgrade condition (smart → fast):
  window.filter(tier === "fast").length / window.length ≥ threshold

Window lifecycle:
  - Each processRoute pushes the current judge result.
  - When size is exceeded, the oldest entries are discarded.
  - On upgrade, the window is cleared.
```

### 3.3 Worked Example

```
Initial: Fast

t1: "Write a sort function"           Judge→fast   stay Fast     window=[fast]
t2: "Design the auth architecture"    Judge→smart  upgrade Smart  window=[] (cleared)
t3: "Add the auth to the routes"      Judge→fast   stay Smart    window=[fast]
t4: "Add comments"                    Judge→fast   stay Smart    window=[fast, fast]
t5: "Write unit tests"                Judge→fast   DOWNGRADE Fast window=[fast, fast, fast]  (3/5 ≥ 60%)
t6: "Is this approach correct?"       Judge→smart  upgrade Smart  window=[] (cleared)
```

---

## 4. LLM Judge

### 4.1 Why an LLM Judge

- **Semantic understanding**: regex can't distinguish "design this payment system's architecture" from "what's the weather".
- **Multi-lingual out of the box**: one prompt serves Chinese, English, Japanese, etc.
- **Zero maintenance**: change the prompt to change behavior — no code changes.
- **Cost is negligible**: with Fast tier models at ~$0.15/M tokens, a 4K-token judge call is ~$0.0006.

### 4.2 Judge Prompt

The Judge classifies by **mental mode**, not topic. The prompt lives in [`src/prompts/judge.md`](src/prompts/judge.md) and is loaded at module init.

**Output format (enforced at API level):** the Judge must respond with valid JSON:

```json
{"tier": "fast"}
```

or

```json
{"tier": "smart"}
```

The prompt explicitly requests JSON-only output, and the API call adds a hard constraint:
- **OpenAI-compatible** (DeepSeek, OpenAI, etc.): `response_format: { type: "json_object" }` — the API rejects non-JSON completions.
- **Anthropic**: assistant message prefill of `{` — forces the model to start its response with the JSON opener.

### 4.3 Judge Model Selection

The Judge uses the **Fast tier's first model**:

1. Primary: `config.tiers.fast.models[0]` — the user-chosen execution model, usually the cheapest.
2. Fallback: any model with a valid API key (cheapest first).

**Why use the Fast model for judging?**

- The Fast model may be optimized for execution, but **classification is far simpler than code generation**. DeepSeek V4 Flash / Claude Sonnet handle the binary split reliably.
- Cost gap is enormous (Smart at $15/M vs Fast at $0.15/M ≈ 100×). Using Smart for judging would defeat the routing purpose.
- Avoids a circularity: "use the most expensive model to decide when to use the most expensive model."

### 4.4 API Call

The Judge calls the provider API directly (not through pi's agent loop):

```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), config.routing.judgeTimeout); // 5s default
const result = await fetch(url, { /* headers + body */, signal: controller.signal });
clearTimeout(timer);
```

Both OpenAI-compatible (`/chat/completions`) and Anthropic (`/v1/messages`) API formats are supported. `max_tokens: 4000` leaves enough room for chain-of-thought reasoning on DeepSeek Reasoner-class models.

### 4.5 Parse Strategy

`parseResponse()` uses a three-layer fallback:

1. **JSON parse**: matches `{"tier":"fast"}` or `{"tier":"smart"}` anywhere in the response.
2. **Loose JSON**: tolerates missing quotes (`{tier:fast}`).
3. **Bare keyword**: extracts the first occurrence of `fast` or `smart`.

For CoT models (e.g., DeepSeek Reasoner) that emit a separate `reasoning_content` field, the parser first tries `content`, then falls back to `reasoning_content`.

### 4.6 Judge Failure Fallback

There is **no heuristic rule** as a fallback. When the LLM Judge is unavailable (network error, auth error, malformed response), the Judge returns `{ tier: "fast", source: "fallback" }`. The router treats this as `stay` (no model switch) and only logs a warning. The user is not interrupted.

---

## 5. Configuration System

### 5.1 Config File Locations

| Layer | Path | Priority | Use |
|-------|------|----------|-----|
| Default | `DEFAULT_CONFIG` in `types.ts` | Lowest | Code-embedded defaults |
| User | `~/.pi/agent/pi-shift-router.json` | Medium | Personal preferences, not git-tracked |
| Project | `<cwd>/.pi/pi-shift-router.json` | **Highest** | Team-shared, git-tracked |

**Load order:** defaults ← user ← project (project wins on conflict).

### 5.2 Config Structure

```typescript
interface ShiftRouterConfig {
  enabled: boolean;
  tiers: {
    fast:  TierConfig;   // execution model
    smart: TierConfig;   // judgment model
  };
  routing: {
    mode: "auto" | "manual" | "off";
    judgeTimeout: number;                                  // ms, default 5000
    window: { size: number; threshold: number };           // default {5, 0.6}
  };
  ux: {
    quietMode: boolean;
    statusBar: boolean;
    inlineToast: boolean;
    routerLogVerbose: boolean;
  };
}
```

### 5.3 Validation

`validateConfig()` issues warnings only — never blocks startup:

| Case | Action |
|------|--------|
| Empty tier | No warning (empty tier means that tier simply isn't routed) |
| Provider missing | Warning |
| Model missing in provider | Warning |
| Both tiers identical | Warning (routing becomes a no-op) |

---

## 6. Commands

### 6.1 Command Reference

| Command | Function |
|---------|----------|
| `/router status` | Show current tier, model, window state, and config summary |
| `/router on` | Enable routing |
| `/router off` | Disable routing — pi falls back to its default model |
| `/router config` | Open the interactive configuration wizard (TUI) |
| `/router quiet` | Toggle inline toast notifications |
| `/router verbose` | Toggle verbose logging to console (for advanced debugging) |
| `/route-force <tier\|model>` | Manually override the next turn's model |

### 6.2 `/router status` Output

```
Mode: AUTO  Enabled: ✅  Quiet: 🔇

Current: [🧠 kimi-k3]
Window: [s, f, f, f]  (4 entries)
Counts: S=1 F=3
Manual: ✗ None

Config: /project/.pi/pi-shift-router.json

  🦾 Fast         deepseek/deepseek-v4-flash
  🧠 Smart        kimi/kimi-k3
```

### 6.3 Manual Override

`/route-force fast` | `/route-force smart` | `/route-force provider/model`:

- Forces the specified model/tier for **one turn**.
- Auto-clears after `before_agent_start` completes.
- Use cases: temporary need for a specific intelligence level, debugging.

---

## 7. UX Design

### 7.1 Core Principle

> The user should only be notified when the routing state **changes**.

| Situation | Notify? | Why |
|-----------|---------|-----|
| **Upgrade** (fast → smart) | ✅ Yes | User should know the model upgraded for a complex task |
| **Downgrade** (smart → fast) | ✅ Yes | Cost optimization, user should perceive |
| **Stay** | ❌ No | "Same as before" carries no information |

### 7.2 Three-Channel Notification

| Channel | Location | Content | Behavior |
|---------|----------|---------|----------|
| **Status Bar** (persistent) | Bottom footer | `[🧠 kimi-k3]` | Always visible. User can glance. |
| **Inline Toast** (on change) | Message stream | `[🧠 kimi-k3]` | Appears on tier change, non-intrusive |
| **Detail View** (on demand) | `/router status` | Full state | User queries explicitly |

### 7.3 Transient Judging Indicator

While the Judge API call is in flight, the status bar shows **`⚖ judging…`** instead of the current model badge. This gives the user feedback that the router is working during the 200ms–2s Judge latency, instead of a silent delay between "press enter" and "first token streams".

The indicator is restored via `try/finally`, so even if `classify()` throws, the status bar returns to its normal state.

### 7.4 Quiet Mode

`/router quiet` or the UX settings toggle suppresses inline toast. Status bar still shows the current model. For users sensitive to notifications.

### 7.5 Verbose Logging

For advanced users debugging routing decisions:

- Toggle: `/router verbose`, `/router config` → UX settings, or directly in JSON (`ux.routerLogVerbose: true`)
- Output: prints prompt preview, judge call details (URL, raw response), decision, and model switch result on every turn.
- Output destination: console (visible when running pi in a terminal).

### 7.6 TUI Model Picker (Wizard)

`/router config`'s model selection step mirrors pi's native `/model` UX:

- `Input` (search box) + 10-item viewport list, all events routed by a `ModelPickerComponent` container (implements `Focusable`).
- Type-to-filter via `fuzzyFilter` from pi-tui.
- Up/Down navigation, Enter to confirm, Esc to cancel.

**Implementation:** `src/tui/model-picker.ts`, built on `@earendil-works/pi-tui`.

**Non-TUI modes:** automatically falls back to `ctx.ui.select()` flat list with full `${provider}/${model}` keys in labels.

---

## 8. Implementation Status

| Phase | Status | Version | Notes |
|-------|--------|---------|-------|
| SPEC authoring | ✅ | — | Initial SPEC written |
| Project bootstrap (tsconfig, package.json, build) | ✅ | v0.1.0 | TypeScript strict mode, vitest |
| Config system (load/validate/cache) | ✅ | v0.1.0 | User + project layers |
| Tier management (model lookup, priority) | ✅ | v0.1.0 | `findBestModelForTier()` |
| LLM Judge (direct API call) | ✅ | v0.1.0 | Originally heuristic + LLM |
| Sliding window algorithm | ✅ | v0.1.0 | Three-tier version |
| pi-agent lifecycle integration | ✅ | v0.1.0 | `session_start` + `before_agent_start` |
| TUI model picker | ✅ | v0.2.0 | Mirrors pi's `/model` UX |
| Provider-first wizard flow | ✅ | v0.2.0 | Pick provider → pick model |
| Two-tier redesign (CTO / Programmer) | ✅ | v0.3.0 | Removed `light`/`medium`/`flagship` |
| Judge JSON-mode enforcement | ✅ | v0.3.1 | API-level hard constraints |
| Transient judging indicator | ✅ | v0.3.1 | Status bar `⚖ judging…` |
| Verbose logging | ✅ | v0.3.1 | `ux.routerLogVerbose` |
| **Publish to npm** | ⏳ Next | — | Final QA + release |

## 9. Future Direction (Optional Enhancements)

- **Cache-aware routing**: when both tiers share a Provider family (e.g., both Anthropic), automatically raise the downgrade threshold to avoid cache thrashing.
- **Multilingual Judge prompt validation**: confirm `judge.md` works correctly across Chinese, Japanese, Spanish, etc.
- **Per-session cost statistics**: show users how much they've saved.
- **Tool-result classification**: classify tool calls (long shell output may indicate debugging, not a question).