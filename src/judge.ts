/**
 * Smart Router — Task classifier (Judge)
 *
 * Phase 1: Heuristic classification based on prompt characteristics.
 * Phase 2: Will add LLM-based classification via direct API call.
 *
 * The heuristic handles both Chinese and English input.
 */

import type { JudgeResult, Tier } from "./types.js";

// ─── Flagship signal patterns ───────────────────────────────────────

const FLAGSHIP_PATTERNS_ZH = [
  /架构设计?/, /系统设计/, /方案设计/,
  /重构/, /大规模/, /大型/,
  /安全审计/, /安全审查/, /渗透/,
  /性能优化/, /性能分析/,
  /多步[骤]?/, /复杂[的]?(逻辑|业务|流程)/,
  /技术选型/, /技术方案/, /架构评审/,
  /并发[处理]?/, /分布式/,
  /设计模式/, /抽象[层]?/,
  /代码审查/, /code.?review/i,
  /数据库设计/, /存储方案/,
  /微服务/, /服务拆分/,
  /灾难恢复/, /容灾/, /高可用/,
  /扩展性/, /可扩展/, /scalability/i,
  /稳定性/, /可靠性/,
];

const FLAGSHIP_PATTERNS_EN = [
  /\barchitect(ure|ural)?\b/i,
  /\bsystem.?design\b/i,
  /\bsecurity.?audit\b/i,
  /\bperformance.?optimiz(ation|e)\b/i,
  /\bmulti.?step\b/i,
  /\bcomplex\b/i,
  /\brefactor(ing)?\b/i,
  /\bcode.?review\b/i,
  /\bdistributed\b/i,
  /\bmicroservice[s]?\b/i,
  /\bscalability\b/i,
  /\breliability\b/i,
  /\bhigh.?availab(le|ility)\b/i,
  /\bdisaster.?recover/i,
  /\btrade.?off/i,
  /\bstrateg(y|ic)\b/i,
  /\bdeep.?dive\b/i,
];

// ─── Medium signal patterns ────────────────────────────────────────

const MEDIUM_PATTERNS_ZH = [
  /实现/, /编写/, /写一?[个段]/, /创建/,
  /调试/, /修[改复]/, /bug/i,
  /测试/, /单[元]?测试/, /集成测试/,
  /文档/, /注释/, /README/i,
  /分析/, /解释/, /说明/,
  /API/i, /接口/, /路由/,
  /功能开发/, /功能实现/,
  /数据[库]?查询/, /SQL/i,
  /优化/, /改进/, /提升/,
  /配置/, /部署/, /CI\/CD/i,
  /验证/, /校验/,
  /迁移/, /升级/,
];

const MEDIUM_PATTERNS_EN = [
  /\bimplement(ation)?\b/i,
  /\b(write|create|build)\b/i,
  /\bdebug|fix\b/i,
  /\btest(ing)?\b/i,
  /\bdocument(ation)?\b/i,
  /\banaly(sis|ze)\b/i,
  /\bexplain\b/i,
  /\brefactor\b/i,
  /\boptimize\b/i,
  /\bdeploy\b/i,
  /\bconfig(ure|uration)?\b/i,
  /\bmigrate\b/i,
  /\bvalidate\b/i,
  /\bupgrade\b/i,
  /\bquery\b/i,
];

// ─── Light signal patterns ─────────────────────────────────────────

const LIGHT_PATTERNS = [
  // Greetings and acknowledgments
  /^(ok[ay]?|好的?|嗯|行|可以|明白|了解|[yn])$/i,
  /^(谢谢|thanks|thank you|thx|tks)$/i,
  /^(早|晚[上安]?好|你好|hi|hello|hey)$/i,
  // Simple queries
  /^search\b/i,
  /^查[一找]?(下|看|询)/,
  /^什么[是叫]/, /^(what|who)\b/i,
  /^(怎么|如何)/,
];

// ─── Short prompt detection ────────────────────────────────────────

/** Check if a prompt is extremely short (likely simple) */
function isVeryShort(text: string): boolean {
  const cleaned = text.trim();
  return cleaned.length < 15 && !cleaned.includes("\n");
}

// ─── Heuristic classifier ──────────────────────────────────────────

/**
 * Classify a user prompt using heuristic rules.
 * Handles both Chinese and English.
 * Returns a score map: higher = more likely that tier.
 */
function scorePrompt(prompt: string): Record<Tier, number> {
  const scores: Record<Tier, number> = { light: 0, medium: 0, flagship: 0 };
  const text = prompt.trim();

  // 1. Length-based signals
  const len = text.length;
  if (len > 800) {
    scores.flagship += 3;
    scores.medium += 2;
  } else if (len > 300) {
    scores.flagship += 2;
    scores.medium += 2;
  } else if (len > 100) {
    scores.flagship += 1;
    scores.medium += 2;
  } else if (len < 15) {
    scores.light += 2;
  }

  // 2. Multi-line / structured prompts are likely medium+
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length >= 5) {
    scores.flagship += 2;
    scores.medium += 2;
  } else if (lines.length >= 3) {
    scores.flagship += 1;
    scores.medium += 1;
  }

  // 3. Code-related signals (code blocks, file paths, etc.)
  if (/```\w*/.test(text) || /[`]\w+\.\w+[`]/.test(text)) {
    scores.medium += 2;
    scores.flagship += 1;
  }
  if (/\b(function|class|import|export|def |const |let |var )\b/.test(text)) {
    scores.medium += 1;
  }

  // 4. Keyword matching (flagship)
  for (const pattern of FLAGSHIP_PATTERNS_ZH) {
    if (pattern.test(text)) scores.flagship += 2;
  }
  for (const pattern of FLAGSHIP_PATTERNS_EN) {
    if (pattern.test(text)) scores.flagship += 2;
  }

  // 5. Keyword matching (medium)
  for (const pattern of MEDIUM_PATTERNS_ZH) {
    if (pattern.test(text)) scores.medium += 1;
  }
  for (const pattern of MEDIUM_PATTERNS_EN) {
    if (pattern.test(text)) scores.medium += 1;
  }

  // 6. Light pattern matching
  for (const pattern of LIGHT_PATTERNS) {
    if (pattern.test(text)) {
      scores.light += 3;
      break;
    }
  }

  // 7. Very short + no medium/flagship signals = light
  if (isVeryShort(text) && scores.medium === 0 && scores.flagship === 0) {
    scores.light += 2;
  }

  return scores;
}

/** Determine the winning tier from a score map */
function winnerFromScores(scores: Record<Tier, number>): Tier {
  if (scores.flagship >= scores.medium && scores.flagship >= scores.light) return "flagship";
  if (scores.medium >= scores.light) return "medium";
  return "light";
}

/**
 * Classify a prompt into a tier using heuristics.
 * This is used as the primary classifier in MVP,
 * and as fallback when LLM Judge is unavailable.
 */
export function classifyHeuristic(prompt: string): JudgeResult {
  const scores = scorePrompt(prompt);
  const tier = winnerFromScores(scores);
  return { tier, source: "heuristic" };
}
