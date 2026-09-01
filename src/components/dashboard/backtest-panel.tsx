"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Loader2 } from "lucide-react";
import { Panel } from "./signal-panel";
import { EquityChart } from "./equity-chart";
import { fmtMoney, fmtPct } from "@/lib/hooks";

interface BacktestResult {
  equityCurve: { ts: number; equity: number }[];
  metrics: {
    startCapital: number;
    endCapital: number;
    totalReturnPct: number;
    totalTrades: number;
    winRate: number;
    sharpe: number;
    maxDrawdown: number;
    avgTradePct: number;
  };
  mode: string;
  symbol: string;
  interval: string;
  bars: number;
}

interface BacktestPanelProps {
  defaultSymbol: string;
  defaultInterval: string;
}

export function BacktestPanel({ defaultSymbol, defaultInterval, flat = false }: BacktestPanelProps & { flat?: boolean }) {
  const [bars, setBars] = useState(400);
  const [trainingWindow, setTrainingWindow] = useState(200);
  const [mode, setMode] = useState<"STATIC" | "DYNAMIC">("DYNAMIC");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: defaultSymbol,
          interval: defaultInterval,
          mode,
          bars,
          trainingWindow,
          deltaPct: 0.0015,
          positionSizePct: 0.1,
          stopLossPct: 0.03,
          startCapital: 1000,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as BacktestResult;
      setResult(json);
    } catch (e: any) {
      setError(e?.message ?? "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel flat={flat}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Backtest · {defaultSymbol} · {defaultInterval}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <ModeToggle mode={mode} setMode={setMode} />
          <NumInput label="Bars" value={bars} onChange={setBars} min={50} max={2000} step={50} />
          <NumInput label="L" value={trainingWindow} onChange={setTrainingWindow} min={50} max={1000} step={50} />
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={running}
            onClick={run}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Running…" : "Run"}
          </motion.button>
        </div>
      </div>

      {error && (
        <div className="border-b border-border bg-short/10 px-5 py-2 font-mono text-xs text-short">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="grid gap-px bg-border md:grid-cols-5">
            <Metric label="End capital" value={fmtMoney(result.metrics.endCapital)} />
            <Metric
              label="Total return"
              value={fmtPct(result.metrics.totalReturnPct)}
              tone={result.metrics.totalReturnPct >= 0 ? "long" : "short"}
            />
            <Metric label="Win rate" value={`${(result.metrics.winRate * 100).toFixed(1)}%`} />
            <Metric label="Sharpe" value={result.metrics.sharpe.toFixed(2)} />
            <Metric
              label="Max DD"
              value={`${(result.metrics.maxDrawdown * 100).toFixed(2)}%`}
              tone={result.metrics.maxDrawdown > 0.15 ? "short" : "neutral"}
            />
          </div>
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Equity curve · {result.metrics.totalTrades} trades
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                avg {result.metrics.avgTradePct.toFixed(2)}% / trade
              </span>
            </div>
            <EquityChart
              data={result.equityCurve}
              height={300}
              startCapital={result.metrics.startCapital}
            />
          </div>
        </>
      )}

      {!result && !running && !error && (
        <div className="px-5 py-12 text-center text-xs text-muted-foreground">
          Configure parameters and press <span className="font-mono">Run</span> to replay historical data
          through the HMM pipeline.
        </div>
      )}
    </Panel>
  );
}

function ModeToggle({ mode, setMode }: { mode: "STATIC" | "DYNAMIC"; setMode: (m: "STATIC" | "DYNAMIC") => void }) {
  return (
    <div className="flex items-center rounded-md border border-border bg-card p-0.5">
      {(["STATIC", "DYNAMIC"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`rounded px-2 py-1 font-mono text-[11px] transition ${
            mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {m.charAt(0)}
        </button>
      ))}
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 bg-transparent font-mono text-[11px] outline-none"
      />
    </label>
  );
}

function Metric({
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
      <div className={`mt-1 font-mono text-base tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
