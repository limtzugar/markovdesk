import { NextRequest, NextResponse } from "next/server";
import { fetchKlines, fetchTicker, buildMarketDigest, SUPPORTED_SYMBOLS } from "@/lib/bybit";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol") ?? "BTCUSDT";
  const interval = sp.get("interval") ?? "60";
  const view = sp.get("view") ?? "digest";

  try {
    if (view === "symbols") {
      return NextResponse.json({ symbols: SUPPORTED_SYMBOLS });
    }
    if (view === "ticker") {
      return NextResponse.json(await fetchTicker(symbol));
    }
    if (view === "klines") {
      const limit = Number(sp.get("limit") ?? 200);
      const klines = await fetchKlines(symbol, interval, limit);
      return NextResponse.json({ klines });
    }
    const digest = await buildMarketDigest(symbol, interval);
    return NextResponse.json(digest);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
