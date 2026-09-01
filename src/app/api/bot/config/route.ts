import { NextRequest, NextResponse } from "next/server";
import { updateConfig } from "@/lib/strategy";

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const allowed: Record<string, string> = {
    symbols: "string",
    interval: "string",
    mode: "string",
    capital: "number",
    positionSizePct: "number",
    stopLossPct: "number",
    maxDrawdownPct: "number",
    leverage: "number",
    trainingWindow: "number",
    predictLength: "number",
    deltaPct: "number",
    llmEnabled: "boolean",
    llmWeight: "number",
    llmProvider: "string",
    llmModel: "string",
    reflectionInterval: "number",
    memoryTopK: "number",
  };
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in allowed)) continue;
    const t = allowed[k];
    if (t === "number") patch[k] = Number(v);
    else if (t === "boolean") patch[k] = Boolean(v);
    else patch[k] = String(v);
  }
  const updated = await updateConfig(patch as any);
  return NextResponse.json({ ok: true, state: updated });
}

export async function GET() {
  const { db } = await import("@/lib/db");
  let b = await db.botState.findUnique({ where: { id: "singleton" } });
  if (!b) {
    try {
      b = await db.botState.create({ data: { id: "singleton" } });
    } catch {
      b = await db.botState.findUnique({ where: { id: "singleton" } });
    }
  }
  return NextResponse.json(b);
}
