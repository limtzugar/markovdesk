"use client";

import { motion } from "framer-motion";
import { fmtMoney } from "@/lib/hooks";
import { Panel } from "./signal-panel";

interface DayEntry {
  day: string; // YYYY-MM-DD
  pnl: number;
  trades: number;
  wins: number;
}

interface CalendarProps {
  daily: DayEntry[];
  summary: {
    totalPnl: number;
    totalTrades: number;
    winRate: number;
    bestDay: { day: string; pnl: number; trades: number; wins: number } | null;
    worstDay: { day: string; pnl: number; trades: number; wins: number } | null;
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PnLCalendar({ daily, summary, flat = false }: CalendarProps & { flat?: boolean }) {
  // Build a 6-week grid (42 days) aligned to Monday-start weeks.
  // daily is sorted ascending by day.
  const cells: (DayEntry | null)[] = [];
  if (daily.length > 0) {
    const first = new Date(daily[0].day + "T00:00:00Z");
    // JS getDay: 0=Sun, 1=Mon ... 6=Sat. We want Monday=0.
    const firstDow = (first.getUTCDay() + 6) % 7;
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (const d of daily) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
  }

  // Find max abs pnl for color scaling.
  const maxAbs = Math.max(1, ...daily.map((d) => Math.abs(d.pnl)));

  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Daily PnL · last 6 weeks
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {summary.totalTrades} trades · {(summary.winRate * 100).toFixed(0)}% win
        </span>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-px border-b border-border bg-border">
        <Summary label="Total PnL" value={fmtMoney(summary.totalPnl)} tone={summary.totalPnl >= 0 ? "long" : "short"} />
        <Summary
          label="Best day"
          value={summary.bestDay ? fmtMoney(summary.bestDay.pnl) : "—"}
          tone={summary.bestDay && summary.bestDay.pnl > 0 ? "long" : "neutral"}
          sub={summary.bestDay ? fmtDayShort(summary.bestDay.day) : ""}
        />
        <Summary
          label="Worst day"
          value={summary.worstDay ? fmtMoney(summary.worstDay.pnl) : "—"}
          tone={summary.worstDay && summary.worstDay.pnl < 0 ? "short" : "neutral"}
          sub={summary.worstDay ? fmtDayShort(summary.worstDay.day) : ""}
        />
        <Summary label="Win rate" value={`${(summary.winRate * 100).toFixed(0)}%`} tone="neutral" />
      </div>

      {/* Calendar grid */}
      <div className="px-5 py-4">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {w}
            </div>
          ))}
          {cells.map((cell, idx) => {
            if (!cell) return <div key={idx} className="aspect-square rounded-sm bg-transparent" />;
            const intensity = Math.min(1, Math.abs(cell.pnl) / maxAbs);
            const positive = cell.pnl >= 0;
            const bg =
              cell.trades === 0
                ? "var(--muted)"
                : positive
                ? `oklch(from var(--long) calc(l + ${(1 - intensity) * 0.3}) c h / ${0.25 + intensity * 0.55})`
                : `oklch(from var(--short) calc(l + ${(1 - intensity) * 0.3}) c h / ${0.25 + intensity * 0.55})`;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, delay: Math.min(idx * 0.005, 0.2) }}
                whileHover={{ scale: 1.08 }}
                className="group relative aspect-square rounded-sm"
                style={{ background: bg }}
                title={`${fmtDay(cell.day)} · ${fmtMoney(cell.pnl)} · ${cell.trades} trades`}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center p-1 text-center">
                  <div className="font-mono text-[9px] leading-none text-foreground/80">
                    {new Date(cell.day + "T00:00:00Z").getUTCDate()}
                  </div>
                  {cell.trades > 0 && (
                    <div
                      className={`mt-0.5 font-mono text-[8px] leading-none ${
                        positive ? "text-long" : "text-short"
                      }`}
                    >
                      {cell.pnl > 0 ? "+" : ""}
                      {Math.abs(cell.pnl) < 1 ? cell.pnl.toFixed(2) : cell.pnl.toFixed(0)}
                    </div>
                  )}
                </div>
                {/* Tooltip on hover */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-mono shadow-lg group-hover:block">
                  <div className="text-foreground">{fmtDay(cell.day)}</div>
                  <div className={positive ? "text-long" : "text-short"}>{fmtMoney(cell.pnl)}</div>
                  <div className="text-muted-foreground">{cell.trades} trades · {cell.wins} wins</div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-end gap-3 font-mono text-[9px] text-muted-foreground">
          <span>Loss</span>
          <div className="flex h-2.5 w-20 overflow-hidden rounded-sm">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex-1"
                style={{ background: `oklch(from var(--short) calc(l + ${(7 - i) * 0.04}) c h / ${0.3 + (i + 1) * 0.07})` }}
              />
            ))}
          </div>
          <div className="h-2.5 w-2 rounded-sm" style={{ background: "var(--muted)" }} />
          <div className="flex h-2.5 w-20 overflow-hidden rounded-sm">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex-1"
                style={{ background: `oklch(from var(--long) calc(l + ${(7 - i) * 0.04}) c h / ${0.3 + (i + 1) * 0.07})` }}
              />
            ))}
          </div>
          <span>Profit</span>
        </div>
      </div>
    </Panel>
  );
}

function Summary({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "long" | "short" | "neutral";
  sub?: string;
}) {
  const color = tone === "long" ? "text-long" : tone === "short" ? "text-short" : "text-foreground";
  return (
    <div className="bg-background px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-sm tabular-nums ${color}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function fmtDay(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}
function fmtDayShort(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
