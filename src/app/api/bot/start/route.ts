import { NextResponse } from "next/server";
import { startBot } from "@/lib/strategy";

export async function POST() {
  const ok = await startBot();
  return NextResponse.json({ ok });
}
