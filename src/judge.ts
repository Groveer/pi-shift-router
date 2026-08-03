/**
 * pi-shift-router — Task classifier (Judge)
 *
 * Single-stage classification via LLM (uses the fast tier's model).
 * On failure: hold position (return "fast"), log a warning.
 * No heuristic rules, no regex — the LLM is the sole classifier.
 *
 * Output format: the Judge prompt asks for `{"tier":"fast"}` or `{"tier":"smart"}`.
 * Reasoning models (DeepSeek Reasoner) put their thinking in `reasoning_content` and
 * the JSON in `content`. We try JSON-parse first, then fall back to keyword search
 * in either content or reasoning_content.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { JudgeResult, Tier, ProviderEndpoint } from "./types.js";

// ─── Judge system prompt ──────────────────────────────────────────

const FALLBACK_PROMPT =
  `You are a task classifier. Respond with ONLY a JSON object: ` +
  `{"tier": "fast"} or {"tier": "smart"}.`;

function loadJudgePrompt(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "./prompts/judge.md");
    return readFileSync(path, "utf-8").trim();
  } catch (err) {
    console.warn("[ShiftRouter] Failed to load prompts/judge.md, using fallback:", err);
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

/** Try to extract a tier answer from text (JSON or keyword). Exported for unit tests. */
export function extractTier(text: string): Tier | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. JSON parse: {"tier": "fast" | "smart"}
  const jsonMatch = trimmed.match(/\{[^{}]*"tier"\s*:\s*"(fast|smart)"[^{}]*\}/i);
  if (jsonMatch) return jsonMatch[1]!.toLowerCase() as Tier;

  // 2. JSON-like with single quotes or unquoted
  const looseMatch = trimmed.match(/["']?tier["']?\s*[:=]\s*["']?(fast|smart)["']?/i);
  if (looseMatch) return looseMatch[1]!.toLowerCase() as Tier;

  // 3. Bare keyword (first occurrence, word-bounded)
  const keywordMatch = trimmed.match(/\b(fast|smart)\b/i);
  if (keywordMatch) {
    const w = keywordMatch[1]!.toLowerCase();
    if (w === "fast" || w === "smart") return w as Tier;
  }

  return null;
}

async function classifyLLM(
  prompt: string,
  endpoint: ProviderEndpoint,
  signal: AbortSignal | undefined,
  verbose: boolean,
): Promise<JudgeResult | null> {
  try {
    const body = buildRequestBody(endpoint, prompt);
    const url = judgeApiUrl(endpoint.baseUrl, endpoint.apiType);

    if (verbose) {
      console.log(`[ShiftRouter] Judge → ${endpoint.modelId} (${endpoint.apiType})`);
      console.log(`[ShiftRouter] Judge URL: ${url}`);
    }

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
      console.warn(`[ShiftRouter] Judge API error ${res.status} from ${url}: ${body.slice(0, 200)}`);
      return null;
    }

    const raw = await res.json();

    if (verbose) {
      const choice = (raw as any).choices?.[0];
      console.log(
        `[ShiftRouter] Judge raw: content=${JSON.stringify(choice?.message?.content)}, ` +
        `reasoning=${JSON.stringify(choice?.message?.reasoning_content)?.slice(0, 150)}, ` +
        `finish=${choice?.finish_reason}`,
      );
    }

    const answer = parseResponse(raw, endpoint.apiType);
    if (!answer) {
      const choice = (raw as any).choices?.[0];
      const content = JSON.stringify(choice?.message?.content);
      const reasoning = JSON.stringify(choice?.message?.reasoning_content);
      const finish = choice?.finish_reason ?? "?";
      console.warn(
        `[ShiftRouter] Judge unparseable from ${url}: ` +
        `content=${content.slice(0, 100)}, reasoning=${reasoning.slice(0, 100)}, finish=${finish}`,
      );
      return null;
    }
    if (verbose) {
      console.log(
        `[ShiftRouter] Judge → ${answer.tier}` +
        (answer.confidence !== undefined ? ` (confidence ${answer.confidence.toFixed(2)})` : ""),
      );
    }
    return answer.confidence !== undefined
      ? { tier: answer.tier, source: "llm", confidence: answer.confidence }
      : { tier: answer.tier, source: "llm" };
  } catch (err) {
    console.warn(`[ShiftRouter] Judge fetch failed for ${endpoint.baseUrl}: ${err}`);
    return null;
  }
}

function buildRequestBody(endpoint: ProviderEndpoint, prompt: string): Record<string, unknown> {
  // Budget enough tokens for reasoning + JSON answer.
  // DeepSeek Reasoner-class models emit `reasoning_content` and the JSON answer in `content`;
  // both are bounded by `max_tokens`. 4000 leaves plenty of room for the chain-of-thought.
  const maxTokens = 4000;

  if (endpoint.apiType.startsWith("anthropic")) {
    // Anthropic has no native JSON mode. Use assistant prefill (`{`) to force JSON-start output.
    return {
      model: endpoint.modelId,
      max_tokens: maxTokens,
      system: JUDGE_PROMPT,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" },
      ],
    };
  }

  // OpenAI-compatible (DeepSeek, OpenAI, etc.): force JSON output via response_format.
  // This is a hard constraint — the API rejects non-JSON completions.
  return {
    model: endpoint.modelId,
    max_tokens: maxTokens,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      { role: "user", content: prompt }],
  };
}

/** Result of parsing a Judge response: tier + optional confidence (0-1). */
export interface ParsedJudgeResponse {
  tier: Tier;
  confidence?: number;
}

function parseResponse(raw: Record<string, unknown>, apiType: string): ParsedJudgeResponse | null {
  try {
    let contentText = "";
    let reasoningText = "";

    if (apiType.startsWith("anthropic")) {
      const content = (raw as any).content;
      if (Array.isArray(content)) contentText = content.map((c: any) => c?.text ?? "").join("");
    } else {
      const choice = (raw as any).choices?.[0];
      const msg = choice?.message ?? {};
      contentText = msg.content ?? "";
      reasoningText = msg.reasoning_content ?? "";
    }

    // Try content first, then reasoning. Each can yield {tier, confidence}.
    const fromContent = parseJudgeAnswer(contentText);
    if (fromContent) return fromContent;
    return parseJudgeAnswer(reasoningText);
  } catch {
    return null;
  }
}

/** Parse a Judge answer string (JSON or loose) for tier + confidence. */
function parseJudgeAnswer(text: string): ParsedJudgeResponse | null {
  const tier = extractTier(text);
  if (!tier) return null;
  const confidence = parseConfidenceFromText(text);
  return confidence === undefined ? { tier } : { tier, confidence };
}

/** Extract confidence (0-1) from a Judge answer string. Returns undefined when absent/invalid. */
function parseConfidenceFromText(text: string): number | undefined {
  // Try JSON first: {"tier":"fast","confidence":0.85}
  const jsonMatch = text.match(/\{[\s\S]*"confidence"\s*:\s*([0-9]*\.?[0-9]+)[\s\S]*\}/);
  if (jsonMatch) {
    const n = Number(jsonMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    return undefined;
  }
  // Loose: confidence: 0.85 or confidence=0.85
  const looseMatch = text.match(/["']?confidence["']?\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
  if (looseMatch) {
    const n = Number(looseMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return undefined;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Unified task classifier with fast-tier fallback.
 *
 * `endpoints` is the fast tier's model list (priority order). The Judge
 * walks it: each failed call (429/5xx/network/timeout/unparseable) tries
 * the next model. `isCooldown` (if provided) skips models in cooldown.
 * Only when ALL fast-tier models fail do we hold position (fallback).
 */
export async function classify(
  prompt: string,
  endpoints: ProviderEndpoint[] | null | undefined,
  timeout = 5000,
  verbose = false,
  isCooldown?: (provider: string, model: string) => boolean,
): Promise<JudgeResult> {
  const list = endpoints ?? [];

  for (const endpoint of list) {
    if (isCooldown?.(endpoint.provider, endpoint.modelId)) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const result = await classifyLLM(prompt, endpoint, controller.signal, verbose);
    clearTimeout(timer);
    if (result) return result;
  }

  console.warn("[ShiftRouter] Judge LLM unavailable — holding position on current tier");
  return { tier: "fast", source: "fallback" };
}