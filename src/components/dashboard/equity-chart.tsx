"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface EquityPoint {
  ts: number;
  equity: number;
}

/**
 * Hardcoded dark-theme palette matching globals.css. Using concrete hex
 * values instead of var() refs because recharts/SVG <stroke>/<fill> need
 * actual color values to render reliably, especially in headless browsers.
 */
const COLORS = {
  long: "#34d399",    // oklch(0.78 0.13 165) approx — mint
  short: "#f87171",   // oklch(0.7 0.19 22) approx — coral
  muted: "#9ca3af",   // muted-foreground in dark
  border: "#3f3f46",  // border in dark
  card: "#1a1a1d",    // card in dark
};

export function EquityChart({
  data,
  height = 220,
  startCapital,
  showBaseline = true,
}: {
  data: EquityPoint[];
  height?: number;
  startCapital?: number;
  showBaseline?: boolean;
}) {
  const c = COLORS;
  const chartData = data.map((p) => ({
    time: new Date(p.ts).toLocaleString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }),
    equity: p.equity,
  }));
  const start = startCapital ?? data[0]?.equity ?? 0;
  const last = data[data.length - 1]?.equity ?? 0;
  const positive = last >= start;
  const lineColor = positive ? c.long : c.short;

  const values = data.map((d) => d.equity);
  const min = Math.min(...values, start);
  const max = Math.max(...values, start);
  const pad = (max - min) * 0.15 || Math.abs(start) * 0.02 || 1;

  // Unique gradient id per instance to avoid collisions when multiple charts
  // share the page.
  const gradId = `eqGrad-${positive ? "up" : "down"}-${height}`;

  return (
    <div className="w-full" style={{ height }}>
      {data.length < 2 ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          No equity history yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 12, right: 20, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.45} />
                <stop offset="50%" stopColor={lineColor} stopOpacity={0.15} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: c.muted, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={{ stroke: c.border }}
              minTickGap={60}
            />
            <YAxis
              orientation="right"
              tick={{ fontSize: 10, fill: c.muted, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              domain={[min - pad, max + pad]}
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
              formatter={(v: any) => [`$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`, "Equity"]}
            />
            {showBaseline && start > 0 && (
              <ReferenceLine
                y={start}
                stroke={c.muted}
                strokeDasharray="4 4"
                strokeWidth={1}
                opacity={0.6}
                label={{
                  value: `start $${start.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                  position: "insideLeft",
                  offset: 8,
                  style: { fontSize: 9, fill: c.muted, fontFamily: "var(--font-mono)" },
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="equity"
              stroke={lineColor}
              strokeWidth={3}
              fill={`url(#${gradId})`}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: c.card, fill: lineColor }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
