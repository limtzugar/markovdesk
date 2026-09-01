"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, Brain, Cpu, Sparkles } from "lucide-react";

interface Signal {
  hmm: {
    label: "RISE" | "DROP";
    probability: number;
    logLikelihood: number;
    iterations: number;
    obsLabel: string;
  };
  llm: {
    action: string;
    confidence: number;
    reasoning: string;
    marketSummary: string;
    finalSide: "LONG" | "SHORT" | "FLAT";
    latencyMs: number;
    usedSearch: boolean;
  };
  price: number;
  mode: string;
}

interface SignalPanelProps {
  signal: Signal | null;
  loading: boolean;
  flat?: boolean;
}

export function SignalPanel({ signal, loading, flat = false }: SignalPanelProps) {
  if (loading && !signal) {
    return (
      <Panel flat={flat}>
        <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
          Generating signal…
        </div>
      </Panel>
    );
  }
  if (!signal) {
    return (
      <Panel flat={flat}>
        <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
          No signal yet
        </div>
      </Panel>
    );
  }

  const hmmUp = signal.hmm.label === "RISE";
  const final = signal.llm.finalSide;

  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Live Signal</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{signal.mode}</span>
      </div>

      {/* Final decision strip */}
      <div className="px-5 pt-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Final side</div>
        <AnimatePresence mode="wait">
          <motion.div
            key={final}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mt-2 flex items-center gap-3"
          >
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-md ${
                final === "LONG" ? "bg-long/15 text-long" : final === "SHORT" ? "bg-short/15 text-short" : "bg-muted text-muted-foreground"
              }`}
            >
              {final === "LONG" ? (
                <ArrowUpRight className="h-6 w-6" />
              ) : final === "SHORT" ? (
                <ArrowDownRight className="h-6 w-6" />
              ) : (
                <span className="font-display text-xl">—</span>
              )}
            </div>
            <div>
              <div className="font-display text-3xl tracking-tight">
                {final === "FLAT" ? "Flat" : final === "LONG" ? "Long" : "Short"}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                HMM {hmmUp ? "RISE" : "DROP"} · LLM {signal.llm.action}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* HMM & LLM rows */}
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
        <div className="bg-background px-5 py-4">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">HMM · Viterbi</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`font-mono text-2xl ${hmmUp ? "text-long" : "text-short"}`}>
              {hmmUp ? "RISE" : "DROP"}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            p = {signal.hmm.probability.toFixed(3)} · obs {signal.hmm.obsLabel}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            log L = {signal.hmm.logLikelihood.toFixed(1)} · {signal.hmm.iterations} iter
          </div>
          <ProbBar value={signal.hmm.probability} up={hmmUp} />
        </div>

        <div className="bg-background px-5 py-4">
          <div className="flex items-center gap-1.5">
            <Brain className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">LLM overlay</span>
          </div>
          <div className="mt-2 font-mono text-2xl">{signal.llm.action}</div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            conf {signal.llm.confidence.toFixed(2)} · {signal.llm.latencyMs}ms
          </div>
          <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Sparkles className="h-2.5 w-2.5" />
            {signal.llm.usedSearch ? "news-aware" : "no search"}
          </div>
          <ProbBar value={signal.llm.confidence} up={signal.llm.finalSide === "LONG"} neutral={signal.llm.finalSide === "FLAT"} />
        </div>
      </div>

      {/* LLM reasoning */}
      <div className="border-t border-border px-5 py-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">LLM reasoning</div>
        <p className="mt-2 text-sm leading-relaxed">{signal.llm.reasoning || "—"}</p>
        {signal.llm.marketSummary && (
          <div className="mt-3 rounded-md bg-muted/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Market summary</div>
            <p className="mt-1 font-mono text-[11px] leading-relaxed">{signal.llm.marketSummary}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ProbBar({ value, up, neutral }: { value: number; up?: boolean; neutral?: boolean }) {
  const color = neutral ? "bg-muted-foreground" : up ? "bg-long" : "bg-short";
  return (
    <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className={color}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

export function Panel({ children, className = "", flat = false }: { children: React.ReactNode; className?: string; flat?: boolean }) {
  return (
    <div className={`${flat ? "bg-card" : "rounded-lg border border-border bg-card"} ${className}`}>{children}</div>
  );
}
