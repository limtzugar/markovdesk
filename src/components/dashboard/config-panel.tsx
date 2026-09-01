"use client";

import { useState } from "react";
import { Panel } from "./signal-panel";
import { fmtMoney, fmtPct } from "@/lib/hooks";

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

export function ConfigPanel({
  config,
  onPatch,
  running,
  flat = false,
}: {
  config: BotConfig | null;
  onPatch: (patch: Partial<BotConfig>) => Promise<void>;
  running: boolean;
  flat?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function patch(p: Partial<BotConfig>) {
    setBusy(true);
    try {
      await onPatch(p);
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <Panel flat={flat}>
        <div className="px-5 py-12 text-center text-xs text-muted-foreground">Loading config…</div>
      </Panel>
    );
  }

  return (
    <Panel flat={flat}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Bot configuration</span>
        {running && (
          <span className="font-mono text-[10px] text-muted-foreground">stop to edit</span>
        )}
      </div>
      <div className="grid gap-px bg-border md:grid-cols-2">
        <Field label="Capital" value={fmtMoney(config.capital)} disabled />
        <Field label="Position size %" value={`${(config.positionSizePct * 100).toFixed(1)}%`} disabled={running} />
        <Field label="Stop loss %" value={`${(config.stopLossPct * 100).toFixed(1)}%`} disabled={running} />
        <Field label="Max drawdown %" value={`${(config.maxDrawdownPct * 100).toFixed(1)}%`} disabled={running} />
        <Field label="Leverage" value={`${config.leverage.toFixed(1)}×`} disabled={running} />
        <Field label="Training window L" value={`${config.trainingWindow} bars`} disabled={running} />
        <Field label="Delta ∆ %" value={`${(config.deltaPct * 100).toFixed(3)}%`} disabled={running} />
        <Field label="LLM weight" value={`${(config.llmWeight * 100).toFixed(0)}%`} disabled={running} />
        <Field label="Reflection interval" value={`every ${config.reflectionInterval} trades`} disabled={running} />
        <Field label="Memory top-K" value={`${config.memoryTopK} similar`} disabled={running} />
      </div>

      <div className="border-t border-border px-5 py-4 space-y-4">
        <label className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">LLM overlay</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {config.llmEnabled ? "active · news-aware" : "disabled · HMM only"}
            </div>
          </div>
          <button
            disabled={busy}
            onClick={() => patch({ llmEnabled: !config.llmEnabled })}
            className={`relative h-6 w-11 rounded-full transition ${config.llmEnabled ? "bg-long" : "bg-muted"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-all ${
                config.llmEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </label>

        {/* LLM provider selector */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">LLM provider</div>
          <div className="mt-1.5 flex gap-1">
            {(["glm", "deepseek", "openai"] as const).map((p) => (
              <button
                key={p}
                disabled={busy || running}
                onClick={() => patch({ llmProvider: p })}
                className={`rounded px-2.5 py-1 font-mono text-[11px] transition ${
                  config.llmProvider === p
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                } ${p !== "glm" ? "opacity-70" : ""}`}
                title={p === "glm" ? "GLM via z-ai SDK (default, no key needed)" : p === "deepseek" ? "DeepSeek API (set DEEPSEEK_API_KEY in .env)" : "OpenAI-compatible (set OPENAI_API_KEY)"}
              >
                {p}
              </button>
            ))}
          </div>
          {config.llmProvider !== "glm" && (
            <div className="mt-1.5 font-mono text-[10px] text-yellow-500/80">
              Requires {config.llmProvider.toUpperCase()}_API_KEY in .env
            </div>
          )}
        </div>

        {/* Model override */}
        {config.llmModel && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Model</div>
            <div className="mt-1 font-mono text-xs">{config.llmModel}</div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Field({
  label,
  value,
  disabled,
}: {
  label: string;
  value: string;
  disabled?: boolean;
}) {
  return (
    <div className={`bg-background px-5 py-3 ${disabled ? "opacity-70" : ""}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

// Re-export fmtPct to keep import graph tidy (used elsewhere).
export { fmtPct };
