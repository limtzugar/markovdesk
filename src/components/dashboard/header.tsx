"use client";

import { motion } from "framer-motion";
import { Activity, Square, Play } from "lucide-react";
import { fmtTime } from "@/lib/hooks";

interface HeaderProps {
  running: boolean;
  symbol: string;
  interval: string;
  mode: string;
  lastCycleAt: number | null;
  onStart: () => void;
  onStop: () => void;
  onSymbol: (s: string) => void;
  onInterval: (s: string) => void;
  onMode: (s: "STATIC" | "DYNAMIC") => void;
  symbols: { symbol: string; label: string }[];
  intervals: { value: string; label: string }[];
}

export function DashboardHeader({
  running,
  symbol,
  interval,
  mode,
  lastCycleAt,
  onStart,
  onStop,
  onSymbol,
  onInterval,
  onMode,
  symbols,
  intervals,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto max-w-[1400px] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-background">
              <span className="font-display text-xl leading-none">M</span>
            </div>
            <div className="leading-tight">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-xl tracking-tight">Markov Desk</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  HMM × LLM
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Bybit paper trading · Andersson & Fransson (2016)
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentSelect
              value={symbol}
              options={symbols.map((s) => ({ value: s.symbol, label: s.symbol.replace("USDT", "") }))}
              onChange={onSymbol}
              disabled={running}
            />
            <SegmentSelect
              value={interval}
              options={intervals}
              onChange={onInterval}
              disabled={running}
            />
            <SegmentSelect
              value={mode}
              options={[
                { value: "STATIC", label: "Static" },
                { value: "DYNAMIC", label: "Dynamic" },
              ]}
              onChange={(v) => onMode(v as "STATIC" | "DYNAMIC")}
              disabled={running}
            />

            <div className="ml-2 hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 sm:flex">
              <div className={`h-1.5 w-1.5 rounded-full ${running ? "bg-long pulse-dot" : "bg-muted-foreground"}`} />
              <span className="font-mono text-xs text-muted-foreground">
                {running ? "LIVE" : "IDLE"}
              </span>
              {running && lastCycleAt && (
                <span className="text-[10px] text-muted-foreground">· {fmtTime(lastCycleAt)}</span>
              )}
            </div>

            {running ? (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onStop}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-90"
              >
                <Square className="h-3.5 w-3.5" /> Stop
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onStart}
                className="inline-flex items-center gap-2 rounded-md bg-long px-4 py-2 text-xs font-medium text-background transition hover:opacity-90"
              >
                <Play className="h-3.5 w-3.5" /> Start
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function SegmentSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-0 rounded-md border border-border bg-card p-0.5 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 font-mono text-xs transition ${
            value === o.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
