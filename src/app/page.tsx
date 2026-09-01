"use client";

import { useEffect, useState, useCallback } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { HeroStats } from "@/components/dashboard/hero-stats";
import { SignalPanel } from "@/components/dashboard/signal-panel";
import { CandleChart, type Candle } from "@/components/dashboard/candle-chart";
import { EquityChart } from "@/components/dashboard/equity-chart";
import { TradesTable } from "@/components/dashboard/trades-table";
import { LLMStream } from "@/components/dashboard/llm-stream";
import { HMMMatrix } from "@/components/dashboard/hmm-matrix";
import { ConfigPanel } from "@/components/dashboard/config-panel";
import { BacktestPanel } from "@/components/dashboard/backtest-panel";
import { MarketDigest as MarketDigestPanel } from "@/components/dashboard/market-digest";
import { PnlCurve } from "@/components/dashboard/pnl-curve";
import { PnLCalendar } from "@/components/dashboard/pnl-calendar";
import { PortfolioPanel } from "@/components/dashboard/portfolio-panel";
import { MemoryPanel, LessonsPanel, ReflectionPanel } from "@/components/dashboard/learning-panels";
import { useFetch, fmtMoney } from "@/lib/hooks";
import { SUPPORTED_SYMBOLS, INTERVAL_LABELS } from "@/lib/bybit";
import { toast } from "@/hooks/use-toast";

interface BotSnapshot {
  running: boolean;
  symbol: string;
  symbols: string[];
  interval: string;
  mode: "STATIC" | "DYNAMIC";
  capital: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  position: {
    side: "LONG" | "SHORT" | "FLAT";
    size: number;
    entryPrice: number;
    entryAt: number | null;
    markPrice: number;
    unrealizedPnl: number;
    unrealizedPct: number;
    symbol: string;
  };
  openPositions: { symbol: string; side: "LONG" | "SHORT"; entryPrice: number; size: number; entryAt: number; markPrice: number; unrealizedPnl: number }[];
  openTrades: number;
  totalTrades: number;
  winRate: number;
  drawdown: number;
  lastSignal: any;
  lastError: string | null;
  lastCycleAt: number | null;
  nextCycleAt: number | null;
  lastReflectionAt: number | null;
  activeLessons: number;
  memoryCount: number;
  llmProvider: string;
  equityHistory: { ts: number; equity: number }[];
}

interface BotConfig {
  symbols: string;
  interval: string;
  mode: string;
  capital: number;
  positionSizePct: number;
  stopLossPct: number;
  maxDrawdownPct: number;
  leverage: number;
  trainingWindow: number;
  deltaPct: number;
  llmEnabled: boolean;
  llmWeight: number;
  llmProvider: string;
  llmModel: string;
  reflectionInterval: number;
  memoryTopK: number;
}

const INTERVALS = Object.entries(INTERVAL_LABELS).map(([value, label]) => ({ value, label }));

export default function Home() {
  const [status, setStatus] = useState<BotSnapshot | null>(null);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [signal, setSignal] = useState<any>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [digest, setDigest] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [reasoning, setReasoning] = useState<any[]>([]);
  const [model, setModel] = useState<any>(null);
  const [pnl, setPnl] = useState<{ trades: any[]; daily: any[]; summary: any; capital: number } | null>(null);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [memories, setMemories] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);
  const [reflections, setReflections] = useState<any[]>([]);

  const symbol = status?.symbol ?? "BTCUSDT";
  const interval = status?.interval ?? "60";

  // Poll bot status every 5s (drives the live UI).
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/bot/status", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setStatus(j);
      } catch {}
    }
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Fetch config.
  useEffect(() => {
    fetch("/api/bot/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  // Fetch candles + digest for the current symbol/interval.
  const refreshMarket = useCallback(() => {
    fetch(`/api/market?symbol=${symbol}&interval=${interval}&view=klines&limit=180`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCandles(j.klines ?? []))
      .catch(() => {});
    fetch(`/api/market?symbol=${symbol}&interval=${interval}&view=digest`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setDigest)
      .catch(() => {});
  }, [symbol, interval]);

  useEffect(() => {
    refreshMarket();
    const t = setInterval(refreshMarket, 60_000);
    return () => clearInterval(t);
  }, [refreshMarket]);

  // Fetch live signal periodically (independent of bot running state).
  const refreshSignal = useCallback(() => {
    fetch("/api/signal", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSignal)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshSignal();
    const t = setInterval(refreshSignal, 300_000);
    return () => clearInterval(t);
  }, [refreshSignal, symbol, interval]);

  // Trades, reasoning, model, PnL, portfolio, memory, lessons, reflections.
  useEffect(() => {
    fetch("/api/trades?limit=50", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTrades(j.trades ?? []))
      .catch(() => {});
    fetch("/api/reasoning?limit=15", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setReasoning(j.items ?? []))
      .catch(() => {});
    fetch("/api/model", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setModel(j.model))
      .catch(() => {});
    fetch("/api/pnl", { cache: "no-store" })
      .then((r) => r.json())
      .then(setPnl)
      .catch(() => {});
    fetch("/api/portfolio", { cache: "no-store" })
      .then((r) => r.json())
      .then(setPortfolio)
      .catch(() => {});
    fetch("/api/memory?limit=30", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMemories(j.memories ?? []))
      .catch(() => {});
    fetch("/api/lessons?limit=20", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLessons(j.lessons ?? []))
      .catch(() => {});
    fetch("/api/reflection?limit=10", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setReflections(j.reflections ?? []))
      .catch(() => {});
  }, [status?.lastCycleAt, status?.running, status?.lastReflectionAt]);

  const onStart = useCallback(async () => {
    const r = await fetch("/api/bot/start", { method: "POST" });
    if (r.ok) {
      toast({ title: "Bot started", description: `${symbol} · ${interval} · ${status?.mode ?? "DYNAMIC"}` });
      // Immediate status refresh.
      setTimeout(() => fetch("/api/bot/status", { cache: "no-store" }).then((r) => r.json()).then(setStatus), 800);
    }
  }, [symbol, interval, status?.mode]);

  const onStop = useCallback(async () => {
    const r = await fetch("/api/bot/stop", { method: "POST" });
    if (r.ok) {
      toast({ title: "Bot stopped", description: "Open position closed at mark price." });
      setTimeout(() => fetch("/api/bot/status", { cache: "no-store" }).then((r) => r.json()).then(setStatus), 800);
    }
  }, []);

  const onPatchConfig = useCallback(async (patch: Partial<BotConfig>) => {
    const r = await fetch("/api/bot/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const j = await r.json();
      setConfig(j.state);
      toast({ title: "Configuration updated" });
    }
  }, []);

  const onSymbol = useCallback((s: string) => {
    // Toggle symbol in the portfolio list.
    const current = (config?.symbols ?? "BTCUSDT").split(",").map((x) => x.trim()).filter(Boolean);
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
    if (next.length === 0) return; // keep at least one
    onPatchConfig({ symbols: next.join(",") });
  }, [onPatchConfig, config?.symbols]);
  const onInterval = useCallback((s: string) => onPatchConfig({ interval: s }), [onPatchConfig]);
  const onMode = useCallback((m: "STATIC" | "DYNAMIC") => onPatchConfig({ mode: m }), [onPatchConfig]);

  const markPrice = status?.position.markPrice ?? digest?.lastPrice ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader
        running={status?.running ?? false}
        symbol={symbol}
        interval={interval}
        mode={status?.mode ?? "DYNAMIC"}
        lastCycleAt={status?.lastCycleAt ?? null}
        onStart={onStart}
        onStop={onStop}
        onSymbol={onSymbol}
        onInterval={onInterval}
        onMode={onMode}
        symbols={SUPPORTED_SYMBOLS}
        intervals={INTERVALS}
      />

      <HeroStats
        equity={status?.equity ?? config?.capital ?? 1000}
        capital={status?.capital ?? config?.capital ?? 1000}
        realizedPnl={status?.realizedPnl ?? 0}
        unrealizedPnl={status?.unrealizedPnl ?? 0}
        winRate={status?.winRate ?? 0}
        drawdown={status?.drawdown ?? 0}
        totalTrades={status?.totalTrades ?? 0}
        price={markPrice}
        symbol={symbol}
      />

      {status?.lastError && (
        <div className="border-b border-short/30 bg-short/10 px-6 py-2 text-center font-mono text-xs text-short">
          {status.lastError}
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {/* Single continuous panel — all sections share one border, separated only by 1px lines */}
        <div className="overflow-hidden rounded-lg border border-border bg-border">
          {/* Row 1: chart (8) + signal+market (4) */}
          <div className="grid gap-px lg:grid-cols-12">
            <div className="grid gap-px bg-border lg:col-span-8 lg:grid-rows-[auto_auto]">
              <section className="bg-card">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {symbol} · {INTERVAL_LABELS[interval] ?? interval}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {candles.length} bars
                    </span>
                  </div>
                  {status?.position.side !== "FLAT" && (
                    <span
                      className={`font-mono text-[10px] ${
                        status?.position.side === "LONG" ? "text-long" : "text-short"
                      }`}
                    >
                      OPEN {status?.position.side} @ {status?.position.entryPrice?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div className="px-2 py-3">
                  <CandleChart candles={candles} signal={signal ? { price: signal.price, side: signal.llm.finalSide } : null} />
                </div>
              </section>

              <section className="bg-card">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Live equity
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {fmtMoney(status?.equity ?? config?.capital ?? 1000)}
                  </span>
                </div>
                <div className="px-2 py-3">
                  <EquityChart
                    data={status?.equityHistory ?? []}
                    height={200}
                    startCapital={config?.capital ?? 1000}
                  />
                </div>
              </section>
            </div>

            <div className="grid gap-px bg-border lg:col-span-4 lg:grid-rows-[auto_auto]">
              <SignalPanel
                signal={signal ? {
                  hmm: signal.hmm,
                  llm: signal.llm,
                  price: signal.price,
                  mode: signal.mode,
                } : null}
                loading={!signal}
                flat
              />
              <MarketDigestPanel digest={digest} flat />
            </div>
          </div>

          {/* Row 2: HMM matrix (7) + config (5) */}
          <div className="grid gap-px bg-border lg:grid-cols-12">
            <div className="lg:col-span-7">
              <HMMMatrix model={model} flat />
            </div>
            <div className="lg:col-span-5">
              <ConfigPanel config={config} onPatch={onPatchConfig} running={status?.running ?? false} flat />
            </div>
          </div>

          {/* Row 3: trades (7) + LLM stream (5) */}
          <div className="grid gap-px bg-border lg:grid-cols-12">
            <div className="lg:col-span-7">
              <TradesTable trades={trades} flat />
            </div>
            <div className="lg:col-span-5">
              <LLMStream items={reasoning} flat />
            </div>
          </div>

          {/* Row 4: PnL curve (7) + calendar (5) */}
          <div className="grid gap-px bg-border lg:grid-cols-12">
            <div className="lg:col-span-7">
              <PnlCurve
                trades={pnl?.trades ?? []}
                capital={pnl?.capital ?? config?.capital ?? 1000}
                flat
              />
            </div>
            <div className="lg:col-span-5">
              <PnLCalendar
                daily={pnl?.daily ?? []}
                summary={
                  pnl?.summary ?? {
                    totalPnl: 0,
                    totalTrades: 0,
                    winRate: 0,
                    bestDay: null,
                    worstDay: null,
                  }
                }
                flat
              />
            </div>
          </div>

          {/* Row 5: portfolio (full width) */}
          <PortfolioPanel data={portfolio} flat />

          {/* Row 6: memory + lessons + reflection */}
          <div className="grid gap-px bg-border lg:grid-cols-3">
            <MemoryPanel memories={memories} flat />
            <LessonsPanel lessons={lessons} flat />
            <ReflectionPanel reflections={reflections} flat />
          </div>

          {/* Row 7: backtest (full width) */}
          <BacktestPanel defaultSymbol={symbol} defaultInterval={interval} flat />
        </div>
      </main>

      <footer className="mt-12 border-t border-border">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-1 px-6 py-6 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono">
            Markov Desk · HMM × LLM paper trading on Bybit
          </div>
          <div className="font-mono">
            Based on Andersson & Fransson (2016) — University of Gothenburg
          </div>
        </div>
      </footer>
    </div>
  );
}
