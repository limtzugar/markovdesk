import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const bot = await db.botState.findUnique({ where: { id: "singleton" } });
  return NextResponse.json({
    deltaPct: bot?.deltaPct ?? 0.0015,
    interval: bot?.interval ?? "60",
    symbol: (bot?.symbols ?? "BTCUSDT").split(",")[0].trim(),
  });
}
