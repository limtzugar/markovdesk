"use client";

import { motion } from "framer-motion";
import { fmtMoney, fmtPct } from "@/lib/hooks";

interface HeroStatsProps {
  equity: number;
  capital: number;
  realizedPnl: number;
  unrealizedPnl: number;
  winRate: number;
  drawdown: number;
  totalTrades: number;
  price: number;
  symbol: string;
}

export function HeroStats({
  equity,
  capital,
  realizedPnl,
  unrealizedPnl,
  winRate,
  drawdown,
  totalTrades,
  price,
  symbol,
}: HeroStatsProps) {
  const totalPnl = equity - capital;
  const totalPct = capital > 0 ? (totalPnl / capital) * 100 : 0;
  const positive = totalPnl >= 0;

  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-px bg-border md:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Equity"
          value={fmtMoney(equity)}
          sub={`${fmtPct(totalPct)} all-time`}
          subTone={positive ? "long" : "short"}
          big
        />
        <Stat
          label={`${symbol.replace("USDT", "")} price`}
          value={`$${price.toLocaleString("en-US", { maximumFractionDigits: price > 100 ? 2 : 4 })}`}
          sub="Mark · Bybit"
          mono
        />
        <Stat
          label="Unrealized"
          value={fmtMoney(unrealizedPnl)}
          sub="Open position"
          subTone={unrealizedPnl > 0 ? "long" : unrealizedPnl < 0 ? "short" : "neutral"}
        />
        <Stat
          label="Realized"
          value={fmtMoney(realizedPnl)}
          sub="Closed trades"
          subTone={realizedPnl > 0 ? "long" : realizedPnl < 0 ? "short" : "neutral"}
        />
        <Stat
          label="Win rate"
          value={`${(winRate * 100).toFixed(1)}%`}
          sub={`${totalTrades} trades`}
          subTone={winRate >= 0.5 ? "long" : "short"}
        />
        <Stat
          label="Max DD"
          value={`${(drawdown * 100).toFixed(2)}%`}
          sub="From peak"
          subTone={drawdown > 0.1 ? "short" : "neutral"}
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  subTone = "neutral",
  big,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "long" | "short" | "neutral";
  big?: boolean;
  mono?: boolean;
}) {
  const tone =
    subTone === "long" ? "text-long" : subTone === "short" ? "text-short" : "text-muted-foreground";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-background px-6 py-6"
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div
        className={`mt-2 ${big ? "font-display text-4xl" : mono ? "font-mono text-2xl" : "font-mono text-2xl"} tracking-tight`}
      >
        {value}
      </div>
      {sub && <div className={`mt-1 font-mono text-xs ${tone}`}>{sub}</div>}
    </motion.div>
  );
}
