/**
 * Memory layer — gives the LLM long-term recall of past trades.
 *
 * Each closed trade is converted into a `TradeMemory` row with:
 *   - A numeric "signature" vector derived from market features at entry
 *   - A human-readable digest injected into future LLM prompts
 *   - Tags for quick filtering
 *
 * Before each new LLM decision, we compute the current market's signature
 * and find the top-K most similar past memories (cosine similarity in
 * SQLite — no external vector DB needed).
 *
 * This is the "I've seen this setup before, last time I lost" instinct.
 */

import { db } from "@/lib/db";

export interface MarketFeatures {
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  rsi: number; // 0-100
  atrPct: number; // ATR as % of price
  maSpread: number; // (MA10 - MA50) / MA50 * 100
  funding: number; // funding rate %
  pct24h: number; // 24h price change %
  hmmProb: number; // 0-1
  obs: number; // observable state index 0-8
}

/**
 * Convert market features into a normalized [0,1] vector for similarity search.
 * Dimensions (8):
 *   0: rsi/100
 *   1: min(atrPct/5, 1)
 *   2: (maSpread + 10) / 20  — centered so -10%→0, +10%→1
 *   3: (funding + 0.1) / 0.2  — funding ±0.1% mapped to [0,1]
 *   4: (pct24h + 10) / 20
 *   5: hmmProb
 *   6: side_long (1 if LONG, 0 if SHORT/FLAT)
 *   7: obs / 8
 */
export function featuresToSignature(f: MarketFeatures): number[] {
  return [
    clamp01(f.rsi / 100),
    clamp01(f.atrPct / 5),
    clamp01((f.maSpread + 10) / 20),
    clamp01((f.funding + 0.1) / 0.2),
    clamp01((f.pct24h + 10) / 20),
    clamp01(f.hmmProb),
    f.side === "LONG" ? 1 : 0,
    clamp01(f.obs / 8),
  ];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}

/**
 * Build a digest string for a closed trade — injected verbatim into the LLM prompt.
 * Example: "BTCUSDT LONG @ $61970, RSI 42, ATR 1.1%, MA10<MA50 (bear), funding +0.012%, HMM RISE p=0.81 → +1.2% WIN (signal-flip)"
 */
export function buildDigest(
  symbol: string,
  side: string,
  entryPrice: number,
  features: MarketFeatures,
  pnlPct: number,
  outcome: "WIN" | "LOSS" | "BREAKEVEN",
  closedReason: string | null,
): string {
  const trend = features.maSpread > 0.5 ? "bull" : features.maSpread < -0.5 ? "bear" : "flat";
  const rsiZone = features.rsi > 70 ? "overbought" : features.rsi < 30 ? "oversold" : "neutral";
  const fundingStr = features.funding >= 0 ? `+${features.funding.toFixed(3)}%` : `${features.funding.toFixed(3)}%`;
  const pnlStr = pnlPct >= 0 ? `+${(pnlPct * 100).toFixed(2)}%` : `${(pnlPct * 100).toFixed(2)}%`;
  return `${symbol} ${side} @ $${entryPrice.toLocaleString("en-US", { maximumFractionDigits: entryPrice > 100 ? 0 : 4 })}, RSI ${features.rsi.toFixed(0)} (${rsiZone}), ATR ${features.atrPct.toFixed(2)}%, MA10${features.maSpread > 0 ? ">" : "<"}MA50 (${trend}), funding ${fundingStr}, HMM p=${features.hmmProb.toFixed(2)} → ${pnlStr} ${outcome} (${closedReason ?? "closed"})`;
}

/** Generate quick tags from features for filtering. */
export function buildTags(features: MarketFeatures): string[] {
  const tags: string[] = [];
  if (features.rsi > 70) tags.push("overbought");
  if (features.rsi < 30) tags.push("oversold");
  if (features.atrPct > 2) tags.push("high-vol");
  if (features.atrPct < 0.5) tags.push("low-vol");
  if (features.maSpread > 1) tags.push("trend-up");
  if (features.maSpread < -1) tags.push("trend-down");
  if (features.funding > 0.05) tags.push("funding-pos");
  if (features.funding < -0.05) tags.push("funding-neg");
  if (features.hmmProb > 0.75) tags.push("hmm-strong");
  if (features.hmmProb < 0.55) tags.push("hmm-weak");
  return tags;
}

/**
 * Persist a closed trade into the memory table.
 * Called after every trade close.
 */
export async function rememberTrade(
  tradeId: string,
  symbol: string,
  side: string,
  entryPrice: number,
  entryAt: Date,
  exitAt: Date,
  pnl: number,
  pnlPct: number,
  closedReason: string | null,
  features: MarketFeatures,
): Promise<void> {
  const outcome = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";
  const signature = featuresToSignature(features);
  const digest = buildDigest(symbol, side, entryPrice, features, pnlPct, outcome, closedReason);
  const tags = buildTags(features);

  await db.tradeMemory.create({
    data: {
      tradeId,
      symbol,
      side,
      entryAt,
      exitAt,
      pnl,
      pnlPct,
      outcome,
      closedReason,
      signature: JSON.stringify(signature),
      digest,
      tags: JSON.stringify(tags),
    },
  });
}

/**
 * Find the top-K most similar past trades for a given market signature.
 * Pure in-memory cosine similarity over all memories for this symbol
 * (plus symbol-agnostic ones). SQLite has no native vector search, but
 * for a few thousand trades this is sub-millisecond.
 */
export interface MemoryMatch {
  id: string;
  tradeId: string;
  symbol: string;
  side: string;
  pnl: number;
  pnlPct: number;
  outcome: string;
  closedReason: string | null;
  digest: string;
  similarity: number;
  entryAt: Date;
}

export async function recallSimilar(
  signature: number[],
  symbol: string,
  topK = 5,
): Promise<MemoryMatch[]> {
  // Pull all memories for this symbol (and a few symbol-agnostic recent ones).
  const all = await db.tradeMemory.findMany({
    where: { OR: [{ symbol }, { symbol: { not: symbol } }] },
    orderBy: { createdAt: "desc" },
    take: 2000, // cap for perf
  });

  const scored = all
    .map((m) => {
      let sig: number[];
      try {
        sig = JSON.parse(m.signature);
      } catch {
        return null;
      }
      const sim = cosine(signature, sig);
      return {
        id: m.id,
        tradeId: m.tradeId,
        symbol: m.symbol,
        side: m.side,
        pnl: m.pnl,
        pnlPct: m.pnlPct,
        outcome: m.outcome,
        closedReason: m.closedReason,
        digest: m.digest,
        similarity: sim,
        entryAt: m.entryAt,
      } as MemoryMatch;
    })
    .filter((x): x is MemoryMatch => x !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  // Only return memories with meaningful similarity (>0.5).
  return scored.filter((m) => m.similarity > 0.5);
}

/**
 * Format memory matches into a prompt-friendly string.
 * Example:
 *   "3 similar past setups found:
 *    1. [sim 0.91] BTCUSDT LONG @ $61.9k, RSI 42... → +1.2% WIN
 *    2. [sim 0.85] BTCUSDT LONG @ $60.2k, RSI 45... → -0.8% LOSS (stop)
 *    3. [sim 0.78] BTCUSDT LONG @ $63.5k, RSI 40... → +2.1% WIN
 *    Pattern: 2 wins, 1 loss (67% win rate, avg +0.83%)"
 */
export function formatMemoryForPrompt(matches: MemoryMatch[]): string {
  if (matches.length === 0) {
    return "No similar past setups found in memory yet.";
  }
  const wins = matches.filter((m) => m.outcome === "WIN").length;
  const losses = matches.filter((m) => m.outcome === "LOSS").length;
  const avgPnl = matches.reduce((a, m) => a + m.pnlPct, 0) / matches.length;
  const winRate = ((wins / matches.length) * 100).toFixed(0);
  const avgStr = (avgPnl * 100).toFixed(2);

  const lines = matches.map((m, i) => {
    const sim = (m.similarity * 100).toFixed(0);
    const pnlStr = m.pnlPct >= 0 ? `+${(m.pnlPct * 100).toFixed(2)}%` : `${(m.pnlPct * 100).toFixed(2)}%`;
    return `${i + 1}. [sim ${sim}%] ${m.digest}`;
  });

  return [
    `${matches.length} similar past setup${matches.length === 1 ? "" : "s"} found in memory:`,
    ...lines,
    `Pattern summary: ${wins} wins, ${losses} losses (${winRate}% win rate, avg ${avgStr}%/trade)`,
  ].join("\n");
}
