import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol");
  const limit = Number(sp.get("limit") ?? 30);

  const notes = await db.strategyNote.findMany({
    where: symbol ? { OR: [{ symbol }, { symbol: null }] } : {},
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json({
    count: notes.length,
    lessons: notes.map((n) => ({
      id: n.id,
      createdAt: n.createdAt.getTime(),
      symbol: n.symbol,
      category: n.category,
      severity: n.severity,
      lesson: n.lesson,
      suggestedAction: n.suggestedAction,
      confidence: n.confidence,
      applied: n.applied,
      confirmations: n.confirmations,
      refutations: n.refutations,
      strategyVersion: n.strategyVersion,
      evidence: n.evidence ? safeParse(n.evidence, []) : [],
    })),
  });
}

/** Mark a lesson as applied / dismissed. */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, applied, confirmations, refutations } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const note = await db.strategyNote.update({
    where: { id },
    data: {
      ...(applied !== undefined ? { applied } : {}),
      ...(confirmations !== undefined ? { confirmations } : {}),
      ...(refutations !== undefined ? { refutations } : {}),
    },
  });
  return NextResponse.json({ ok: true, note });
}

function safeParse(s: string | null, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
