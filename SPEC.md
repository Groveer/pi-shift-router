# pi-shift-router — Pi-agent Intelligent Model Router

## 1. Overview

**pi-shift-router** is a [pi-agent](https://github.com/earendil-works/pi-coding-agent) extension that performs **cross-provider, cross-model intelligent routing**. On every turn it classifies the task's **mental mode** (execution vs judgment) and selects the best-fit model automatically.

**Project:** `pi-shift-router` (npm) · Repository: [green-dalii/pi-shift-router](https://github.com/green-dalii/pi-shift-router)

### Core Value

- **Quality**: complex, high-stakes, or irreversible work (planning, architecture, review, security audit) automatically uses the higher-intelligence model — the smart tier. When the task is complex, the smart model **drives the entire turn**: it writes the code, calls the tools, runs the loop, just at a higher intelligence level.
- **Cost**: everyday execution (well-defined tasks, established patterns) automatically uses the cheaper model — the fast tier. The fast tier is execution-heavy and covers the bulk of routine work.
- **Speed**: cheap models respond faster on execution tasks; strong models think more carefully on complex tasks.
- **Zero interference by default**: both tiers start empty. The router does nothing until you assign models via `/router config`.

### The CTO / Engineer Role

> **Smart = CTO** (small workload, critically important): when the work matters — direction-setting, course correction, result review, security audit, or a hard problem that needs doing right — the smart model acts as the CTO who drives the whole turn: it writes the code, calls the tools, runs the loop, at a higher intelligence level. High-stakes turns don't get dropped. It does not merely "judge"; it executes the entire turn at high intelligence.
>
> **Fast = Engineer** (large workload, well-defined patterns): when the path is clear, the fast model acts as the engineer who executes the whole turn — writing code, fixing bugs, adding tests, writing comments — cheap, fast, and accurate.

Not every task needs CTO-level intelligence. But projects without CTO oversight don't sustain quality. The LLM Judge is a small, one-shot classification call — the chosen tier then drives the entire agent run, including all thinking, tool calls, and message content.

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
│  │  ① Status bar: "🧭 judging…" (transient)           │       │
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

| Tier | Role | What it does for the whole turn | Use Cases |
|------|------|------------------------------|-----------|
| **🧠 Smart (CTO)** | Judgment driver: direction-setting, correction, review, and hard problems handled personally — and when chosen, executes the entire turn at high intelligence | Architecture design, technology selection, code review, security audit, performance optimization, multi-step planning, any irrecoverable action. **Small workload, critically important.** |
| **🦾 Fast (Engineer)** | Execution driver: follows known patterns, drives the whole turn with the simpler model | Writing code, fixing bugs, adding tests, writing docs, adding comments, small refactors. **Large workload, well-defined patterns.** |

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

The prompt classifies by **task shape**, not topic. Review-type tasks are split by what the turn actually does: a review whose findings set direction or drive rework is `smart`; a quick observation that leads straight into a routine fix with a clear path ("this separator is selectable, remove it") is `fast`. Security review is never downgraded, and explicit user intent for depth (signal 2) always wins.

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

Additionally, when a Judge call fails with a **failover signature** (HTTP 429/5xx, or a body containing rate-limit / quota / `rate_limit_error`), the failed model is written into the shared `modelCooldowns` map via the `onFailure` callback. This means a rate-limited fast model is **not retried on subsequent Judge calls** — the next Judge invocation skips it via `isCooldown` and moves straight to the next fast-tier model. See §8.5.5 for the shared-map mechanism.

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

While the Judge API call is in flight, the status bar shows **`🧭 judging…`** instead of the current model badge. This gives the user feedback that the router is working during the 200ms–2s Judge latency, instead of a silent delay between "press enter" and "first token streams".

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
| **Publish to npm** | ✅ | v0.4.0 | First release |
| Runtime `Cannot find package` fix + `pack:check` guard | ✅ | v0.4.1 | npm install path |
| Multi-model fallback chain editor (TUI) | ✅ | v0.5.0 | Hotkey add/remove/reorder |
| Judge respects user explicit intent | ✅ | v0.5.0 | 4-signal prompt |
| **Runtime failover (exponential backoff)** | ✅ | v0.6.0 | See §8.5; 4xx/5xx split + 6h cap refined in v0.9.0 |
| Confidence-weighted sliding window | ✅ | v0.7.0 | `minConfidence` gate, weighted downgrade ratio |
| Token throughput + `/router stats` + Tuning Guide | ✅ | v0.8.0 | `src/stats.ts`, 5-sample speed window |
| Judge cooldown sharing (429 no longer re-hit) | ✅ | v0.8.3 | `classify()` `onFailure` callback → `markModelFailed` |
| **Cost telemetry — deep view** | ✅ | v0.9.0 | Per-tier spend + savings baseline; SPEC §9.1 |
| Cooldown backoff rescale (4×, 6h cap, 4xx/5xx split) | ✅ | v0.9.0 | §8.5.2; 4xx starts at 16m, 5xx at 1m |
| Slogan + CTO/Engineer terminology unification | ✅ | v0.9.1 | Docs, SPEC, judge prompt, tests |
| **Coverage reporting (≥90% on router/failover)** | ✅ | v0.9.x (dev) | `vitest --coverage` in CI; router 100% / failover 95.5% |
| **Cache-aware routing** | ✅ | v0.10.0 | §9.2: same-family threshold raise + warm-cache downgrade suppression |

## 8.5 Runtime Failover (Exponential Backoff)

**Problem**: when the active model returns a rate-limit / server error (429,
5xx), pi-agent retries internally (provider layer ×3, then agent layer ×3)
and eventually fails with `Error: Retry failed after 3 attempts`. The router
currently has no hook into this, so the user sees the error instead of a
fallback model taking over.

**Design goal**: use pi's own retry machinery for the primary model, then
have the router take over with the next model in the tier's chain when pi's
retries are exhausted.

### 8.5.1 pi-agent retry layering (verified against source)

| Layer | Trigger | Behavior | Router intervention |
|-------|---------|----------|---------------------|
| L1 provider | `retryProviderRequest()` sees 429/5xx | exponential backoff, default 3× | None — `after_provider_response` fires only on success (429 is caught and retried internally) |
| L2 agent | `agent_end` → `_prepareRetry()` | backoff → `agent.continue()` using current `this._state.model` | `agent_end` hook can `pi.setModel(fallback)` → next continue uses it |
| L3 next turn | user sends new message | `before_agent_start` runs | Cooldown-aware model selection |

### 8.5.2 Core mechanism

1. **`agent_end` hook**: inspect the last assistant message (`errorMessage`,
   `stopReason === "error"`). If it matches a failover signature (429, 5xx,
   rate limit / quota exhausted), mark the current model into cooldown and
   immediately `pi.setModel(next available model in the same tier)`.
   pi's pending `agent.continue()` then retries the turn with the fallback
   model — **immediate failover within the same turn**. No cross-tier fallback.
2. **Cooldown state**: `RouterState.modelCooldowns: Map<string, { until: number; attempts: number }>`
   keyed by `provider/model`. `until` grows exponentially with multiplier 4:
   `backoffMs = BASE * 4^(attempts-1)` where `BASE = 60_000` (1 min), capped at
   **6 hours** (`COOLDOWN_MAX_MS`). Each new failure of the same model
   quadruples the wait: 1m → 4m → 16m → 1h4m → 4h16m → 6h(cap).
   The 6h cap is sized for hour-scale coding-plan rate windows (~5h),
   not per-minute RPM limits — a 30m cap caused repeated 429 re-hits
   throughout the window. Escalation persists across natural expiry: when a
   model thaws (its `until` passes) and fails again, `attempts` continues
   from the previous tier rather than resetting.
   **4xx vs 5xx**: a failover-worthy **4xx** (429 rate limit / quota — a
   client-side limit) skips the first two tiers and starts at 16m
   (`COOLDOWN_START_ATTEMPTS_4XX = 3`), because client limits usually
   outlive server blips — probing at 1m/4m wastes calls. **5xx** keeps the
   1m start for fast recovery. `markModelFailed(…, code)` derives the
   start tier from the failover signature; both paths share the same cap.
3. **`before_agent_start` cooldown-aware selection**: `findBestModelForTier()`
   accepts an `isCooldown(key)` predicate and skips models currently in
   cooldown, picking the next healthy model in the chain.
4. **Recovery**: `after_provider_response` with `status` 2xx clears the
   cooldown for the responding model (it works again). Cooldowns are
   session-scoped; a session restart resets all.
5. **Judge-side writes**: the Judge's `classify()` loop writes failed
   models into the same map via an `onFailure` callback, so the next
   Judge call (and the next turn-path `findBestModelForTier`) skips them.
   Without this, a rate-limited fast model would be re-hit by every Judge
   invocation until a full turn failed — and if the Judge happens to pick
   `smart` that turn, the failure never happens and the model stays
   uncooled indefinitely. Only failover signatures (429/5xx/quota) write
   to the map; network errors, timeouts, auth errors, and unparseable
   responses do not cool down (they are not failover signatures, see §8.5.3).

### 8.5.3 Failover signatures

- **Trigger cooldown**: HTTP 429, 5xx (500/502/503/504); body containing
  `rate limit`, `quota`, `rate_limit_error`, `insufficient_quota`.
- **Do NOT trigger**: 400 (invalid request — config error, not transient),
  401 (auth — user must fix credentials).

### 8.5.4 User-visible feedback

On failover, show a toast notification (unless `quietMode`):
`⚠️ <model> unavailable (429), switching to <fallback> — retry in Ns`.
`/router status` lists each tier's active model and any cooldowns:
`fast: deepseek-v4-flash (primary M3 in cooldown 3m12s)`.

### 8.5.5 Edge cases

- All models in a tier are in cooldown → keep current model (do not guess
  across tiers), surface a warning toast.
- Manual override (`/route-force`) bypasses cooldown (user explicitly asked).
- A 2xx success for a model in cooldown clears it immediately (recovery).

## 9. Future Direction (Optional Enhancements)

- **Cache-aware routing (v0.10.0)**: delivered — same-family threshold raise + warm-cache downgrade suppression, see §9.2.
- **Tool-result classification**: classify tool calls (long shell output may indicate debugging, not a question).
- **Multilingual Judge *prompt* translations**: with-drawn — LLMs are multilingual; the English prompt handles non-English user input. Test inputs in zh / ja / es / fr through the real `classify()` if regressions surface.
- **Per-tier thinking level**: withdrawn — tier classification already encodes prompt complexity, so a static per-tier thinking rule rarely saves more than it complicates.

### 9.1 Cost telemetry — deep view (delivered v0.9.0)

`/router stats` exposes per-tier spend (USD + token counts) plus a hypothetical baseline.

**Data source**: pi-agent's `message_end.usage` carries `input`, `output`, `cacheRead`, `cacheWrite`, and `cost.total` (USD) for every assistant message. The router attributes each message to whichever tier was active when it ran (`state.currentTier` at message_start).

**Baseline definition**: "what would this session have cost on the most expensive model you actually used?" — across `state.callLog`, the max input / output / cacheRead / cacheWrite prices set the per-token rates; every message's tokens are priced at those rates and summed. When the most-expensive-model lookup succeeds, the difference `hypothetical - actual` is the **savings** figure.

**Fallback**: when pricing is missing for every model used (e.g. fully-local session with no `models-store.json` pricing), the baseline shows `unavailable` instead of a misleading savings number.

**Display** (excerpt from `/router stats`):

```
Spend: fast $0.045 (12 calls) · smart $0.42 (3 calls) · total $0.465
  baseline: anthropic/claude-opus-5 → $3.21 (saved $2.74 by routing)
  fast tokens: 12,400 in / 8,200 out
  smart tokens: 4,800 in / 1,100 out
```

### 9.2 Cache-aware routing (planned v1.0.0)

**Problem**: a prompt cache belongs to a model — it is the model's own key-value state,
addressed by a byte-identical prefix. Crossing a model boundary is therefore a
guaranteed cache miss. When a router downgrades mid-session (smart → fast on a
different model), the new model re-reads the entire conversation at full input
price, forfeiting the accumulated cache discount on every subsequent turn until
the new cache warms.

**Motivating data** (industry measurements, 2026):

- Cache reads bill at **0.1x–0.5x** of base input (Anthropic 0.1x, OpenAI 0.5x).
  Anthropic's first write costs 1.25x; a 1-hour TTL write costs 2x.
- Agentic sessions are cache-dominated: **by Turn 3, cached tokens are the vast
  majority of the payload**; tool-result steps hit **97.9% prefix-cache hit rates**
  (Claude) vs 86.9% on user-initiated steps; overall 95.8% (Claude) / 95.7%
  (Codex) across sessions averaging 9.2 requests and 73.6 tool steps.
- A worked TraceLab-style example: a 126k-token prefix staying on a warm cache
  costs **$0.0631/step**; routing one step to a model that is 2.5x cheaper on list
  price but cold-cache costs **$0.2541** for the same prefix — **3.5x more**, not
  less. Break-even rule: a downgrade target only wins if its base input price is
  **> 10x cheaper** than the model you leave (Anthropic's 0.1x cache discount
  makes the threshold 1/0.1). GPT-5.6 Luna at $0.20/MTok qualifies (25x); Claude
  Haiku 4.5 at $1/MTok does not (1.7x more than staying).
- RouteLLM-style validation (85% cost reduction) was measured on MT Bench —
  short, independent, single-turn prompts with no reusable prefix. Agentic
  workloads are the exact inverse; the cache discount is the bigger lever.

**Design** (pure logic, no heuristics):

1. Detect whether both tiers resolve to the **same provider family**
   (`resolved.provider` family, e.g. both `anthropic` — same provider = same
   cache domain; different providers never share a cache).
2. When they do, raise the downgrade threshold for the session:
   `routing.window.threshold` 0.6 → **0.9** (fewer mid-session downgrades →
   fewer cache forfeits). Threshold is the *downgrade* gate only — upgrades
   (fast → smart) stay immediate, because the smart tier's superior output
   quality is the point of the upgrade.
3. **Session-boundary routing**: downgrades only apply when the cache is
   naturally cold anyway — after a session break (>5 min idle kills the cache;
   >1 hour almost all steps miss it), or after `/compact`. Implement by
   checking `state.lastMessageAt` age; if the gap exceeds the provider's cache
   TTL window, the cache is already gone and downgrading costs nothing extra.
4. Config: `routing.cacheAware` (`boolean`, default `true` when same-family
   detected; user can force-off). No new magic numbers — the 0.9 threshold
   reuses the existing `window.threshold` semantics.

**Expected effect**: in same-family setups (e.g. Anthropic fast+smart, or
OpenAI fast+smart) the router stops trading a 10x discount for a 2.5x one.
Downgrades still happen, but only when the cache is already cold or the window
majority is unambiguous. Cross-family setups are untouched (cache domains
already distinct).