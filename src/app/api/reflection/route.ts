import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runReflection } from "@/lib/reflection";

export const runtime = "nodejs";
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 10);
  const reflections = await db.reflection.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({
    count: reflections.length,
    reflections: reflections.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.getTime(),
      symbol: r.symbol,
      tradesReviewed: r.tradesReviewed,
      winsReviewed: r.winsReviewed,
      lossesReviewed: r.lossesReviewed,
      netPnl: r.netPnl,
      summary: r.summary,
      lessonsGenerated: r.lessonsGenerated,
      notesJson: r.notesJson ? JSON.parse(r.notesJson) : [],
    })),
  });
}

/** Manually trigger a reflection run. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const bot = await db.botState.findUnique({ where: { id: "singleton" } });
    const symbol = body.symbol ?? null;
    const result = await runReflection({
      symbol,
      provider: (bot?.llmProvider || "glm") as any,
      model: bot?.llmModel || undefined,
      reasoning: bot?.llmProvider === "deepseek",
      windowSize: body.windowSize ?? 20,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
