"use client";

import { fmtMoney, fmtPct, fmtTimeAgo } from "@/lib/hooks";
import { Panel } from "./signal-panel";

interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  exitPrice: number | null;
  entryAt: string;
  exitAt: string | null;
  status: string;
  pnl: number | null;
  pnlPct: number | null;
  hmmSignal: string;
  llmAction: string | null;
  reason: string | null;
  closedReason: string | null;
}

export function TradesTable({ trades, flat = false }: { trades: TradeRow[]; flat?: boolean }) {
  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Trade log</span>
        <span className="font-mono text-[10px] text-muted-foreground">{trades.length} entries</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto scroll-thin">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-5 py-2 text-left font-normal">Side</th>
              <th className="px-3 py-2 text-right font-normal">Entry</th>
              <th className="px-3 py-2 text-right font-normal">Exit</th>
              <th className="px-3 py-2 text-right font-normal">PnL</th>
              <th className="px-3 py-2 text-right font-normal">%</th>
              <th className="px-3 py-2 text-left font-normal">HMM</th>
              <th className="px-3 py-2 text-left font-normal">LLM</th>
              <th className="px-3 py-2 text-left font-normal">When</th>
              <th className="px-5 py-2 text-left font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-xs text-muted-foreground">
                  No trades yet — start the bot or run a backtest.
                </td>
              </tr>
            )}
            {trades.map((t) => {
              const closed = t.status === "CLOSED";
              const pnl = t.pnl ?? 0;
              const positive = pnl > 0;
              return (
                <tr key={t.id} className="border-t border-border/60 hover:bg-muted/40">
                  <td className="px-5 py-2.5">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        t.side === "LONG" ? "bg-long/15 text-long" : "bg-short/15 text-short"
                      }`}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                    {t.entryPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                    {t.exitPrice ? t.exitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${
                      !closed ? "text-muted-foreground" : positive ? "text-long" : "text-short"
                    }`}
                  >
                    {closed ? fmtMoney(pnl) : "—"}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${
                      !closed ? "text-muted-foreground" : positive ? "text-long" : "text-short"
                    }`}
                  >
                    {closed ? fmtPct((t.pnlPct ?? 0) * 100) : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{t.hmmSignal}</td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{t.llmAction ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                    {fmtTimeAgo(new Date(t.entryAt).getTime())}
                  </td>
                  <td className="px-5 py-2.5">
                    <span
                      className={`font-mono text-[10px] ${
                        t.status === "OPEN"
                          ? "text-foreground"
                          : t.closedReason === "STOP"
                          ? "text-short"
                          : "text-muted-foreground"
                      }`}
                    >
                      {t.status === "OPEN" ? "OPEN" : t.closedReason ?? t.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
