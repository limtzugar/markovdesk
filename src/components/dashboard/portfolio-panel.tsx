"use client";

import { Panel } from "./signal-panel";
import { fmtMoney, fmtPct, fmtTimeAgo } from "@/lib/hooks";

interface PortfolioEntry {
  symbol: string;
  closedTrades: number;
  openTrades: number;
  realizedPnl: number;
  winRate: number;
  avgPnlPct: number;
  lastTradeAt: number | null;
}

interface PortfolioData {
  symbols: string[];
  capital: number;
  perSymbol: PortfolioEntry[];
  totals: {
    closedTrades: number;
    openTrades: number;
    realizedPnl: number;
    winRate: number;
    memoryCount: number;
    lessonsCount: number;
    reflectionsCount: number;
  };
}

export function PortfolioPanel({ data, flat = false }: { data: PortfolioData | null; flat?: boolean }) {
  if (!data) {
    return (
      <Panel flat={flat}>
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">Loading portfolio…</div>
      </Panel>
    );
  }

  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Portfolio · {data.symbols.length} symbols
        </span>
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>{data.totals.memoryCount} memories</span>
          <span>·</span>
          <span>{data.totals.lessonsCount} lessons</span>
          <span>·</span>
          <span>{data.totals.reflectionsCount} reflections</span>
        </div>
      </div>

      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-5 py-2 text-left font-normal">Symbol</th>
              <th className="px-3 py-2 text-right font-normal">Closed</th>
              <th className="px-3 py-2 text-right font-normal">Open</th>
              <th className="px-3 py-2 text-right font-normal">Realized</th>
              <th className="px-3 py-2 text-right font-normal">Win</th>
              <th className="px-3 py-2 text-right font-normal">Avg/trade</th>
              <th className="px-5 py-2 text-right font-normal">Last</th>
            </tr>
          </thead>
          <tbody>
            {data.perSymbol.map((s) => (
              <tr key={s.symbol} className="border-t border-border/60 hover:bg-muted/40">
                <td className="px-5 py-2.5 font-mono text-xs">{s.symbol}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{s.closedTrades}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {s.openTrades > 0 ? <span className="text-foreground">{s.openTrades}</span> : "—"}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${s.realizedPnl >= 0 ? "text-long" : "text-short"}`}>
                  {fmtMoney(s.realizedPnl)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {s.closedTrades > 0 ? `${(s.winRate * 100).toFixed(0)}%` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {s.closedTrades > 0 ? fmtPct(s.avgPnlPct * 100) : "—"}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-[10px] text-muted-foreground">
                  {fmtTimeAgo(s.lastTradeAt)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border bg-muted/30">
              <td className="px-5 py-2.5 font-mono text-xs font-medium">TOTAL</td>
              <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{data.totals.closedTrades}</td>
              <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{data.totals.openTrades}</td>
              <td className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums font-medium ${data.totals.realizedPnl >= 0 ? "text-long" : "text-short"}`}>
                {fmtMoney(data.totals.realizedPnl)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                {data.totals.closedTrades > 0 ? `${(data.totals.winRate * 100).toFixed(0)}%` : "—"}
              </td>
              <td className="px-5 py-2.5 text-right font-mono text-xs text-muted-foreground" colSpan={2}>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
