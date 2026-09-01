"use client";

import { fmtTimeAgo } from "@/lib/hooks";
import { Brain } from "lucide-react";
import { Panel } from "./signal-panel";

interface ReasoningItem {
  id: string;
  symbol: string;
  createdAt: string;
  hmmSignal: string;
  hmmProb: number;
  llmAction: string;
  llmConfidence: number;
  reasoning: string;
  marketSummary: string;
}

export function LLMStream({ items, flat = false }: { items: ReasoningItem[]; flat?: boolean }) {
  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">LLM Reasoning Stream</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{items.length} entries</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto scroll-thin">
        {items.length === 0 && (
          <div className="px-5 py-12 text-center text-xs text-muted-foreground">
            No LLM cycles yet.
          </div>
        )}
        <ul className="divide-y divide-border">
          {items.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-[10px] ${
                      r.hmmSignal === "RISE" ? "text-long" : "text-short"
                    }`}
                  >
                    HMM {r.hmmSignal} · {(r.hmmProb * 100).toFixed(0)}%
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-[10px] text-foreground">{r.llmAction}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    · {(r.llmConfidence * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {fmtTimeAgo(new Date(r.createdAt).getTime())}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed">{r.reasoning}</p>
              {r.marketSummary && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{r.marketSummary}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
