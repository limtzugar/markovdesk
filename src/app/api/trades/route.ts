import { NextRequest, NextResponse } from "next/server";
import { getRecentTrades } from "@/lib/strategy";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const trades = await getRecentTrades(limit);
  return NextResponse.json({ trades });
}
