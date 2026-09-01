"use client";

import { Area, Bar, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMoney, fmtPct } from "@/lib/hooks";
import { Panel } from "./signal-panel";

interface PnlTrade {
  i: number;
  side: string;
  entryPrice: number;
  exitPrice: number;
  entryAt: number;
  exitAt: number;
  pnl: number;
  pnlPct: number;
  cumulative: number;
  equity: number;
}

/**
 * Hardcoded dark-theme palette matching globals.css. Using concrete hex
 * values instead of var() refs because recharts/SVG <stroke>/<fill> need
 * actual color values to render reliably, especially in headless browsers.
 */
const COLORS = {
  long: "#34d399",
  short: "#f87171",
  muted: "#9ca3af",
  border: "#3f3f46",
  card: "#1a1a1d",
  fg: "#fafafa",
};

export function PnlCurve({ trades, capital, flat = false }: { trades: PnlTrade[]; capital: number; flat?: boolean }) {
  const c = COLORS;
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const positive = total >= 0;
  const lineColor = positive ? c.long : c.short;

  const data = trades.map((t) => ({
    i: t.i + 1,
    pnl: t.pnl,
    cumulative: t.cumulative,
    equity: t.equity,
    side: t.side,
  }));

  const gradId = `pnlGrad-${positive ? "up" : "down"}`;

  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">PnL curve</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {trades.length} closed trades · capital ${capital.toLocaleString("en-US")}
          </span>
        </div>
        <div className="text-right">
          <div className={`font-mono text-sm tabular-nums ${positive ? "text-long" : "text-short"}`}>
            {fmtMoney(total)}
          </div>
          <div className={`font-mono text-[10px] ${positive ? "text-long" : "text-short"}`}>
            {fmtPct((total / capital) * 100)}
          </div>
        </div>
      </div>

      <div className="px-2 py-3" style={{ height: 260 }}>
        {trades.length < 2 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
            <div>
              <div className="font-display text-2xl text-foreground">Awaiting trades</div>
              <div className="mt-1 font-mono text-[11px]">
                PnL curve will appear after the first 2 closed trades.
              </div>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.45} />
                  <stop offset="50%" stopColor={lineColor} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="i"
                tick={{ fontSize: 10, fill: c.muted, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={{ stroke: c.border }}
                label={{ value: "trade #", position: "insideBottom", offset: -2, style: { fontSize: 9, fill: c.muted, fontFamily: "var(--font-mono)" } }}
              />
              <YAxis
                orientation="right"
                tick={{ fontSize: 10, fill: c.muted, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: c.card,
                  border: `1px solid ${c.border}`,
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                labelStyle={{ color: c.muted }}
                labelFormatter={(v) => `Trade #${v}`}
                formatter={(value: any, name: any) => {
                  if (name === "cumulative") return [fmtMoney(Number(value)), "Cumulative"];
                  if (name === "pnl") return [fmtMoney(Number(value)), "Trade PnL"];
                  return [value, name];
                }}
              />
              <ReferenceLine y={0} stroke={c.muted} strokeDasharray="3 3" strokeWidth={1} opacity={0.6} />
              <Bar
                dataKey="pnl"
                fill={c.fg}
                opacity={0.22}
                isAnimationActive={false}
                radius={[2, 2, 0, 0]}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke={lineColor}
                strokeWidth={3}
                fill={`url(#${gradId})`}
                isAnimationActive={false}
                dot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: c.card, fill: lineColor }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}
