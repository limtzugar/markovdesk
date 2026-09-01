"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export function useFetch<T>(url: string, opts?: { intervalMs?: number; immediate?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const immediate = opts?.immediate ?? true;
  const intervalMs = opts?.intervalMs;
  const timer = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!immediate) return;
    refresh();
    if (intervalMs && intervalMs > 0) {
      timer.current = setInterval(refresh, intervalMs);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh, intervalMs, immediate]);

  return { data, loading, error, refresh, setData };
}

export function fmtMoney(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  const sign = x < 0 ? "-" : "";
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(digits)}`;
}

export function fmtPct(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(digits)}%`;
}

export function fmtNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

export function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtTimeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
