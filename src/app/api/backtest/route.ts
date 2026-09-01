import { NextRequest, NextResponse } from "next/server";
import { runBacktest, type BacktestRequest } from "@/lib/strategy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const r: BacktestRequest = {
      symbol: String(body.symbol ?? "BTCUSDT"),
      interval: String(body.interval ?? "60"),
      mode: body.mode === "STATIC" ? "STATIC" : "DYNAMIC",
      bars: Number(body.bars ?? 300),
      trainingWindow: Number(body.trainingWindow ?? 200),
      deltaPct: Number(body.deltaPct ?? 0.0015),
      positionSizePct: Number(body.positionSizePct ?? 0.1),
      stopLossPct: Number(body.stopLossPct ?? 0.03),
      startCapital: Number(body.startCapital ?? 10000),
    };
    const result = await runBacktest(r);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
