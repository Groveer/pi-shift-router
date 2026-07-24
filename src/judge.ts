/**
 * Slim Router — Task classifier (Judge)
 *
 * Two-tier classification:
 *   LLM Judge (direct API call) → fallback "hold current tier"
 *
 * The judge system prompt is loaded from `prompts/judge.md` at module init.
 * If the file is missing or unreadable, a minimal inlined fallback is used.
 *
 * Design principle (SPEC §4.1, §4.6):
 *   The LLM Judge holds all classification logic. There is NO keyword
 *   rule list, NO regex patterns, NO scoring heuristics — because the
 *   whole point of using an LLM as judge is to avoid maintaining such
 *   lists. When the LLM Judge is unavailable, we simply hold position
 *   (medium tier) and log a warning. We do NOT guess.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { JudgeResult, Tier, ProviderEndpoint } from "./types.js";

// ─── Judge system prompt ──────────────────────────────────────────

const FALLBACK_PROMPT =
  `You are a task classifier. Classify the request into one tier. ` +
  `Respond with ONLY ONE WORD: light, medium, or flagship.`;

function loadJudgePrompt(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "./prompts/judge.md");
    return readFileSync(path, "utf-8").trim();
  } catch (err) {
    console.warn("[SlimRouter] Failed to load prompts/judge.md, using fallback:", err);
    return FALLBACK_PROMPT;
  }
}

const JUDGE_PROMPT = loadJudgePrompt();

// ─── LLM Judge ────────────────────────────────────────────────────

/** Build the correct API endpoint URL based on apiType.
 *  models-store.json stores baseUrl WITHOUT the API path suffix
 *  (e.g. "https://api.deepseek.com" not "https://api.deepseek.com/chat/completions"). */
function judgeApiUrl(baseUrl: string, apiType: string): string {
  const base = baseUrl.replace(/\/+$/, ""); // strip trailing slash
  if (apiType.startsWith("anthropic")) return `${base}/v1/messages`;
  return `${base}/chat/completions`;
}

/** Call LLM judge via direct API call. Returns null on failure. */
async function classifyLLM(
  prompt: string,
  endpoint: ProviderEndpoint,
  signal?: AbortSignal,
): Promise<JudgeResult | null> {
  try {
    const body = buildRequestBody(endpoint, prompt);
    const url = judgeApiUrl(endpoint.baseUrl, endpoint.apiType);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.apiType.startsWith("anthropic")
          ? { "x-api-key": endpoint.apiKey, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${endpoint.apiKey}` }),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) return null;
    const raw = await res.json();
    const answer = parseResponse(raw, endpoint.apiType);
    if (!answer || !["light", "medium", "flagship"].includes(answer)) return null;
    return { tier: answer as Tier, source: "llm" };
  } catch {
    return null;
  }
}

function buildRequestBody(endpoint: ProviderEndpoint, prompt: string): Record<string, unknown> {
  if (endpoint.apiType.startsWith("anthropic")) {
    return {
      model: endpoint.modelId,
      max_tokens: 10,
      system: JUDGE_PROMPT,
      messages: [{ role: "user", content: prompt }],
    };
  }

  // OpenAI-compatible (default)
  return {
    model: endpoint.modelId,
    max_tokens: 10,
    temperature: 0,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      { role: "user", content: prompt },
    ],
  };
}

function parseResponse(raw: Record<string, unknown>, apiType: string): string | null {
  try {
    if (apiType.startsWith("anthropic")) {
      const content = (raw as any).content;
      if (Array.isArray(content)) return content[0]?.text?.trim().toLowerCase() ?? null;
    }
    // OpenAI-compatible
    const choice = (raw as any).choices?.[0];
    return choice?.message?.content?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ─── Fallback (no rules) ──────────────────────────────────────────
//
// SPEC §4.6: when LLM Judge fails, hold position. Don't guess.
// The router stays on whatever tier it's currently on; no model switch.

const FALLBACK_RESULT: JudgeResult = { tier: "medium", source: "fallback" };

/** Trivial no-op classifier used only when LLM Judge is unavailable. */
export function classifyHeuristic(_prompt: string): JudgeResult {
  return FALLBACK_RESULT;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Unified task classifier.
 * 1. If LLM endpoint is provided, try LLM judge (with timeout).
 * 2. On failure: log a warning and hold position (medium).
 */
export async function classify(
  prompt: string,
  llmEndpoint?: ProviderEndpoint | null,
): Promise<JudgeResult> {
  if (llmEndpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const result = await classifyLLM(prompt, llmEndpoint, controller.signal);
    clearTimeout(timer);
    if (result) return result;
    console.warn("[SlimRouter] Judge LLM unavailable — holding position on current tier");
  }
  return FALLBACK_RESULT;
}