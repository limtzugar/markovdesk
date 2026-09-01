"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleChartProps {
  candles: Candle[];
  signal?: { price: number; side: "LONG" | "SHORT" | "FLAT" } | null;
  height?: number;
}

export function CandleChart({ candles, signal, height = 280 }: CandleChartProps) {
  const data = useMemo(() => {
    return candles.map((c) => ({
      ts: c.ts,
      time: new Date(c.ts).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
      open: c.open,
      close: c.close,
      high: c.high,
      low: c.low,
      // Wick range for the area
      wickHi: c.high,
      wickLo: c.low,
      // Body for the bar (we draw as a filled range)
      bodyHi: Math.max(c.open, c.close),
      bodyLo: Math.min(c.open, c.close),
      up: c.close >= c.open,
      volume: c.volume,
    }));
  }, [candles]);

  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const padding = (max - min) * 0.08;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={50}
          />
          <YAxis
            domain={[min - padding, max + padding]}
            orientation="right"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(value: any, name: any) => {
              if (name === "close") return [Number(value).toLocaleString("en-US"), "Close"];
              return [value, name];
            }}
          />
          {/* Wick range */}
          <Area
            type="monotone"
            dataKey="wickHi"
            stroke="none"
            fill="none"
            isAnimationActive={false}
          />
          {/* Body as a line for visual simplicity — closing price line */}
          <Line
            type="monotone"
            dataKey="close"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          {/* High / low subtle band */}
          <Area
            type="monotone"
            dataKey="high"
            stroke="var(--border)"
            strokeWidth={0.5}
            fill="none"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="low"
            stroke="var(--border)"
            strokeWidth={0.5}
            fill="var(--background)"
            isAnimationActive={false}
          />
          {signal && signal.price > 0 && (
            <ReferenceLine
              y={signal.price}
              stroke={signal.side === "LONG" ? "var(--long)" : signal.side === "SHORT" ? "var(--short)" : "var(--muted-foreground)"}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          )}
          {lastPrice > 0 && (
            <ReferenceLine
              y={lastPrice}
              stroke="var(--foreground)"
              strokeDasharray="1 0"
              strokeWidth={0.5}
              opacity={0.3}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
