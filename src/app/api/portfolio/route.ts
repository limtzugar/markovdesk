import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Portfolio overview — per-symbol breakdown of trades, PnL, win rate. */
export async function GET() {
  const bot = await db.botState.findUnique({ where: { id: "singleton" } });
  const symbols = (bot?.symbols ?? "BTCUSDT").split(",").map((s) => s.trim()).filter(Boolean);

  const trades = await db.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { exitAt: "desc" },
  });
  const opens = await db.trade.findMany({ where: { status: "OPEN" } });

  const perSymbol = symbols.map((sym) => {
    const closed = trades.filter((t) => t.symbol === sym);
    const open = opens.filter((t) => t.symbol === sym);
    const pnl = closed.reduce((a, t) => a + (t.pnl ?? 0), 0);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    return {
      symbol: sym,
      closedTrades: closed.length,
      openTrades: open.length,
      realizedPnl: pnl,
      winRate: closed.length > 0 ? wins / closed.length : 0,
      avgPnlPct: closed.length > 0 ? closed.reduce((a, t) => a + (t.pnlPct ?? 0), 0) / closed.length : 0,
      lastTradeAt: closed[0]?.exitAt?.getTime() ?? null,
    };
  });

  const totalRealized = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const totalWins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
  const memoryCount = await db.tradeMemory.count();
  const lessonsCount = await db.strategyNote.count();
  const reflectionsCount = await db.reflection.count();

  return NextResponse.json({
    symbols,
    capital: bot?.capital ?? 1000,
    perSymbol,
    totals: {
      closedTrades: trades.length,
      openTrades: opens.length,
      realizedPnl: totalRealized,
      winRate: trades.length > 0 ? totalWins / trades.length : 0,
      memoryCount,
      lessonsCount,
      reflectionsCount,
    },
  });
}
