import { NextRequest, NextResponse } from "next/server";
import { getRecentReasoning } from "@/lib/strategy";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const items = await getRecentReasoning(limit);
  return NextResponse.json({ items });
}
