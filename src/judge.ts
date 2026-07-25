/**
 * Slim Router — Task classifier (Judge)
 *
 * Single-stage classification via LLM (uses the fast tier's model).
 * On failure: hold position (return "fast"), log a warning.
 * No heuristic rules, no regex — the LLM is the sole classifier.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { JudgeResult, Tier, ProviderEndpoint } from "./types.js";

// ─── Judge system prompt ──────────────────────────────────────────

const FALLBACK_PROMPT =
  `You are a task classifier. Classify the request into one of two tiers. ` +
  `Respond with ONLY ONE WORD: fast or smart.`;

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

function judgeApiUrl(baseUrl: string, apiType: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (apiType.startsWith("anthropic")) return `${base}/v1/messages`;
  return `${base}/chat/completions`;
}

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

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[SlimRouter] Judge API error ${res.status} from ${url}: ${body.slice(0, 200)}`);
      return null;
    }

    const raw = await res.json();
    const answer = parseResponse(raw, endpoint.apiType);
    if (!answer || !["fast", "smart"].includes(answer)) {
      console.warn(`[SlimRouter] Judge unparseable response from ${url}: ${JSON.stringify(raw).slice(0, 300)}`);
      return null;
    }
    return { tier: answer as Tier, source: "llm" };
  } catch (err) {
    console.warn(`[SlimRouter] Judge fetch failed for ${endpoint.baseUrl}: ${err}`);
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
    const choice = (raw as any).choices?.[0];
    return choice?.message?.content?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Unified task classifier.
 * 1. If LLM endpoint is provided, try LLM judge (with timeout).
 * 2. On failure: log a warning and hold position (fast).
 */
export async function classify(
  prompt: string,
  fastEndpoint: ProviderEndpoint | null | undefined,
  timeout = 5000,
): Promise<JudgeResult> {
  if (fastEndpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const result = await classifyLLM(prompt, fastEndpoint, controller.signal);
    clearTimeout(timer);
    if (result) return result;
    console.warn("[SlimRouter] Judge LLM unavailable — holding position on current tier");
  }
  return { tier: "fast", source: "fallback" };
}
