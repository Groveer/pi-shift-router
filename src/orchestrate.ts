/**
 * pi-shift-router — Task-level orchestration (SPEC §9.3, v1.0.0)
 *
 * The plugin's whole job here is (a) decide when a Judge "smart" verdict
 * becomes an orchestration run, (b) inject the orchestrator instruction with
 * the current Fast/Smart tier chains rendered in, and (c) hold the hard caps
 * (rounds, escalations, budget). The actual loop — plan, delegate via the
 * subagent tool, review, re-delegate, take over, accept — is the Smart main
 * agent's own work once the orchestrator prompt is active.
 *
 * Design constraints (SPEC §9.3):
 * - Tiers are the single source of truth; we render pi-shift-router.json
 *   tier chains (healthy-only, cooldown-filtered) into the prompt. We never
 *   write pi-subagents' settings — per-run model overrides are passed by the
 *   Smart agent, guided by the rendered chain.
 * - Backward compatibility: with `orchestration.enabled` false (default),
 *   every path here is a no-op — behavior is byte-for-byte today's router.
 * - Simple tasks never orchestrate: only a Judge "smart" verdict can enter.
 * - Missing pi-subagents / unresolvable Smart model → skip injection and run
 *   the turn as today's smart-tier run (no crash).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  ShiftRouterConfig,
  RouterState,
  OrchestrationState,
  ModelRef,
} from "./types.js";

// ─── Orchestrator prompt ─────────────────────────────────────────

const FALLBACK_ORCHESTRATOR_PROMPT =
  `You are the CTO orchestrating this complex task. Plan it, delegate\n` +
  `implementation to Fast subagents (agent: "worker", context: "fresh", model\n` +
  `pinned from the Fast tier), review each result, re-delegate with concrete\n` +
  `feedback, take over a phase yourself after {{escalationThreshold}} failed\n` +
  `worker attempts, and do a final acceptance pass. Max {{maxRounds}} rounds.`;

function loadOrchestratorPrompt(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "./prompts/orchestrator.md");
    return readFileSync(path, "utf-8").trim();
  } catch (err) {
    console.warn("[ShiftRouter] Failed to load prompts/orchestrator.md, using fallback:", err);
    return FALLBACK_ORCHESTRATOR_PROMPT;
  }
}

const ORCHESTRATOR_PROMPT = loadOrchestratorPrompt();

// ─── Tier chain rendering ─────────────────────────────────────────

/**
 * Render one tier's model chain as `provider/model:thinking` lines in
 * priority order, skipping models currently in cooldown.
 *
 * `thinkingSuffix` is the explicit thinking level to pin (e.g. "high").
 * Fork-context workers get force-forced to `thinking: off` by pi-subagents'
 * safety sanitizer for anthropic-messages APIs, so the orchestrator prompt
 * explicitly instructs `context: "fresh"` + explicit thinking — verified
 * (2026-08-13) to honor the override.
 */
export function renderTierChain(
  models: ModelRef[] | undefined,
  isCooldown: ((provider: string, model: string) => boolean) | undefined,
  thinkingSuffix: string,
): string {
  if (!models || models.length === 0) return "(none — fall back to Smart for implementation)";
  const sorted = [...models].sort((a, b) => a.priority - b.priority);
  const lines: string[] = [];
  let skipped = 0;
  for (const ref of sorted) {
    try {
      if (isCooldown?.(ref.provider, ref.model)) {
        skipped += 1;
        continue;
      }
    } catch {
      // cooldown predicate must never block rendering
    }
    lines.push(`  ${lines.length + 1}. \`${ref.provider}/${ref.model}:${thinkingSuffix}\``);
  }
  if (lines.length === 0) {
    if (skipped > 0) return "(all models in cooldown — fall back to Smart for implementation)";
    return "(none — fall back to Smart for implementation)";
  }
  return lines.join("\n");
}

/** Resolve the explicit thinking level to pin for worker models. */
export function defaultThinkingSuffix(): string {
  // Fast-tier execution quality depends on reasoning; "high" is the safe
  // default (matches the user's defaultThinkingLevel and worker frontmatter).
  // Future: read from config when a per-tier thinking level lands.
  return "high";
}

// ─── Orchestrator prompt assembly ─────────────────────────────────

/**
 * Build the full orchestrator instruction for this turn.
 *
 * Renders the Fast tier chain (cooldown-filtered) and Smart tier chain into
 * the orchestrator.md template. `isCooldown` is injected so the rendered
 * chain reflects *today's* health, not a stale snapshot.
 */
export function buildOrchestratorPrompt(
  config: ShiftRouterConfig,
  isCooldown: ((provider: string, model: string) => boolean) | undefined,
): string {
  const thinking = defaultThinkingSuffix();
  const fastChain = renderTierChain(config.tiers.fast.models, isCooldown, thinking);
  const smartChain = renderTierChain(config.tiers.smart.models, isCooldown, thinking);
  return ORCHESTRATOR_PROMPT
    .replaceAll("{{fastChain}}", fastChain)
    .replaceAll("{{smartChain}}", smartChain)
    .replaceAll("{{maxRounds}}", String(config.orchestration.maxRounds))
    .replaceAll("{{escalationThreshold}}", String(config.orchestration.escalationThreshold));
}

// ─── Orchestration lifecycle ──────────────────────────────────────

/** Fresh (inactive) orchestration state. */
export function createOrchestrationState(): OrchestrationState {
  return {
    active: false,
    rounds: 0,
    escalations: 0,
    startedAt: null,
    spend: 0,
  };
}

/** Reset orchestration state to inactive. */
export function resetOrchestration(state: RouterState): void {
  state.orchestration = createOrchestrationState();
}

/**
 * Enter orchestration for this task. Idempotent: re-entering while already
 * active keeps the existing run (does not reset caps mid-task).
 */
export function enterOrchestration(state: RouterState): void {
  const orch = state.orchestration;
  if (!orch.active) {
    orch.active = true;
    orch.startedAt = Date.now();
    orch.rounds = 0;
    orch.escalations = 0;
    orch.spend = 0;
  }
}

/** Exit orchestration (task complete, aborted, or cap hit). */
export function exitOrchestration(state: RouterState): void {
  state.orchestration = createOrchestrationState();
}

/**
 * Decide whether THIS turn should run as an orchestration turn.
 *
 * All conditions must hold:
 * 1. Orchestration enabled (config, opt-in).
 * 2. Router enabled.
 * 3. Judge said "smart" (complex) — simple tasks never orchestrate.
 * 4. Smart tier model is resolvable (or requireSmartModel is false).
 * 5. pi-subagents is available (the subagent tool exists) — otherwise
 *    degrade to today's smart-tier run.
 *
 * Pure decision — no side effects. Returns true when the orchestrator
 * prompt should be injected for this turn.
 */
export function shouldOrchestrate(
  config: ShiftRouterConfig,
  judgeTier: string,
  smartModelResolvable: boolean,
  subagentToolAvailable: boolean,
): boolean {
  if (!config.enabled) return false;
  if (!config.orchestration.enabled) return false;
  if (judgeTier !== "smart") return false;
  if (config.orchestration.requireSmartModel && !smartModelResolvable) return false;
  if (!subagentToolAvailable) return false;
  return true;
}

/**
 * Hard-cap guard. The LLM says WHAT is wrong; these caps decide HOW LONG we
 * pay. Returns true when the loop must stop (cap hit) regardless of what
 * the Smart agent wants.
 */
export function capHit(state: RouterState, config: ShiftRouterConfig): boolean {
  const orch = state.orchestration;
  if (!orch.active) return false;
  if (orch.rounds >= config.orchestration.maxRounds) return true;
  if (orch.escalations >= config.orchestration.escalationThreshold) return true;
  return false;
}
