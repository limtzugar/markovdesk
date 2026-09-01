"use client";

import { Panel } from "./signal-panel";
import { fmtMoney, fmtTimeAgo } from "@/lib/hooks";
import { Brain, BookOpen, Lightbulb } from "lucide-react";

interface MemoryItem {
  id: string;
  symbol: string;
  side: string;
  pnl: number;
  pnlPct: number;
  outcome: string;
  closedReason: string | null;
  digest: string;
  tags: string[];
  entryAt: number;
}

export function MemoryPanel({ memories, flat = false }: { memories: MemoryItem[]; flat?: boolean }) {
  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Trade Memory
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {memories.length} entries
        </span>
      </div>

      <div className="max-h-[420px] overflow-y-auto scroll-thin">
        {memories.length === 0 && (
          <div className="px-5 py-12 text-center text-xs text-muted-foreground">
            No memories yet. Memories form automatically when trades close.
          </div>
        )}
        <ul className="divide-y divide-border">
          {memories.map((m) => (
            <li key={m.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      m.outcome === "WIN" ? "bg-long/15 text-long" : m.outcome === "LOSS" ? "bg-short/15 text-short" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {m.outcome}
                  </span>
                  <span className={`font-mono text-[10px] ${m.pnl >= 0 ? "text-long" : "text-short"}`}>
                    {fmtMoney(m.pnl)} ({(m.pnlPct * 100).toFixed(2)}%)
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {fmtTimeAgo(m.entryAt)}
                </span>
              </div>
              <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-foreground/90">{m.digest}</p>
              {m.tags && m.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.tags.map((t, i) => (
                    <span key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

interface LessonItem {
  id: string;
  createdAt: number;
  symbol: string | null;
  category: string;
  severity: string;
  lesson: string;
  suggestedAction: string | null;
  confidence: number;
  applied: boolean;
  confirmations: number;
  refutations: number;
}

export function LessonsPanel({ lessons, flat = false }: { lessons: LessonItem[]; flat?: boolean }) {
  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Strategy Lessons
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lessons.length} learned
        </span>
      </div>

      <div className="max-h-[420px] overflow-y-auto scroll-thin">
        {lessons.length === 0 && (
          <div className="px-5 py-12 text-center text-xs text-muted-foreground">
            No lessons yet. The reflection loop generates lessons every{" "}
            <span className="font-mono">N</span> closed trades.
          </div>
        )}
        <ul className="divide-y divide-border">
          {lessons.map((l) => (
            <li key={l.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      l.severity === "CRITICAL" ? "bg-short/20 text-short" : l.severity === "WARNING" ? "bg-yellow-500/15 text-yellow-500" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {l.category}
                  </span>
                  {l.symbol && (
                    <span className="font-mono text-[10px] text-muted-foreground">{l.symbol}</span>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {(l.confidence * 100).toFixed(0)}% conf
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {fmtTimeAgo(l.createdAt)}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed">{l.lesson}</p>
              {l.suggestedAction && (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5">
                  <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-[11px] text-foreground/80">{l.suggestedAction}</span>
                </div>
              )}
              {(l.confirmations > 0 || l.refutations > 0) && (
                <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
                  <span className="text-long">✓ {l.confirmations} confirmed</span>
                  <span className="text-short">✗ {l.refutations} refuted</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

interface ReflectionItem {
  id: string;
  createdAt: number;
  symbol: string | null;
  tradesReviewed: number;
  winsReviewed: number;
  lossesReviewed: number;
  netPnl: number;
  summary: string;
  lessonsGenerated: number;
}

export function ReflectionPanel({ reflections, flat = false }: { reflections: ReflectionItem[]; flat?: boolean }) {
  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Reflection Log
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {reflections.length} sessions
        </span>
      </div>

      <div className="max-h-[320px] overflow-y-auto scroll-thin">
        {reflections.length === 0 && (
          <div className="px-5 py-12 text-center text-xs text-muted-foreground">
            No reflection sessions yet.
          </div>
        )}
        <ul className="divide-y divide-border">
          {reflections.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {r.symbol ?? "portfolio"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    · {r.tradesReviewed} trades ({r.winsReviewed}W / {r.lossesReviewed}L)
                  </span>
                  <span className={`font-mono text-[10px] ${r.netPnl >= 0 ? "text-long" : "text-short"}`}>
                    {fmtMoney(r.netPnl)}
                  </span>
                  {r.lessonsGenerated > 0 && (
                    <span className="rounded bg-long/15 px-1.5 py-0.5 font-mono text-[9px] text-long">
                      +{r.lessonsGenerated} lessons
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {fmtTimeAgo(r.createdAt)}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">{r.summary}</p>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
