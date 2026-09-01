/**
 * LLM decision layer — sits on top of the HMM signal.
 *
 * The HMM (Baum-Welch + Viterbi) produces a structural probability over
 * next-bar direction. The LLM acts as a discretionary overlay:
 *   - pulls a fresh market digest (price, MA, RSI, ATR, funding)
 *   - recalls top-K similar past trades from memory (long-term recall)
 *   - injects active strategy lessons (reflected wisdom)
 *   - optionally searches recent news via the SDK's `web_search` function tool
 *   - emits a structured action (AGREE / OVERRIDE / HOLD) plus reasoning
 *
 * The strategy engine then blends HMM probability with the LLM action
 * using `llmWeight` from BotState.
 */

import { chat, type Provider, type ChatMessage } from "./llm-provider";
import type { MarketDigest } from "./bybit";
import type { HMMSignal } from "./hmm";
import { recallSimilar, formatMemoryForPrompt, featuresToSignature, type MemoryMatch } from "./memory";

export type LLMAction =
  | "STRONG_AGREE"
  | "AGREE"
  | "HOLD"
  | "OVERRIDE_LONG"
  | "OVERRIDE_SHORT";

export interface StrategyLesson {
  id: string;
  category: string;
  severity: string;
  lesson: string;
  suggestedAction?: string | null;
  confidence: number;
  symbol: string | null;
}

export interface LLMDecision {
  action: LLMAction;
  confidence: number; // [0,1]
  reasoning: string;
  marketSummary: string;
  newsDigest: string;
  finalSide: "LONG" | "SHORT" | "FLAT";
  latencyMs: number;
  usedSearch: boolean;
  usedMemory: boolean;
  memoryMatches: number;
  memoryIds: string[];
  lessonsApplied: number;
  provider: string;
  model: string;
}

const SYSTEM_PROMPT = `You are the discretionary overlay of an algorithmic trading system on Bybit.
The structural signal comes from a Hidden Markov Model (Baum-Welch trained, Viterbi decoded)
with two hidden states: RISE or DROP for the next bar.

You also receive:
  1. MEMORY — the top-K most similar past trade setups from your own history, with their outcomes.
     Use this to recognize recurring patterns. If similar setups mostly lost, be cautious.
  2. LESSONS — strategy notes you (or the reflection loop) previously concluded. Respect them.
  3. MARKET DIGEST — current price, MA, RSI, ATR, funding rate, recent candles.
  4. NEWS — latest headlines (if available).

Your job: decide whether to AGREE with the HMM, HOLD, or OVERRIDE — and explain why.

Output strictly valid JSON with these fields:
{
  "action": "STRONG_AGREE" | "AGREE" | "HOLD" | "OVERRIDE_LONG" | "OVERRIDE_SHORT",
  "confidence": 0.0-1.0,
  "reasoning": "one to three short sentences explaining your decision, referencing memory/lessons when relevant",
  "marketSummary": "≤25 words",
  "finalSide": "LONG" | "SHORT" | "FLAT"
}

Decision rules:
- AGREE when the HMM signal aligns with momentum, memory, and no contrary news.
- STRONG_AGREE when momentum, MA structure, RSI, memory, and news all confirm.
- HOLD when signals conflict, memory shows similar setups mostly lost, or volatility is extreme without clear direction.
- OVERRIDE_LONG / OVERRIDE_SHORT when there is strong evidence the HMM is wrong
  (e.g. breaking news, RSI extreme + divergence, funding squeeze, memory strongly contradicts).
- finalSide = LONG if action ends in *_LONG or (AGREE/STRONG_AGREE and HMM=RISE),
  SHORT if *_SHORT or (AGREE/STRONG_AGREE and HMM=DROP),
  FLAT if HOLD and no clear edge.

Never wrap the JSON in markdown. Never add commentary outside the JSON.`;

function digestToText(d: MarketDigest): string {
  const recent = d.recentCandles
    .slice(-6)
    .map((c) => `t${new Date(c.ts).toISOString().slice(11, 16)} o${c.open} h${c.high} l${c.low} c${c.close}`)
    .join("\n");
  const atrPct = d.lastPrice > 0 ? (d.atr14 / d.lastPrice) * 100 : 0;
  return [
    `Symbol: ${d.symbol}   Interval: ${d.interval}`,
    `Last: ${d.lastPrice}   Mark: ${d.markPrice}`,
    `24h: ${d.pct24h.toFixed(2)}%   Hi ${d.high24h}   Lo ${d.low24h}   Vol ${d.vol24h.toFixed(0)}`,
    `Funding: ${d.fundingRate.toFixed(4)}% / 8h`,
    `MA10: ${d.shortMA.toFixed(2)}   MA50: ${d.longMA.toFixed(2)}`,
    `RSI(14): ${d.rsi14.toFixed(1)}   ATR(14): ${d.atr14.toFixed(2)} (${atrPct.toFixed(2)}%)`,
    `Recent 6 candles:`,
    recent,
  ].join("\n");
}

async function searchNews(symbol: string, provider: Provider): Promise<string> {
  if (provider !== "glm") {
    // web_search is only available via z-ai SDK; skip for other providers
    return "News search unavailable for this provider (GLM only).";
  }
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const base = symbol.replace("USDT", "").replace("BTC", "Bitcoin").replace("ETH", "Ethereum").replace("SOL", "Solana");
    const results = await zai.functions.invoke("web_search", {
      query: `${base} crypto price news today`,
      num: 4,
      recency_days: 2,
    });
    if (!Array.isArray(results) || results.length === 0) return "No recent news found.";
    return results
      .slice(0, 4)
      .map((r: any, i: number) => `${i + 1}. ${r.name} — ${r.snippet ?? ""}`.slice(0, 180))
      .join("\n");
  } catch (e: any) {
    return `News search unavailable: ${e?.message ?? "error"}`;
  }
}

function lessonsToText(lessons: StrategyLesson[]): string {
  if (lessons.length === 0) return "No active strategy lessons yet.";
  return lessons
    .map((l, i) => `${i + 1}. [${l.category}/${l.severity}] ${l.lesson}${l.suggestedAction ? ` → action: ${l.suggestedAction}` : ""}`)
    .join("\n");
}

export interface GenerateLLMDecisionOptions {
  provider?: Provider;
  model?: string;
  reasoning?: boolean;
  useSearch?: boolean;
  llmWeight?: number;
  memoryTopK?: number;
  lessons?: StrategyLesson[];
}

export async function generateLLMDecision(
  hmm: HMMSignal,
  digest: MarketDigest,
  opts: GenerateLLMDecisionOptions = {},
): Promise<LLMDecision> {
  const started = Date.now();
  const provider = opts.provider ?? "glm";
  const useSearch = opts.useSearch ?? true;
  const memoryTopK = opts.memoryTopK ?? 5;
  const lessons = opts.lessons ?? [];

  // --- Build current market signature & recall similar past trades ---
  const maSpread = digest.shortMA && digest.longMA ? ((digest.shortMA - digest.longMA) / digest.longMA) * 100 : 0;
  const features = {
    symbol: digest.symbol,
    side: hmm.label === "RISE" ? "LONG" as const : "SHORT" as const,
    rsi: digest.rsi14,
    atrPct: digest.lastPrice > 0 ? (digest.atr14 / digest.lastPrice) * 100 : 0,
    maSpread,
    funding: digest.fundingRate,
    pct24h: digest.pct24h,
    hmmProb: hmm.probability,
    obs: hmm.obsAtCursor,
  };
  const signature = featuresToSignature(features);

  let memoryMatches: MemoryMatch[] = [];
  try {
    memoryMatches = await recallSimilar(signature, digest.symbol, memoryTopK);
  } catch {
    // memory not available — continue without
  }
  const memoryText = formatMemoryForPrompt(memoryMatches);
  const memoryIds = memoryMatches.map((m) => m.id);

  // --- Fetch news (GLM only) ---
  const news = useSearch ? await searchNews(digest.symbol, provider) : "Search disabled by config.";

  // --- Build user prompt ---
  const userPrompt = [
    `HMM structural signal: ${hmm.label} (posterior proxy ${hmm.probability.toFixed(3)})`,
    `Last observable state: ${hmm.obsLabel}`,
    `HMM training log-likelihood: ${hmm.logLikelihood.toFixed(1)}`,
    ``,
    `=== MEMORY (your past trades, most similar first) ===`,
    memoryText,
    ``,
    `=== ACTIVE STRATEGY LESSONS ===`,
    lessonsToText(lessons),
    ``,
    `=== MARKET DIGEST ===`,
    digestToText(digest),
    ``,
    `=== RECENT NEWS ===`,
    news,
    ``,
    `Decide now. Reference memory/lessons in your reasoning when relevant. Strict JSON, no markdown.`,
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  try {
    const result = await chat(messages, {
      provider,
      model: opts.model,
      temperature: 0.4,
      maxTokens: 700,
      reasoning: opts.reasoning,
    });

    const parsed = extractJson(result.content);
    const action = (parsed.action as LLMAction) ?? "AGREE";
    const confidence = clamp(Number(parsed.confidence) ?? 0.5, 0, 1);

    let finalSide: LLMDecision["finalSide"] = "FLAT";
    if (action === "OVERRIDE_LONG") finalSide = "LONG";
    else if (action === "OVERRIDE_SHORT") finalSide = "SHORT";
    else if (action === "STRONG_AGREE" || action === "AGREE") {
      finalSide = hmm.label === "RISE" ? "LONG" : "SHORT";
    }
    if (parsed.finalSide === "LONG" || parsed.finalSide === "SHORT" || parsed.finalSide === "FLAT") {
      finalSide = parsed.finalSide;
    }

    return {
      action,
      confidence,
      reasoning: String(parsed.reasoning ?? result.reasoningContent ?? "").slice(0, 800),
      marketSummary: String(parsed.marketSummary ?? "").slice(0, 200),
      newsDigest: news,
      finalSide,
      latencyMs: Date.now() - started,
      usedSearch: useSearch && provider === "glm",
      usedMemory: memoryMatches.length > 0,
      memoryMatches: memoryMatches.length,
      memoryIds,
      lessonsApplied: lessons.length,
      provider: result.provider,
      model: result.model,
    };
  } catch (e: any) {
    // Fallback: agree with HMM with neutral confidence.
    return {
      action: "AGREE",
      confidence: 0.3,
      reasoning: `LLM call failed (${e?.message ?? "error"}); defaulting to AGREE with HMM. ${memoryMatches.length > 0 ? `Memory had ${memoryMatches.length} similar setups.` : ""}`,
      marketSummary: "LLM error",
      newsDigest: news,
      finalSide: hmm.label === "RISE" ? "LONG" : "SHORT",
      latencyMs: Date.now() - started,
      usedSearch: useSearch && provider === "glm",
      usedMemory: memoryMatches.length > 0,
      memoryMatches: memoryMatches.length,
      memoryIds,
      lessonsApplied: lessons.length,
      provider,
      model: opts.model || "fallback",
    };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function extractJson(raw: string): Record<string, any> {
  if (!raw) return {};
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return {};
  }
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return {};
  }
}
