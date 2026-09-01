import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol");
  const outcome = sp.get("outcome"); // WIN | LOSS | BREAKEVEN
  const limit = Number(sp.get("limit") ?? 50);

  const memories = await db.tradeMemory.findMany({
    where: {
      ...(symbol ? { symbol } : {}),
      ...(outcome ? { outcome } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    count: memories.length,
    memories: memories.map((m) => ({
      id: m.id,
      tradeId: m.tradeId,
      symbol: m.symbol,
      side: m.side,
      entryAt: m.entryAt.getTime(),
      exitAt: m.exitAt.getTime(),
      pnl: m.pnl,
      pnlPct: m.pnlPct,
      outcome: m.outcome,
      closedReason: m.closedReason,
      digest: m.digest,
      tags: safeParse(m.tags, []),
      signature: safeParse(m.signature, []),
    })),
  });
}

function safeParse(s: string | null, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
