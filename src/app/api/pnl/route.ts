import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Returns two views:
 *   - trades: cumulative PnL per closed trade (chronological)
 *   - daily:  PnL aggregated per calendar day (UTC)
 *
 * Both views drive the PnL Curve and Calendar components.
 */
export async function GET() {
  const bot = await db.botState.findUnique({ where: { id: "singleton" } });
  const capital = bot?.capital ?? 1000;

  // Only closed trades count toward realized PnL.
  const closed = await db.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { exitAt: "asc" },
  });

  let running = 0;
  const trades = closed.map((t, i) => {
    running += t.pnl ?? 0;
    return {
      i,
      id: t.id,
      side: t.side,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice ?? t.entryPrice,
      entryAt: t.entryAt.getTime(),
      exitAt: t.exitAt ? t.exitAt.getTime() : t.entryAt.getTime(),
      pnl: t.pnl ?? 0,
      pnlPct: t.pnlPct ?? 0,
      cumulative: running,
      equity: capital + running,
    };
  });

  // Aggregate by day (UTC date string YYYY-MM-DD).
  const byDay = new Map<string, { day: string; pnl: number; trades: number; wins: number }>();
  for (const t of trades) {
    const d = new Date(t.exitAt);
    const day = d.toISOString().slice(0, 10);
    const cur = byDay.get(day) ?? { day, pnl: 0, trades: 0, wins: 0 };
    cur.pnl += t.pnl;
    cur.trades += 1;
    if (t.pnl > 0) cur.wins += 1;
    byDay.set(day, cur);
  }

  // Build a contiguous calendar of the last 42 days (6 weeks) ending today.
  const daily: { day: string; pnl: number; trades: number; wins: number }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 41; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const day = d.toISOString().slice(0, 10);
    const entry = byDay.get(day);
    daily.push(entry ?? { day, pnl: 0, trades: 0, wins: 0 });
  }

  // Stats summary.
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  const bestDay = daily.reduce(
    (best, d) => (d.pnl > best.pnl ? d : best),
    { day: "—", pnl: -Infinity, trades: 0, wins: 0 }
  );
  const worstDay = daily.reduce(
    (worst, d) => (d.pnl < worst.pnl ? d : worst),
    { day: "—", pnl: Infinity, trades: 0, wins: 0 }
  );

  return NextResponse.json({
    capital,
    trades,
    daily,
    summary: {
      totalTrades: trades.length,
      wins,
      losses,
      winRate,
      totalPnl,
      totalPct: capital > 0 ? (totalPnl / capital) * 100 : 0,
      bestDay: bestDay.day === "—" ? null : bestDay,
      worstDay: worstDay.day === "—" ? null : worstDay,
      currentEquity: capital + totalPnl,
    },
  });
}
