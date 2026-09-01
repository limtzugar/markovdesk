"use client";

import { Panel } from "./signal-panel";
import { fmtPct } from "@/lib/hooks";

interface MarketDigest {
  symbol: string;
  interval: string;
  lastPrice: number;
  pct24h: number;
  high24h: number;
  low24h: number;
  vol24h: number;
  fundingRate: number;
  shortMA: number;
  longMA: number;
  rsi14: number;
  atr14: number;
}

export function MarketDigest({ digest, flat = false }: { digest: MarketDigest | null; flat?: boolean }) {
  if (!digest) {
    return (
      <Panel flat={flat}>
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">Loading market data…</div>
      </Panel>
    );
  }
  const atrPct = digest.lastPrice > 0 ? (digest.atr14 / digest.lastPrice) * 100 : 0;
  const trendUp = digest.shortMA > digest.longMA;

  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {digest.symbol} · {digest.interval}m
        </span>
        <span className={`font-mono text-xs ${digest.pct24h >= 0 ? "text-long" : "text-short"}`}>
          {fmtPct(digest.pct24h)} 24h
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="font-display text-4xl tracking-tight">
          ${digest.lastPrice.toLocaleString("en-US", { maximumFractionDigits: digest.lastPrice > 100 ? 2 : 4 })}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          Hi ${digest.high24h.toLocaleString("en-US", { maximumFractionDigits: 2 })} · Lo ${digest.low24h.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
        <Cell label="MA(10)" value={`$${digest.shortMA.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} tone={trendUp ? "long" : "short"} />
        <Cell label="MA(50)" value={`$${digest.longMA.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} tone={trendUp ? "long" : "short"} />
        <Cell label="RSI(14)" value={digest.rsi14.toFixed(1)} tone={digest.rsi14 > 70 ? "short" : digest.rsi14 < 30 ? "long" : "neutral"} />
        <Cell label="ATR(14)" value={`${digest.atr14.toFixed(2)} (${atrPct.toFixed(2)}%)`} />
        <Cell label="Funding" value={`${digest.fundingRate.toFixed(4)}%`} tone={digest.fundingRate > 0.01 ? "short" : digest.fundingRate < -0.01 ? "long" : "neutral"} />
        <Cell label="Vol 24h" value={digest.vol24h.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
      </div>
    </Panel>
  );
}

function Cell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "long" | "short" | "neutral";
}) {
  const color = tone === "long" ? "text-long" : tone === "short" ? "text-short" : "text-foreground";
  return (
    <div className="bg-background px-5 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-sm tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
