import { NextResponse } from "next/server";
import { getLatestModel } from "@/lib/strategy";

export async function GET() {
  const m = await getLatestModel();
  if (!m) return NextResponse.json({ model: null });
  return NextResponse.json({
    model: {
      id: m.id,
      symbol: m.symbol,
      interval: m.interval,
      mode: m.mode,
      trainedAt: m.trainedAt,
      transition: JSON.parse(m.transition),
      emission: JSON.parse(m.emission),
      pi: JSON.parse(m.pi),
      logLikelihood: m.logLikelihood,
      trainingSize: m.trainingSize,
    },
  });
}
