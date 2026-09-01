import { NextResponse } from "next/server";
import { snapshot, getEquityHistory } from "@/lib/strategy";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await snapshot();
  return NextResponse.json({ ...snap, equityHistory: getEquityHistory() });
}
