/**
 * pi-shift-router — Router statistics snapshot (SPEC §"User-visible feedback")
 *
 * Pure function that derives a snapshot from RouterState for the
 * `/router stats` command. No IO, no side effects.
 */

import type { RouterState, ShiftRouterConfig } from "./types.js";

export interface CooldownInfo {
  provider: string;
  model: string;
  remainingMs: number;
}

export interface ConfidenceBuckets {
  /** entries with confidence ≥ 0.7 */
  high: number;
  /** entries with confidence ≥ minConfidence and < 0.7 */
  mid: number;
  /** entries with confidence < minConfidence */
  low: number;
  /** entries without a confidence value */
  none: number;
}

export interface RouterStatsSnapshot {
  windowSize: number;
  totalOutputTokens: number;
  downgradeCount: number;
  upgradeCount: number;
  cooldownCount: number;
  activeCooldowns: CooldownInfo[];
  confidence: ConfidenceBuckets;
  /** Average of the last few tokens/sec readings. 0 when no readings. */
  avgTokensPerSec: number;
  /** Most recent tokens/sec reading. 0 when none. */
  currentTokensPerSec: number;
}

/**
 * Build a stats snapshot from the current router state.
 *
 * @param now  epoch ms used for cooldown expiry comparison (defaults to Date.now()).
 */
export function computeStats(
  state: RouterState,
  _config: ShiftRouterConfig,
  now: number = Date.now(),
): RouterStatsSnapshot {
  // Confidence buckets
  const minConf = _config.routing.window.minConfidence ?? 0.5;
  const buckets: ConfidenceBuckets = { high: 0, mid: 0, low: 0, none: 0 };
  for (const e of state.window) {
    if (e.confidence === undefined) {
      buckets.none += 1;
    } else if (e.confidence >= 0.7) {
      buckets.high += 1;
    } else if (e.confidence >= minConf) {
      buckets.mid += 1;
    } else {
      buckets.low += 1;
    }
  }

  // Cooldowns
  const activeCooldowns: CooldownInfo[] = [];
  for (const [key, entry] of state.modelCooldowns) {
    if (entry.until <= now) continue;
    const [provider, ...rest] = key.split("/");
    activeCooldowns.push({
      provider,
      model: rest.join("/"),
      remainingMs: entry.until - now,
    });
  }

  // Speeds
  const speeds = state.recentSpeeds;
  const currentTokensPerSec = speeds.length > 0 ? speeds[speeds.length - 1] : 0;
  const avgTokensPerSec = speeds.length > 0
    ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)
    : 0;

  return {
    windowSize: state.window.length,
    totalOutputTokens: state.totalOutputTokens,
    downgradeCount: state.downgradeCount,
    upgradeCount: state.upgradeCount,
    cooldownCount: activeCooldowns.length,
    activeCooldowns,
    confidence: buckets,
    avgTokensPerSec,
    currentTokensPerSec,
  };
}

/** Format ms as human-readable duration (e.g. "3m12s"). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

/** Format a router stats snapshot for display in `/router stats`. */
export function formatStats(
  state: RouterState,
  config: ShiftRouterConfig,
  now: number = Date.now(),
): string {
  const s = computeStats(state, config, now);
  const lines: string[] = [];

  lines.push(`Tier: ${state.currentTier} / ${state.currentProvider ?? "?"}/${state.currentModelId ?? "?"}`);
  lines.push(`Window: ${s.windowSize} entries (confidence: high=${s.confidence.high} mid=${s.confidence.mid} low=${s.confidence.low} none=${s.confidence.none})`);
  lines.push(`Transitions: ↑upgrade=${s.upgradeCount} ↓downgrade=${s.downgradeCount}`);
  lines.push(`Tokens: total ${s.totalOutputTokens.toLocaleString()} | speed current=${s.currentTokensPerSec} avg=${s.avgTokensPerSec} tok/s`);

  if (s.cooldownCount > 0) {
    lines.push(`Cooldowns (${s.cooldownCount}):`);
    for (const c of s.activeCooldowns) {
      lines.push(`  ⏳ ${c.provider}/${c.model} — retry in ${formatDuration(c.remainingMs)}`);
    }
  } else {
    lines.push(`Cooldowns: none`);
  }

  return lines.join("\n");
}