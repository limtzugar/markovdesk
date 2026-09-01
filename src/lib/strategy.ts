/**
 * Strategy engine — combines HMM signal with LLM overlay and produces a
 * final trading decision. Manages the paper-trading book.
 *
 * Risk gates (from BotState):
 *   - positionSizePct: fraction of equity per trade
 *   - stopLossPct:     hard stop loss
 *   - maxDrawdownPct:  auto-halt if exceeded
 *
 * The investment strategy follows Andersson & Fransson §3.3.6:
 *   LONG  when next-bar direction predicted RISE
 *   SHORT when next-bar direction predicted DROP
 * Position is held for exactly one bar, then re-evaluated.
 * (We relax "one bar" — position stays open until signal flips or stop/target hits.)
 */

import { db } from "@/lib/db";

// Global crash handlers — log unhandled errors so we can see them in the log
// instead of the process dying silently.
if (!globalThis.__markovHandlersInstalled) {
  globalThis.__markovHandlersInstalled = true;
  process.on("unhandledRejection", (err) => {
    console.error("[FATAL] unhandledRejection:", err);
  });
  process.on("uncaughtException", (err) => {
    console.error("[FATAL] uncaughtException:", err);
  });
}

import {
  trainAndPredict,
  predictWithModel,
  type HMMParams,
  type HMMSignal,
  sharpeRatio,
  maxDrawdown,
} from "@/lib/hmm";
import { fetchKlines, fetchKlinesRange, buildMarketDigest, type Kline } from "@/lib/bybit";
import { generateLLMDecision, type LLMDecision } from "@/lib/llm";
import { rememberTrade, type MarketFeatures } from "@/lib/memory";
import { runReflection, getActiveLessons, type ReflectionResult } from "@/lib/reflection";
import type { Provider } from "@/lib/llm-provider";

export interface SignalCycle {
  ts: number;
  symbol: string;
  interval: string;
  hmm: HMMSignal;
  llm: LLMDecision;
  finalSide: "LONG" | "SHORT" | "FLAT";
  finalConfidence: number;
  price: number;
  mode: "STATIC" | "DYNAMIC";
}

export interface BotSnapshot {
  running: boolean;
  symbol: string;
  symbols: string[];
  interval: string;
  mode: "STATIC" | "DYNAMIC";
  capital: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  position: {
    side: "LONG" | "SHORT" | "FLAT";
    size: number;
    entryPrice: number;
    entryAt: number | null;
    markPrice: number;
    unrealizedPnl: number;
    unrealizedPct: number;
    symbol: string;
  };
  openPositions: { symbol: string; side: "LONG" | "SHORT"; entryPrice: number; size: number; entryAt: number; markPrice: number; unrealizedPnl: number }[];
  openTrades: number;
  totalTrades: number;
  winRate: number;
  drawdown: number;
  lastSignal: SignalCycle | null;
  lastError: string | null;
  lastCycleAt: number | null;
  nextCycleAt: number | null;
  lastReflectionAt: number | null;
  activeLessons: number;
  memoryCount: number;
  llmProvider: string;
}

/** In-memory runtime state for the active bot. */
interface Runtime {
  cycleTimer: NodeJS.Timeout | null;
  /** Per-symbol cached HMM model (key = symbol). */
  cachedModels: Map<string, { params: HMMParams; trainedAt: number; barTs: number }>;
  equityHistory: { ts: number; equity: number }[];
  peakEquity: number;
  halted: boolean;
  haltReason: string | null;
  lastSignal: SignalCycle | null;
  lastError: string | null;
  lastCycleAt: number | null;
  nextCycleAt: number | null;
  /** Counters for triggering reflection (key = symbol or "portfolio"). */
  closedSinceReflection: Map<string, number>;
  lastReflectionAt: number | null;
}

const runtime: Runtime = {
  cycleTimer: null,
  cachedModels: new Map(),
  equityHistory: [],
  peakEquity: 0,
  halted: false,
  haltReason: null,
  lastSignal: null,
  lastError: null,
  lastCycleAt: null,
  nextCycleAt: null,
  closedSinceReflection: new Map(),
  lastReflectionAt: null,
};

async function getBot() {
  let b = await db.botState.findUnique({ where: { id: "singleton" } });
  if (!b) {
    try {
      b = await db.botState.create({ data: { id: "singleton" } });
    } catch {
      // Race: another request created it first. Re-fetch.
      b = await db.botState.findUnique({ where: { id: "singleton" } });
    }
  }
  return b!;
}

/** Get currently-open trade for a specific symbol. */
async function getOpenTrade(symbol?: string) {
  return db.trade.findFirst({
    where: { status: "OPEN", ...(symbol ? { symbol } : {}) },
    orderBy: { entryAt: "desc" },
  });
}

/** Get all open trades (for multi-symbol portfolio view). */
async function getOpenTrades() {
  return db.trade.findMany({ where: { status: "OPEN" }, orderBy: { entryAt: "desc" } });
}

async function closeTrade(tradeId: string, exitPrice: number, reason: string) {
  const t = await db.trade.findUnique({ where: { id: tradeId } });
  if (!t) return null;
  const dir = t.side === "LONG" ? 1 : -1;
  const pnl = dir * (exitPrice - t.entryPrice) * t.size;
  const pnlPct = t.entryPrice > 0 ? (dir * (exitPrice - t.entryPrice)) / t.entryPrice : 0;
  const closed = await db.trade.update({
    where: { id: tradeId },
    data: {
      status: "CLOSED",
      exitPrice,
      exitAt: new Date(),
      pnl,
      pnlPct,
      closedReason: reason,
    },
  });

  // --- Persist this trade into long-term memory ---
  if (t.features) {
    try {
      const features = JSON.parse(t.features) as MarketFeatures;
      await rememberTrade(
        t.id,
        t.symbol,
        t.side,
        t.entryPrice,
        t.entryAt,
        closed.exitAt ?? new Date(),
        pnl,
        pnlPct,
        reason,
        features,
      );
    } catch {
      // memory persistence is best-effort
    }
  }

  // --- Increment reflection counter for this symbol ---
  const key = t.symbol;
  const cur = runtime.closedSinceReflection.get(key) ?? 0;
  runtime.closedSinceReflection.set(key, cur + 1);

  return closed;
}

async function openTrade(
  symbol: string,
  side: "LONG" | "SHORT",
  price: number,
  equity: number,
  sizePct: number,
  leverage: number,
  hmm: HMMSignal,
  llm: LLMDecision,
  features: MarketFeatures,
) {
  const notional = equity * sizePct * leverage;
  const size = notional / price;
  return db.trade.create({
    data: {
      symbol,
      side,
      size,
      entryPrice: price,
      status: "OPEN",
      hmmSignal: hmm.label,
      hmmProb: hmm.probability,
      llmAction: llm.action,
      llmConfidence: llm.confidence,
      reason: llm.reasoning.slice(0, 500),
      features: JSON.stringify(features),
      memoryIds: JSON.stringify(llm.memoryIds ?? []),
    },
  });
}

/**
 * Compute current equity = realized PnL + capital + unrealized PnL.
 * Realized PnL is the sum of closed trades. Unrealized sums ALL open positions
 * across the portfolio (multi-symbol).
 */
async function computeEquity(capital: number, markPrices: Record<string, number>) {
  const closed = await db.trade.aggregate({
    where: { status: "CLOSED" },
    _sum: { pnl: true },
  });
  const realized = closed._sum.pnl ?? 0;
  const opens = await getOpenTrades();
  let unrealized = 0;
  for (const o of opens) {
    const mp = markPrices[o.symbol] ?? o.entryPrice;
    const dir = o.side === "LONG" ? 1 : -1;
    unrealized += dir * (mp - o.entryPrice) * o.size;
  }
  return {
    equity: capital + realized + unrealized,
    realized,
    unrealized,
    opens,
  };
}

/**
 * The core cycle — iterates over every symbol in the portfolio.
 * For each symbol: fetch klines → train/predict HMM → query LLM (with
 * memory + lessons) → blend signal → manage position.
 * Then runs reflection if enough trades have closed since last reflection.
 */
export async function runCycle(): Promise<SignalCycle | null> {
  const bot = await getBot();
  if (!bot.running || runtime.halted) return null;

  const symbols = parseSymbols(bot.symbols);
  if (symbols.length === 0) {
    runtime.lastError = "No symbols configured";
    return null;
  }

  let lastCycle: SignalCycle | null = null;

  try {
    const mem = process.memoryUsage();
    console.error(`[cycle start] rss=${(mem.rss / 1024 / 1024).toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB`);

    // Mark prices will be populated per-symbol inside runCycleForSymbol
    // (avoids redundant fetches — snapshot already caches prices).
    const markPrices: Record<string, number> = {};

    for (const symbol of symbols) {
      try {
        const cycle = await runCycleForSymbol(bot, symbol, markPrices);
        if (cycle) lastCycle = cycle;
      } catch (e: any) {
        console.error(`[cycle error] ${symbol}:`, e?.message ?? e);
        runtime.lastError = `${symbol}: ${e?.message ?? "error"}`;
      }
    }

    // --- Reflection trigger ---
    await maybeRunReflection(bot);

    const mem2 = process.memoryUsage();
    console.error(`[cycle end] rss=${(mem2.rss / 1024 / 1024).toFixed(0)}MB heap=${(mem2.heapUsed / 1024 / 1024).toFixed(0)}MB`);

    return lastCycle;
  } catch (e: any) {
    console.error(`[cycle FATAL]:`, e?.message ?? e);
    runtime.lastError = e?.message ?? "Unknown error";
    return null;
  }
}

function parseSymbols(symbolsStr: string): string[] {
  if (!symbolsStr) return ["BTCUSDT"];
  return symbolsStr
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Run one signal cycle for a single symbol. Mutates runtime state.
 */
async function runCycleForSymbol(
  bot: any,
  symbol: string,
  markPrices: Record<string, number>,
): Promise<SignalCycle | null> {
  const klines = await fetchKlines(symbol, bot.interval, Math.max(bot.trainingWindow + 20, 220));
  if (klines.length < 50) {
    throw new Error(`Not enough klines (${klines.length})`);
  }

  const lastPrice = klines[klines.length - 1].close;
  const delta = lastPrice * bot.deltaPct;

  // --- HMM stage (per-symbol cached model) ---
  let hmm: HMMSignal;
  const barTs = klines[klines.length - 1].ts;
  const cachedModel = runtime.cachedModels.get(symbol);

  if (bot.mode === "STATIC" && cachedModel && cachedModel.barTs === barTs) {
    const p = predictWithModel(klines, delta, cachedModel.params);
    if (!p) throw new Error("HMM predict failed");
    hmm = p;
  } else if (bot.mode === "STATIC" && cachedModel) {
    const age = Date.now() - cachedModel.trainedAt;
    if (age > 24 * 3600 * 1000) {
      const fresh = trainAndPredict(klines, delta);
      if (!fresh) throw new Error("HMM training failed");
      hmm = fresh;
      runtime.cachedModels.set(symbol, { params: fresh.params, trainedAt: Date.now(), barTs });
      await persistModel(bot, symbol, fresh);
    } else {
      const p = predictWithModel(klines, delta, cachedModel.params);
      if (!p) throw new Error("HMM predict failed");
      hmm = p;
    }
  } else {
    // DYNAMIC: retrain every cycle.
    const fresh = trainAndPredict(klines, delta);
    if (!fresh) throw new Error("HMM training failed");
    hmm = fresh;
    runtime.cachedModels.set(symbol, { params: fresh.params, trainedAt: Date.now(), barTs });
    await persistModel(bot, symbol, fresh);
  }

  // --- Build market features for memory ---
  const digest = await buildMarketDigest(symbol, bot.interval, klines);
  const maSpread = digest.shortMA && digest.longMA ? ((digest.shortMA - digest.longMA) / digest.longMA) * 100 : 0;
  const features: MarketFeatures = {
    symbol,
    side: hmm.label === "RISE" ? "LONG" : "SHORT",
    rsi: digest.rsi14,
    atrPct: digest.lastPrice > 0 ? (digest.atr14 / digest.lastPrice) * 100 : 0,
    maSpread,
    funding: digest.fundingRate,
    pct24h: digest.pct24h,
    hmmProb: hmm.probability,
    obs: hmm.obsAtCursor,
  };

  // --- Decide whether LLM is needed this cycle ---
  // LLM is the decisive overlay — called only when it actually adds value,
  // not every cycle. This keeps token usage low.
  //
  // LLM IS called when:
  //   1. HMM is genuinely uncertain (probability in 0.45-0.72 band) — needs discretion
  //   2. There's an open position AND signal flipped — close/hold decision
  //
  // LLM IS SKIPPED when:
  //   - HMM confident (>0.72) → follow HMM, no LLM needed
  //   - Position aligns with signal → hold, no LLM
  //   - Already cached for this bar
  const openBefore = await getOpenTrade(symbol);
  const signalFlipped =
    openBefore &&
    ((openBefore.side === "LONG" && hmm.label === "DROP") ||
      (openBefore.side === "SHORT" && hmm.label === "RISE"));
  const hmmConfident = hmm.probability > 0.72;
  const hmmUncertain = hmm.probability > 0.45 && hmm.probability < 0.72;
  const positionAligns =
    openBefore &&
    ((openBefore.side === "LONG" && hmm.label === "RISE") ||
      (openBefore.side === "SHORT" && hmm.label === "DROP"));

  const needsLLM = bot.llmEnabled && (hmmUncertain || signalFlipped);

  // --- LLM stage (with memory + lessons) ---
  const cacheKey = `${symbol}:${barTs}`;
  const cached = llmCache.get(cacheKey);
  let llm: LLMDecision;

  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
    llm = cached.decision;
  } else if (needsLLM) {
    const lessons = await getActiveLessons(symbol);
    llm = await generateLLMDecision(hmm, digest, {
      provider: (bot.llmProvider || "glm") as Provider,
      model: bot.llmModel || undefined,
      reasoning: bot.llmProvider === "deepseek" || bot.llmProvider === "nemotron",
      useSearch: bot.llmEnabled && (bot.llmProvider || "glm") === "glm", // only GLM has web_search
      llmWeight: bot.llmWeight,
      memoryTopK: bot.memoryTopK ?? 5,
      lessons,
    });
    llmCache.set(cacheKey, { decision: llm, ts: Date.now() });
    if (llmCache.size > 50) {
      const oldest = Array.from(llmCache.entries()).sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) llmCache.delete(oldest[0]);
    }
  } else {
    // LLM not needed — synthesize a default decision based on HMM.
    const reason = !bot.llmEnabled
      ? "LLM disabled."
      : hmmConfident && !signalFlipped
      ? `HMM confident (p=${hmm.probability.toFixed(2)}), following HMM — no LLM needed.`
      : positionAligns
      ? `Position aligns with HMM (${hmm.label}), holding — no LLM needed.`
      : `LLM skipped (p=${hmm.probability.toFixed(2)}, no flip).`;
    llm = {
      action: "AGREE",
      confidence: hmm.probability,
      reasoning: reason,
      marketSummary: "",
      newsDigest: "",
      finalSide: hmm.label === "RISE" ? "LONG" : "SHORT",
      latencyMs: 0,
      usedSearch: false,
      usedMemory: false,
      memoryMatches: 0,
      memoryIds: [],
      lessonsApplied: 0,
      provider: "hmm-only",
      model: "skip",
    };
  }

  // --- Blend HMM + LLM ---
  let finalSide: "LONG" | "SHORT" | "FLAT" = llm.finalSide;
  if (!bot.llmEnabled) {
    finalSide = hmm.label === "RISE" ? "LONG" : "SHORT";
  }
  if (llm.action === "HOLD" && hmm.probability > 0.7) {
    finalSide = hmm.label === "RISE" ? "LONG" : "SHORT";
  }
  const finalConfidence = bot.llmEnabled
    ? 0.5 * hmm.probability + 0.5 * llm.confidence
    : hmm.probability;

  const cycle: SignalCycle = {
    ts: Date.now(),
    symbol,
    interval: bot.interval,
    hmm,
    llm,
    finalSide,
    finalConfidence,
    price: lastPrice,
    mode: bot.mode as "STATIC" | "DYNAMIC",
  };
  runtime.lastSignal = cycle;
  runtime.lastCycleAt = cycle.ts;

  // --- Position management for THIS symbol ---
  markPrices[symbol] = lastPrice;
  const { equity } = await computeEquity(bot.capital, markPrices);
  runtime.equityHistory.push({ ts: cycle.ts, equity });
  if (equity > runtime.peakEquity) runtime.peakEquity = equity;
  runtime.equityHistory = runtime.equityHistory.slice(-500);

  // Portfolio-level drawdown check.
  const dd = runtime.peakEquity > 0 ? (runtime.peakEquity - equity) / runtime.peakEquity : 0;
  if (dd > bot.maxDrawdownPct) {
    runtime.halted = true;
    runtime.haltReason = `Max drawdown breached: ${(dd * 100).toFixed(2)}% > ${(bot.maxDrawdownPct * 100).toFixed(2)}%`;
    // Close ALL open positions across portfolio.
    const allOpen = await getOpenTrades();
    for (const o of allOpen) {
      await closeTrade(o.id, markPrices[o.symbol] ?? o.entryPrice, "STOP");
    }
    await db.botState.update({ where: { id: "singleton" }, data: { running: false } });
    return cycle;
  }

  // Per-symbol position management.
  const open = await getOpenTrade(symbol);
  if (open) {
    const dir = open.side === "LONG" ? 1 : -1;
    const movePct = (lastPrice - open.entryPrice) / open.entryPrice * dir;
    if (movePct <= -bot.stopLossPct) {
      await closeTrade(open.id, lastPrice, "STOP");
    } else if (
      (open.side === "LONG" && finalSide === "SHORT") ||
      (open.side === "SHORT" && finalSide === "LONG")
    ) {
      await closeTrade(open.id, lastPrice, "SIGNAL_FLIP");
    }
  }

  // Open new trade for this symbol if flat and signal is not FLAT.
  const stillOpen = await getOpenTrade(symbol);
  if (!stillOpen && finalSide !== "FLAT" && !runtime.halted) {
    await openTrade(symbol, finalSide, lastPrice, equity, bot.positionSizePct, bot.leverage, hmm, llm, features);
  }

  // Persist LLM reasoning.
  if (bot.llmEnabled) {
    await db.lLMReasoning.create({
      data: {
        symbol,
        hmmSignal: hmm.label,
        hmmProb: hmm.probability,
        llmAction: llm.action,
        llmConfidence: llm.confidence,
        reasoning: llm.reasoning,
        marketSummary: llm.marketSummary,
        candlesDigest: JSON.stringify(digest).slice(0, 2000),
        memoryUsed: JSON.stringify(llm.memoryIds ?? []),
      },
    });
  }

  await db.botState.update({
    where: { id: "singleton" },
    data: { lastSignalAt: new Date() },
  });

  return cycle;
}

/**
 * Trigger reflection if enough trades have closed since the last reflection
 * for any symbol (or portfolio-wide).
 */
async function maybeRunReflection(bot: any) {
  const interval = bot.reflectionInterval ?? 10;
  const provider = (bot.llmProvider || "glm") as Provider;

  for (const [symbol, count] of runtime.closedSinceReflection.entries()) {
    if (count >= interval) {
      try {
        const result = await runReflection({
          symbol,
          provider,
          model: bot.llmModel || undefined,
          reasoning: provider === "deepseek",
        });
        runtime.lastReflectionAt = Date.now();
        // Reset counter.
        runtime.closedSinceReflection.set(symbol, 0);
        // Also do a portfolio-wide reflection occasionally.
        if (count >= interval * 2) {
          await runReflection({
            symbol: null,
            provider,
            model: bot.llmModel || undefined,
            reasoning: provider === "deepseek",
          });
        }
      } catch (e: any) {
        runtime.lastError = `Reflection failed: ${e?.message ?? "error"}`;
      }
    }
  }
}

async function persistModel(bot: any, symbol: string, signal: HMMSignal) {
  await db.hMMModel.create({
    data: {
      symbol,
      interval: bot.interval,
      mode: bot.mode,
      transition: JSON.stringify(signal.params.A),
      emission: JSON.stringify(signal.params.B),
      pi: JSON.stringify(signal.params.pi),
      logLikelihood: signal.logLikelihood,
      trainingSize: bot.trainingWindow,
    },
  });
  // Keep only the latest 50 models (more for multi-symbol).
  const count = await db.hMMModel.count();
  if (count > 50) {
    const oldest = await db.hMMModel.findMany({ orderBy: { trainedAt: "asc" }, take: count - 50 });
    for (const m of oldest) await db.hMMModel.delete({ where: { id: m.id } });
  }
}

/** Interval between cycles — derived from kline interval. */
function cycleMs(interval: string): number {
  if (interval === "D") return 60 * 60 * 1000;
  if (interval === "W") return 4 * 60 * 60 * 1000;
  const mins = Number(interval);
  if (Number.isFinite(mins)) return Math.max(60_000, mins * 60 * 1000);
  return 60_000;
}

export async function startBot(): Promise<boolean> {
  const bot = await getBot();
  if (bot.running) return false;
  runtime.halted = false;
  runtime.haltReason = null;
  runtime.lastError = null;
  runtime.peakEquity = bot.capital;
  runtime.equityHistory = [{ ts: Date.now(), equity: bot.capital }];
  runtime.cachedModels.clear();
  runtime.closedSinceReflection.clear();

  await db.botState.update({ where: { id: "singleton" }, data: { running: true } });

  // Kick off the first cycle immediately.
  runCycle().catch(() => {});

  const ms = cycleMs(bot.interval);
  runtime.cycleTimer = setInterval(() => {
    runCycle().catch(() => {});
  }, ms);
  runtime.nextCycleAt = Date.now() + ms;
  return true;
}

export async function stopBot(): Promise<boolean> {
  if (runtime.cycleTimer) {
    clearInterval(runtime.cycleTimer);
    runtime.cycleTimer = null;
  }
  const bot = await getBot();
  if (bot.running) {
    // Close all open trades across portfolio at last known mark price.
    const opens = await getOpenTrades();
    for (const open of opens) {
      try {
        const d = await buildMarketDigest(open.symbol, bot.interval);
        await closeTrade(open.id, d.lastPrice, "MANUAL");
      } catch {
        // ignore — leave open in DB
      }
    }
    await db.botState.update({ where: { id: "singleton" }, data: { running: false } });
  }
  return true;
}

/** Simple in-memory price cache to avoid hammering Bybit API on every snapshot poll. */
const priceCache = new Map<string, { price: number; ts: number }>();
const PRICE_CACHE_MS = 30_000; // 30s

/** LLM decision cache — avoids re-calling the LLM for the same bar. */
const llmCache = new Map<string, { decision: LLMDecision; ts: number }>();

async function getCachedPrice(symbol: string): Promise<number> {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.ts < PRICE_CACHE_MS) return cached.price;
  try {
    const { fetchTicker } = await import("@/lib/bybit");
    const t = await fetchTicker(symbol);
    priceCache.set(symbol, { price: t.lastPrice, ts: Date.now() });
    return t.lastPrice;
  } catch {
    return cached?.price ?? 0;
  }
}

export async function snapshot(): Promise<BotSnapshot> {
  const bot = await getBot();
  const symbols = parseSymbols(bot.symbols);

  // Log memory usage every 10 snapshots to detect leaks.
  if (Math.random() < 0.1) {
    const mem = process.memoryUsage();
    console.error(`[mem] rss=${(mem.rss / 1024 / 1024).toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB external=${(mem.external / 1024 / 1024).toFixed(0)}MB`);
  }

  // Fetch mark prices for all symbols (cached 30s, sequential to avoid
  // spawning 4 concurrent fetches on every status poll).
  const markPrices: Record<string, number> = {};
  for (const sym of symbols) {
    markPrices[sym] = await getCachedPrice(sym);
  }
  const primarySymbol = symbols[0] ?? "BTCUSDT";
  const markPrice = markPrices[primarySymbol] ?? 0;

  const { equity, realized, unrealized, opens } = await computeEquity(bot.capital, markPrices);

  if (equity > runtime.peakEquity) runtime.peakEquity = equity;
  const dd = runtime.peakEquity > 0 ? (runtime.peakEquity - equity) / runtime.peakEquity : 0;

  const closed = await db.trade.findMany({
    where: { status: { in: ["CLOSED", "LIQUIDATED"] } },
    orderBy: { exitAt: "desc" },
    take: 500,
  });
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closed.length > 0 ? wins / closed.length : 0;
  const totalTrades = closed.length + opens.length;

  const open = opens[0] ?? null;
  const openPositions = opens.map((o) => {
    const mp = markPrices[o.symbol] ?? o.entryPrice;
    const dir = o.side === "LONG" ? 1 : -1;
    const upnl = dir * (mp - o.entryPrice) * o.size;
    return {
      symbol: o.symbol,
      side: o.side as "LONG" | "SHORT",
      entryPrice: o.entryPrice,
      size: o.size,
      entryAt: o.entryAt.getTime(),
      markPrice: mp,
      unrealizedPnl: upnl,
    };
  });

  const memoryCount = await db.tradeMemory.count();
  const activeLessons = await db.strategyNote.count({ where: { applied: true } });
  const allLessons = await db.strategyNote.count();

  return {
    running: bot.running && !runtime.halted,
    symbol: primarySymbol,
    symbols,
    interval: bot.interval,
    mode: bot.mode as "STATIC" | "DYNAMIC",
    capital: bot.capital,
    equity,
    unrealizedPnl: unrealized,
    realizedPnl: realized,
    position: {
      side: (open?.side as "LONG" | "SHORT") ?? "FLAT",
      size: open?.size ?? 0,
      entryPrice: open?.entryPrice ?? 0,
      entryAt: open?.entryAt ? open.entryAt.getTime() : null,
      markPrice,
      unrealizedPnl: unrealized,
      unrealizedPct: open ? (unrealized / (open.entryPrice * open.size)) * (open.side === "LONG" ? 1 : -1) : 0,
      symbol: open?.symbol ?? primarySymbol,
    },
    openPositions,
    openTrades: opens.length,
    totalTrades,
    winRate,
    drawdown: dd,
    lastSignal: runtime.lastSignal,
    lastError: runtime.halted ? runtime.haltReason : runtime.lastError,
    lastCycleAt: runtime.lastCycleAt,
    nextCycleAt: runtime.nextCycleAt,
    lastReflectionAt: runtime.lastReflectionAt,
    activeLessons: allLessons,
    memoryCount,
    llmProvider: bot.llmProvider || "glm",
  };
}

export function getEquityHistory() {
  return runtime.equityHistory;
}

/**
 * Backtest — replay historical klines through the same HMM pipeline.
 * Returns equity curve, trade log, and performance metrics.
 */
export interface BacktestRequest {
  symbol: string;
  interval: string;
  mode: "STATIC" | "DYNAMIC";
  bars: number; // total bars to test on
  trainingWindow: number;
  deltaPct: number;
  positionSizePct: number;
  stopLossPct: number;
  startCapital: number;
}

export interface BacktestResult {
  equityCurve: { ts: number; equity: number }[];
  trades: {
    side: "LONG" | "SHORT";
    entryPrice: number;
    exitPrice: number;
    entryTs: number;
    exitTs: number;
    pnl: number;
    pnlPct: number;
    hmmSignal: string;
  }[];
  metrics: {
    startCapital: number;
    endCapital: number;
    totalReturnPct: number;
    totalTrades: number;
    winRate: number;
    sharpe: number;
    maxDrawdown: number;
    avgTradePct: number;
  };
  mode: string;
  symbol: string;
  interval: string;
  bars: number;
}

export async function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  // Fetch enough klines for training + test.
  const total = req.bars + req.trainingWindow + 30;
  const all = await fetchKlinesRange(req.symbol, req.interval, total);

  if (all.length < req.trainingWindow + 50) {
    throw new Error(`Insufficient data: got ${all.length} bars, need ≥ ${req.trainingWindow + 50}`);
  }

  const equityCurve: { ts: number; equity: number }[] = [];
  const trades: BacktestResult["trades"] = [];
  let equity = req.startCapital;
  let peak = equity;
  let maxDd = 0;
  let model: HMMParams | null = null;
  let openTrade: {
    side: "LONG" | "SHORT";
    entryPrice: number;
    entryTs: number;
    size: number;
    hmmSignal: string;
  } | null = null;

  const trainEnd = req.trainingWindow + 30;
  const testStart = trainEnd;

  for (let i = testStart; i < all.length; i++) {
    const window = all.slice(Math.max(0, i - req.trainingWindow - 30), i + 1);
    if (window.length < req.trainingWindow) continue;

    const lastPrice = all[i].close;
    const delta = lastPrice * req.deltaPct;

    // Train HMM (DYNAMIC: each bar; STATIC: once).
    if (req.mode === "STATIC" && !model) {
      const sig = trainAndPredict(window, delta);
      if (sig) model = sig.params;
    } else if (req.mode === "DYNAMIC") {
      const sig = trainAndPredict(window, delta);
      if (sig) model = sig.params;
    }

    if (!model) continue;

    const sig = predictWithModel(window, delta, model);
    if (!sig) continue;

    const side: "LONG" | "SHORT" | "FLAT" = sig.label === "RISE" ? "LONG" : "SHORT";

    // Manage open trade.
    if (openTrade) {
      const dir = openTrade.side === "LONG" ? 1 : -1;
      const movePct = (lastPrice - openTrade.entryPrice) / openTrade.entryPrice * dir;
      let close = false;
      let reason = "SIGNAL_FLIP";
      if (movePct <= -req.stopLossPct) {
        close = true;
        reason = "STOP";
      } else if (
        (openTrade.side === "LONG" && side === "SHORT") ||
        (openTrade.side === "SHORT" && side === "LONG")
      ) {
        close = true;
      }
      if (close) {
        const pnl = dir * (lastPrice - openTrade.entryPrice) * openTrade.size;
        const pnlPct = dir * (lastPrice - openTrade.entryPrice) / openTrade.entryPrice;
        equity += pnl;
        trades.push({
          side: openTrade.side,
          entryPrice: openTrade.entryPrice,
          exitPrice: lastPrice,
          entryTs: openTrade.entryTs,
          exitTs: all[i].ts,
          pnl,
          pnlPct,
          hmmSignal: openTrade.hmmSignal,
        });
        openTrade = null;
      }
    }

    // Open new trade if flat (side is always LONG or SHORT here).
    if (!openTrade) {
      const notional = equity * req.positionSizePct;
      const size = notional / lastPrice;
      openTrade = { side, entryPrice: lastPrice, entryTs: all[i].ts, size, hmmSignal: sig.label };
    }

    // Track equity & drawdown.
    let unrealized = 0;
    if (openTrade) {
      const dir = openTrade.side === "LONG" ? 1 : -1;
      unrealized = dir * (lastPrice - openTrade.entryPrice) * openTrade.size;
    }
    const eqNow = equity + unrealized;
    equityCurve.push({ ts: all[i].ts, equity: eqNow });
    if (eqNow > peak) peak = eqNow;
    const dd = peak > 0 ? (peak - eqNow) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  // Close any remaining trade at last price.
  if (openTrade && all.length > 0) {
    const lastPrice = all[all.length - 1].close;
    const dir = openTrade.side === "LONG" ? 1 : -1;
    const pnl = dir * (lastPrice - openTrade.entryPrice) * openTrade.size;
    const pnlPct = dir * (lastPrice - openTrade.entryPrice) / openTrade.entryPrice;
    equity += pnl;
    trades.push({
      side: openTrade.side,
      entryPrice: openTrade.entryPrice,
      exitPrice: lastPrice,
      entryTs: openTrade.entryTs,
      exitTs: all[all.length - 1].ts,
      pnl,
      pnlPct,
      hmmSignal: openTrade.hmmSignal,
    });
  }

  const returns = equityCurve.slice(1).map((p, i) => {
    const prev = equityCurve[i].equity;
    return prev > 0 ? (p.equity - prev) / prev : 0;
  });
  const wins = trades.filter((t) => t.pnl > 0).length;
  const avgTradePct = trades.length > 0 ? trades.reduce((a, t) => a + t.pnlPct, 0) / trades.length : 0;

  const result: BacktestResult = {
    equityCurve,
    trades,
    metrics: {
      startCapital: req.startCapital,
      endCapital: equity,
      totalReturnPct: ((equity - req.startCapital) / req.startCapital) * 100,
      totalTrades: trades.length,
      winRate: trades.length > 0 ? wins / trades.length : 0,
      sharpe: sharpeRatio(returns),
      maxDrawdown: maxDd,
      avgTradePct: avgTradePct * 100,
    },
    mode: req.mode,
    symbol: req.symbol,
    interval: req.interval,
    bars: req.bars,
  };

  // Persist backtest summary.
  await db.backtest.create({
    data: {
      symbol: req.symbol,
      interval: req.interval,
      mode: req.mode,
      finishedAt: new Date(),
      fromTs: new Date(all[Math.max(0, testStart)].ts),
      toTs: new Date(all[all.length - 1].ts),
      startCapital: req.startCapital,
      endCapital: equity,
      totalTrades: trades.length,
      winRate: trades.length > 0 ? wins / trades.length : 0,
      sharpe: result.metrics.sharpe,
      maxDrawdown: maxDd,
      equityCurve: JSON.stringify(equityCurve.slice(-500)),
    },
  });

  return result;
}

export async function updateConfig(patch: Partial<{
  symbols: string;
  interval: string;
  mode: "STATIC" | "DYNAMIC";
  capital: number;
  positionSizePct: number;
  stopLossPct: number;
  maxDrawdownPct: number;
  leverage: number;
  trainingWindow: number;
  predictLength: number;
  deltaPct: number;
  llmEnabled: boolean;
  llmWeight: number;
  llmProvider: string;
  llmModel: string;
  reflectionInterval: number;
  memoryTopK: number;
}>) {
  return db.botState.update({ where: { id: "singleton" }, data: patch });
}

export async function getRecentTrades(limit = 50) {
  return db.trade.findMany({
    orderBy: { entryAt: "desc" },
    take: limit,
  });
}

export async function getRecentReasoning(limit = 20) {
  return db.lLMReasoning.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getLatestModel() {
  return db.hMMModel.findFirst({ orderBy: { trainedAt: "desc" } });
}

/** Re-export internals needed by API routes. */
export { fetchKlines, buildMarketDigest };
export type { Kline };
