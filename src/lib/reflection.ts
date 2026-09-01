/**
 * Reflection loop — the LLM reviews its recent trades and distills lessons.
 *
 * Every `reflectionInterval` closed trades (per symbol, or portfolio-wide),
 * the loop:
 *   1. Pulls the last N closed trades with their features + outcomes.
 *   2. Builds a reflection prompt: "Here's what happened. What patterns
 *      do you see? What should you do differently?"
 *   3. LLM emits structured lessons (category, severity, suggested action).
 *   4. Lessons are persisted as StrategyNote rows.
 *   5. Future LLM decisions consult these notes via the lessons injection.
 *
 * This is the "learn from your mistakes" loop — turns raw trade history
 * into actionable strategy adjustments.
 */

import { db } from "@/lib/db";
import { chat, type Provider, type ChatMessage } from "./llm-provider";
import { buildDigest, type MarketFeatures } from "./memory";

export interface ReflectionResult {
  symbol: string | null;
  tradesReviewed: number;
  winsReviewed: number;
  lossesReviewed: number;
  netPnl: number;
  summary: string;
  lessonsGenerated: number;
  notesCreated: { id: string; category: string; lesson: string }[];
  latencyMs: number;
  provider: string;
  model: string;
  rawResponse?: string;
}

const REFLECTION_SYSTEM = `You are the reflection module of an algorithmic trading bot on Bybit.
You will receive a list of recent closed trades with their market context, HMM signals, LLM decisions, and outcomes.

Your job: identify recurring patterns — what worked, what failed, and what the bot should do differently next time.

Output strictly valid JSON with this shape:
{
  "summary": "2-4 sentence executive summary of the session",
  "lessons": [
    {
      "category": "PATTERN" | "RISK" | "TIMING" | "OVERRIDE" | "CONFIRMATION",
      "severity": "INFO" | "WARNING" | "CRITICAL",
      "symbol": "BTCUSDT" | null,
      "lesson": "the lesson in one sentence",
      "suggestedAction": "concrete actionable adjustment, or null",
      "confidence": 0.0-1.0
    }
  ]
}

Guidelines:
- PATTERN: recurring setups (e.g. "LONG on oversold + HMM RISE won 4/5 times")
- RISK: position sizing / stop-loss issues (e.g. "stops too tight on high-volatility BTC")
- TIMING: entry/exit timing (e.g. "entering at funding > 0.05% led to 3 losses")
- OVERRIDE: when HMM was wrong and LLM should have overridden (e.g. "HMM RISE + RSI > 75 → 3 losses, should HOLD")
- CONFIRMATION: when confirmation was needed (e.g. "need MA10>MA50 confirmation before LONG")

Only emit lessons with confidence >= 0.5. Emit at most 5 lessons.
Never wrap the JSON in markdown.`;

interface TradeForReflection {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  entryAt: Date;
  exitAt: Date;
  pnl: number;
  pnlPct: number;
  closedReason: string | null;
  hmmSignal: string;
  hmmProb: number;
  llmAction: string | null;
  llmConfidence: number | null;
  reason: string | null;
  features: MarketFeatures | null;
}

export async function runReflection(opts: {
  symbol?: string | null;
  provider?: Provider;
  model?: string;
  reasoning?: boolean;
  windowSize?: number;
}): Promise<ReflectionResult> {
  const started = Date.now();
  const provider = opts.provider ?? "glm";
  const windowSize = opts.windowSize ?? 20;
  const symbol = opts.symbol ?? null;

  // Pull the most recent N closed trades.
  const trades = await db.trade.findMany({
    where: {
      status: "CLOSED",
      ...(symbol ? { symbol } : {}),
    },
    orderBy: { exitAt: "desc" },
    take: windowSize,
  });

  if (trades.length < 3) {
    return {
      symbol,
      tradesReviewed: trades.length,
      winsReviewed: 0,
      lossesReviewed: 0,
      netPnl: 0,
      summary: "Not enough closed trades to reflect on yet (need ≥3).",
      lessonsGenerated: 0,
      notesCreated: [],
      latencyMs: Date.now() - started,
      provider,
      model: "n/a",
    };
  }

  // Parse features from each trade.
  const enriched: TradeForReflection[] = trades.map((t) => {
    let features: MarketFeatures | null = null;
    if (t.features) {
      try {
        features = JSON.parse(t.features);
      } catch {
        features = null;
      }
    }
    return {
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice ?? t.entryPrice,
      entryAt: t.entryAt,
      exitAt: t.exitAt ?? t.entryAt,
      pnl: t.pnl ?? 0,
      pnlPct: t.pnlPct ?? 0,
      closedReason: t.closedReason,
      hmmSignal: t.hmmSignal,
      hmmProb: t.hmmProb,
      llmAction: t.llmAction,
      llmConfidence: t.llmConfidence,
      reason: t.reason,
      features,
    };
  });

  const wins = enriched.filter((t) => t.pnl > 0).length;
  const losses = enriched.filter((t) => t.pnl < 0).length;
  const netPnl = enriched.reduce((a, t) => a + t.pnl, 0);

  // Build the reflection prompt.
  const tradeLines = enriched
    .slice()
    .reverse() // chronological
    .map((t, i) => {
      const outcome = t.pnl > 0 ? "WIN" : t.pnl < 0 ? "LOSS" : "BE";
      const pnlStr = t.pnlPct >= 0 ? `+${(t.pnlPct * 100).toFixed(2)}%` : `${(t.pnlPct * 100).toFixed(2)}%`;
      const f = t.features;
      const ctx = f
        ? `RSI ${f.rsi.toFixed(0)}, ATR ${f.atrPct.toFixed(2)}%, MA spread ${f.maSpread.toFixed(2)}%, funding ${f.funding.toFixed(3)}%, 24h ${f.pct24h.toFixed(2)}%`
        : "no features";
      return `${i + 1}. ${t.symbol} ${t.side} @ $${t.entryPrice.toLocaleString("en-US", { maximumFractionDigits: t.entryPrice > 100 ? 0 : 4 })} → $${t.exitPrice.toLocaleString("en-US", { maximumFractionDigits: t.exitPrice > 100 ? 0 : 4 })} | ${pnlStr} ${outcome} (${t.closedReason}) | HMM ${t.hmmSignal} p=${t.hmmProb.toFixed(2)} | LLM ${t.llmAction ?? "n/a"} conf=${t.llmConfidence?.toFixed(2) ?? "n/a"} | ${ctx}`;
    })
    .join("\n");

  const stats = [
    `Trades reviewed: ${enriched.length}`,
    `Wins: ${wins} (${((wins / enriched.length) * 100).toFixed(0)}%)  Losses: ${losses}`,
    `Net PnL: $${netPnl.toFixed(2)}`,
    `Avg PnL/trade: ${(netPnl / enriched.length).toFixed(2)}`,
  ].join("\n");

  const userPrompt = [
    `=== REFLECTION SESSION ===`,
    `Symbol: ${symbol ?? "portfolio-wide"}`,
    stats,
    ``,
    `=== TRADE HISTORY (chronological) ===`,
    tradeLines,
    ``,
    `Identify patterns and emit lessons. Strict JSON.`,
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: REFLECTION_SYSTEM },
    { role: "user", content: userPrompt },
  ];

  try {
    const result = await chat(messages, {
      provider,
      model: opts.model,
      temperature: 0.5,
      maxTokens: 1200,
      reasoning: opts.reasoning ?? (provider === "deepseek"),
    });

    const parsed = extractJson(result.content);
    const summary = String(parsed.summary ?? "").slice(0, 500);
    const rawLessons: any[] = Array.isArray(parsed.lessons) ? parsed.lessons : [];

    // Persist each lesson as a StrategyNote.
    const notesCreated: ReflectionResult["notesCreated"] = [];
    const currentVersion = await getCurrentStrategyVersion();

    for (const l of rawLessons.slice(0, 5)) {
      const confidence = clamp(Number(l.confidence) ?? 0.6, 0, 1);
      if (confidence < 0.5) continue;

      const note = await db.strategyNote.create({
        data: {
          symbol: l.symbol && typeof l.symbol === "string" ? l.symbol : symbol,
          category: String(l.category ?? "PATTERN").slice(0, 20),
          severity: String(l.severity ?? "INFO").slice(0, 20),
          lesson: String(l.lesson ?? "").slice(0, 500),
          suggestedAction: l.suggestedAction ? String(l.suggestedAction).slice(0, 300) : null,
          confidence,
          evidence: JSON.stringify(enriched.map((t) => t.id)),
          strategyVersion: currentVersion,
        },
      });
      notesCreated.push({
        id: note.id,
        category: note.category,
        lesson: note.lesson,
      });
    }

    // Persist reflection session.
    const reflection = await db.reflection.create({
      data: {
        symbol,
        tradesReviewed: enriched.length,
        winsReviewed: wins,
        lossesReviewed: losses,
        netPnl,
        summary,
        lessonsGenerated: notesCreated.length,
        notesJson: JSON.stringify(notesCreated.map((n) => n.id)),
        rawResponse: result.content.slice(0, 5000),
      },
    });

    // Bump strategy version if lessons were generated.
    if (notesCreated.length > 0) {
      await db.botState.update({
        where: { id: "singleton" },
        data: { lastReflectionAt: new Date() },
      });
    }

    return {
      symbol,
      tradesReviewed: enriched.length,
      winsReviewed: wins,
      lossesReviewed: losses,
      netPnl,
      summary,
      lessonsGenerated: notesCreated.length,
      notesCreated,
      latencyMs: Date.now() - started,
      provider: result.provider,
      model: result.model,
      rawResponse: result.content.slice(0, 2000),
    };
  } catch (e: any) {
    // Persist failed reflection attempt.
    await db.reflection.create({
      data: {
        symbol,
        tradesReviewed: enriched.length,
        winsReviewed: wins,
        lossesReviewed: losses,
        netPnl,
        summary: `Reflection failed: ${e?.message ?? "error"}`,
        lessonsGenerated: 0,
        rawResponse: e?.message ?? String(e),
      },
    });

    return {
      symbol,
      tradesReviewed: enriched.length,
      winsReviewed: wins,
      lossesReviewed: losses,
      netPnl,
      summary: `Reflection failed: ${e?.message ?? "error"}`,
      lessonsGenerated: 0,
      notesCreated: [],
      latencyMs: Date.now() - started,
      provider,
      model: opts.model || "error",
    };
  }
}

async function getCurrentStrategyVersion(): Promise<number> {
  const latest = await db.strategyNote.findFirst({
    orderBy: { createdAt: "desc" },
    select: { strategyVersion: true },
  });
  return (latest?.strategyVersion ?? 0) + 1;
}

/**
 * Fetch active strategy notes to inject into LLM decisions.
 * Returns notes for this symbol + symbol-agnostic notes, capped at 8.
 */
export async function getActiveLessons(symbol: string): Promise<{
  id: string;
  category: string;
  severity: string;
  lesson: string;
  suggestedAction?: string | null;
  confidence: number;
  symbol: string | null;
}[]> {
  const notes = await db.strategyNote.findMany({
    where: {
      OR: [{ symbol }, { symbol: null }],
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    take: 8,
  });
  return notes;
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
  if (first === -1 || last === -1 || last <= first) return {};
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return {};
  }
}
