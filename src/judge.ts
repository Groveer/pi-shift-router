/**
 * Slim Router — Task classifier (Judge)
 *
 * Two-tier classification:
 *   LLM Judge (direct API call) → fallback Heuristic
 *
 * The judge system prompt is loaded from `prompts/judge.md` at module init.
 * If the file is missing or unreadable, a minimal inlined fallback is used.
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
    const path = resolve(here, "../prompts/judge.md");
    return readFileSync(path, "utf-8").trim();
  } catch (err) {
    console.warn("[SlimRouter] Failed to load prompts/judge.md, using fallback:", err);
    return FALLBACK_PROMPT;
  }
}

const JUDGE_PROMPT = loadJudgePrompt();

// ─── LLM Judge ────────────────────────────────────────────────────

/** Call LLM judge via direct API call. Returns null on failure. */
async function classifyLLM(
  prompt: string,
  endpoint: ProviderEndpoint,
  signal?: AbortSignal,
): Promise<JudgeResult | null> {
  try {
    const body = buildRequestBody(endpoint, prompt);
    const res = await fetch(endpoint.baseUrl, {
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

// ─── Heuristic Judge ──────────────────────────────────────────────

const FLAGSHIP_ZH = [
  /架构设计?/, /系统设计/, /方案设计/, /重构/, /大规模/,
  /安全审计/, /安全审查/, /渗透/, /性能优化/, /性能分析/,
  /多步[骤]?/, /复杂[的]?(逻辑|业务|流程)/,
  /技术选型/, /技术方案/, /架构评审/, /并发/, /分布式/,
  /代码审查/, /code.?review/i,
  /数据库设计/, /存储方案/, /微服务/, /服务拆分/,
  /灾难恢复/, /容灾/, /高可用/,
  /扩展性/, /可扩展/, /scalability/i,
  /稳定性/, /可靠性/,
];

const FLAGSHIP_EN = [
  /\barchitect(ure|ural)?\b/i, /\bsystem.?design\b/i, /\bsecurity.?audit\b/i,
  /\bperformance.?optimiz(ation|e)\b/i, /\bmulti.?step\b/i,
  /\bcomplex\b/i, /\brefactor(ing)?\b/i, /\bcode.?review\b/i,
  /\bdistributed\b/i, /\bmicroservice[s]?\b/i, /\bscalability\b/i,
  /\breliability\b/i, /\bhigh.?availab(le|ility)\b/i,
  /\bdisaster.?recover/i, /\btrade.?off/i, /\bstrateg(y|ic)\b/i,
];

const MEDIUM_ZH = [
  /实现/, /编写/, /写[一个]?/, /创建/, /调试/, /修[改复]/,
  /bug/i, /测试/, /单[元]?测试/, /集成测试/,
  /文档/, /注释/, /分析/, /解释/, /说明/,
  /API/i, /接口/, /路由/, /功能开发/, /功能实现/,
  /数据[库]?查询/, /SQL/i, /优化/, /改进/, /提升/,
  /配置/, /部署/, /CI\/CD/i, /验证/, /校验/, /迁移/, /升级/,
];

const MEDIUM_EN = [
  /\bimplement(ation)?\b/i, /\b(write|create|build)\b/i,
  /\bdebug|fix\b/i, /\btest(ing)?\b/i, /\bdocument(ation)?\b/i,
  /\banaly(sis|ze)\b/i, /\bexplain\b/i, /\brefactor\b/i,
  /\boptimize\b/i, /\bdeploy\b/i, /\bconfig(ure|uration)?\b/i,
  /\bmigrate\b/i, /\bvalidate\b/i, /\bquery\b/i,
];

const LIGHT_PATTERNS = [
  /^(ok[ay]?|好的?|嗯|行|可以|明白|了解|[yn])$/i,
  /^(谢谢|thanks|thank you|thx|tks)$/i,
  /^(早|晚[上安]?好|你好|hi|hello|hey)$/i,
  /^search\b/i, /^查[一找]?(下|看|询)/,
  /^什么[是叫]/, /^(what|who)\b/i, /^(怎么|如何)/,
];

/** Score a prompt across all three tiers. Higher = more likely. */
function scorePrompt(text: string): Record<Tier, number> {
  const s: Record<Tier, number> = { light: 0, medium: 0, flagship: 0 };
  const lines = text.split("\n").filter(Boolean);
  const len = text.length;

  // Length
  if (len > 800) { s.flagship += 3; s.medium += 2; }
  else if (len > 300) { s.flagship += 2; s.medium += 2; }
  else if (len > 100) { s.flagship += 1; s.medium += 2; }
  else if (len < 15) s.light += 2;

  // Multi-line
  if (lines.length >= 5) { s.flagship += 2; s.medium += 2; }
  else if (lines.length >= 3) { s.flagship += 1; s.medium += 1; }

  // Code signals
  if (/```\w*/.test(text) || /[`]\w+\.\w+[`]/.test(text)) { s.medium += 2; s.flagship += 1; }
  if (/\b(function|class|import|export|def |const |let |var )\b/.test(text)) s.medium += 1;

  // Keywords
  for (const p of FLAGSHIP_ZH) if (p.test(text)) s.flagship += 2;
  for (const p of FLAGSHIP_EN) if (p.test(text)) s.flagship += 2;
  for (const p of MEDIUM_ZH) if (p.test(text)) s.medium += 1;
  for (const p of MEDIUM_EN) if (p.test(text)) s.medium += 1;
  for (const p of LIGHT_PATTERNS) { if (p.test(text)) { s.light += 3; break; } }

  // Very short + no signals
  if (len < 15 && s.medium === 0 && s.flagship === 0) s.light += 2;

  return s;
}

function classifyHeuristicInner(prompt: string): JudgeResult {
  const s = scorePrompt(prompt);
  const tier: Tier =
    s.flagship >= s.medium && s.flagship >= s.light ? "flagship" :
    s.medium >= s.light ? "medium" : "light";
  return { tier, source: "heuristic" };
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Unified task classifier.
 * 1. If LLM endpoint is provided, try LLM judge (with timeout).
 * 2. Fallback to heuristic classifier.
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
  }
  return classifyHeuristicInner(prompt);
}

/** Synchronous heuristic-only classification (for tests / no-LLM mode). */
export function classifyHeuristic(prompt: string): JudgeResult {
  return classifyHeuristicInner(prompt);
}