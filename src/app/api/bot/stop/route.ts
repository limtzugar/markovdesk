import { NextResponse } from "next/server";
import { stopBot } from "@/lib/strategy";

export async function POST() {
  const ok = await stopBot();
  return NextResponse.json({ ok });
}
