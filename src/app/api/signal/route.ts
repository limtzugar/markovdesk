import { NextRequest, NextResponse } from "next/server";
import { fetchKlines, buildMarketDigest } from "@/lib/bybit";
import { trainAndPredict, type HMMSignal } from "@/lib/hmm";
import { generateLLMDecision, type LLMDecision } from "@/lib/llm";
import { getActiveLessons } from "@/lib/reflection";
import { db } from "@/lib/db";
import type { Provider } from "@/lib/llm-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let bot = await db.botState.findUnique({ where: { id: "singleton" } });
  if (!bot) {
    try {
      bot = await db.botState.create({ data: { id: "singleton" } });
    } catch {
      bot = await db.botState.findUnique({ where: { id: "singleton" } });
    }
  }
  if (!bot) return NextResponse.json({ error: "Bot state unavailable" }, { status: 500 });

  // Allow per-request symbol override (for multi-symbol preview).
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol") ?? (bot.symbols?.split(",")[0] ?? "BTCUSDT").trim();

  try {
    const klines = await fetchKlines(symbol, bot.interval, Math.max(bot.trainingWindow + 20, 220));
    if (klines.length < 50) {
      return NextResponse.json({ error: "Not enough klines" }, { status: 400 });
    }
    const lastPrice = klines[klines.length - 1].close;
    const delta = lastPrice * bot.deltaPct;

    const hmm: HMMSignal | null = trainAndPredict(klines, delta);
    if (!hmm) return NextResponse.json({ error: "HMM training failed" }, { status: 500 });

    const digest = await buildMarketDigest(symbol, bot.interval, klines);
    const lessons = bot.llmEnabled ? await getActiveLessons(symbol) : [];
    const llm: LLMDecision = await generateLLMDecision(hmm, digest, {
      provider: (bot.llmProvider || "glm") as Provider,
      model: bot.llmModel || undefined,
      reasoning: bot.llmProvider === "deepseek",
      useSearch: bot.llmEnabled,
      llmWeight: bot.llmWeight,
      memoryTopK: bot.memoryTopK ?? 5,
      lessons,
    });

    return NextResponse.json({
      ts: Date.now(),
      symbol,
      interval: bot.interval,
      mode: bot.mode,
      price: lastPrice,
      hmm: {
        label: hmm.label,
        probability: hmm.probability,
        logLikelihood: hmm.logLikelihood,
        iterations: hmm.iterations,
        converged: hmm.converged,
        obsLabel: hmm.obsLabel,
      },
      llm: {
        action: llm.action,
        confidence: llm.confidence,
        reasoning: llm.reasoning,
        marketSummary: llm.marketSummary,
        finalSide: llm.finalSide,
        latencyMs: llm.latencyMs,
        usedSearch: llm.usedSearch,
        usedMemory: llm.usedMemory,
        memoryMatches: llm.memoryMatches,
        lessonsApplied: llm.lessonsApplied,
        provider: llm.provider,
        model: llm.model,
        newsDigest: llm.newsDigest.slice(0, 1200),
      },
      digest: {
        pct24h: digest.pct24h,
        rsi14: digest.rsi14,
        atr14: digest.atr14,
        shortMA: digest.shortMA,
        longMA: digest.longMA,
        fundingRate: digest.fundingRate,
        high24h: digest.high24h,
        low24h: digest.low24h,
        vol24h: digest.vol24h,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
