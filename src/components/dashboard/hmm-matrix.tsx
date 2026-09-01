"use client";

import { Panel } from "./signal-panel";
import { OBS_LABELS } from "@/lib/hmm-labels";

interface HMMMatrix {
  transition: number[][];
  emission: number[][];
  pi: number[];
  logLikelihood: number;
  trainingSize: number;
  trainedAt: string;
  symbol: string;
  interval: string;
  mode: string;
}

export function HMMMatrix({ model, flat = false }: { model: HMMMatrix | null; flat?: boolean }) {
  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">HMM λ = {`{A, B, π}`}</span>
        {model && (
          <span className="font-mono text-[10px] text-muted-foreground">
            log L = {model.logLikelihood.toFixed(1)} · n = {model.trainingSize}
          </span>
        )}
      </div>

      {!model ? (
        <div className="px-5 py-12 text-center text-xs text-muted-foreground">
          No trained model yet. Start the bot or run a backtest.
        </div>
      ) : (
        <div className="grid gap-px bg-border md:grid-cols-2">
          {/* Transition matrix A */}
          <div className="bg-background px-5 py-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              A — Transition
            </div>
            <div className="mt-3 font-mono text-[11px]">
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1">
                <div />
                <div className="text-right text-muted-foreground">→ DROP</div>
                <div className="text-right text-muted-foreground">→ RISE</div>
                {model.transition.map((row, i) => (
                  <Row key={i} label={i === 0 ? "DROP" : "RISE"} row={row} />
                ))}
              </div>
            </div>
          </div>

          {/* Emission matrix B */}
          <div className="bg-background px-5 py-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              B — Emission
            </div>
            <div className="mt-3 grid grid-cols-9 gap-1">
              {OBS_LABELS.map((label, k) => (
                <div key={k} className="text-center">
                  <div className="font-mono text-[8px] text-muted-foreground">{label}</div>
                  <div className="mt-0.5 flex h-12 items-end overflow-hidden rounded-sm bg-muted/40">
                    {model.emission.map((row, i) => {
                      const v = row[k] ?? 0;
                      return (
                        <div
                          key={i}
                          className={`flex-1 ${i === 0 ? "bg-short/70" : "bg-long/70"}`}
                          style={{ height: `${Math.max(2, v * 100)}%` }}
                          title={`${i === 0 ? "DROP" : "RISE"} → ${label}: ${(v * 100).toFixed(1)}%`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 bg-short/70" /> DROP
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 bg-long/70" /> RISE
              </span>
              <span className="ml-auto">π = [{model.pi.map((p) => p.toFixed(2)).join(", ")}]</span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Row({ label, row }: { label: string; row: number[] }) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      {row.map((v, j) => (
        <div key={j} className="text-right tabular-nums">
          <span className={v > 0.5 ? "text-foreground" : "text-muted-foreground"}>
            {(v * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </>
  );
}
