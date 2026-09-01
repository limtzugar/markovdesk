/**
 * Bybit v5 public API client — market data only (no private keys required).
 * Used for both backtest (historical klines) and live signal generation.
 *
 * Docs: https://bybit-exchange.github.io/docs/v5/market/kline
 *
 * For paper-trading we never call private endpoints; the local engine
 * simulates order fills against the latest public mark price.
 */

const BYBIT_BASE = "https://api.bybit.com";

export interface Kline {
  ts: number; // ms epoch — start time of the kline
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  prevPrice24h: number;
  price24hPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  turnover24h: number;
  volume24h: number;
  fundingRate: number;
  nextFundingTime: number;
}

export const SUPPORTED_INTERVALS: Record<string, string> = {
  "1": "1",
  "3": "3",
  "5": "5",
  "15": "15",
  "30": "30",
  "60": "60",
  "120": "120",
  "240": "240",
  "D": "D",
  "W": "W",
};

export const INTERVAL_LABELS: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  D: "1d",
  W: "1w",
};

export const SUPPORTED_SYMBOLS = [
  { symbol: "BTCUSDT", label: "Bitcoin", category: "linear" },
  { symbol: "ETHUSDT", label: "Ethereum", category: "linear" },
  { symbol: "SOLUSDT", label: "Solana", category: "linear" },
  { symbol: "BTCSOL", label: "BTC/SOL cross", category: "synthetic" },
  { symbol: "XRPUSDT", label: "Ripple", category: "linear" },
  { symbol: "DOGEUSDT", label: "Dogecoin", category: "linear" },
  { symbol: "ARBUSDT", label: "Arbitrum", category: "linear" },
];

/**
 * Synthetic cross-rate pairs (e.g. BTCSOL = BTC/SOL) computed from two USDT pairs.
 * Symbol → [numerator, denominator].
 */
const SYNTHETIC_PAIRS: Record<string, [string, string]> = {
  BTCSOL: ["BTCUSDT", "SOLUSDT"],
  ETHBTC: ["ETHUSDT", "BTCUSDT"],
  SOLETH: ["SOLUSDT", "ETHUSDT"],
};

function isSynthetic(symbol: string): symbol is keyof typeof SYNTHETIC_PAIRS {
  return symbol in SYNTHETIC_PAIRS;
}

/**
 * Fetch historical klines. Bybit returns newest-first; we reverse to chronological.
 * For synthetic cross-rate pairs (e.g. BTCSOL), fetches both legs and divides.
 *
 * @param symbol e.g. "BTCUSDT" or "BTCSOL"
 * @param interval Bybit code, see SUPPORTED_INTERVALS
 * @param limit   max 1000 for linear per request
 */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 200,
  category: string = "linear",
): Promise<Kline[]> {
  // Synthetic cross-rate: fetch both legs, divide price series.
  if (isSynthetic(symbol)) {
    const [num, den] = SYNTHETIC_PAIRS[symbol];
    const [numKlines, denKlines] = await Promise.all([
      fetchKlines(num, interval, limit, category),
      fetchKlines(den, interval, limit, category),
    ]);
    // Align by timestamp (use numerator as reference).
    const denMap = new Map(denKlines.map((k) => [k.ts, k]));
    return numKlines
      .filter((k) => denMap.has(k.ts))
      .map((k) => {
        const d = denMap.get(k.ts)!;
        const o = d.open !== 0 ? k.open / d.open : k.open;
        const h = d.high !== 0 ? k.high / d.high : k.high;
        const l = d.low !== 0 ? k.low / d.low : k.low;
        const c = d.close !== 0 ? k.close / d.close : k.close;
        return {
          ts: k.ts,
          open: o,
          high: Math.max(o, h, l, c),
          low: Math.min(o, h, l, c),
          close: c,
          volume: k.volume, // use numerator volume as proxy
        };
      });
  }

  const url = `${BYBIT_BASE}/v5/market/kline?category=${encodeURIComponent(category)}&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Bybit kline HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`Bybit kline error: ${json.retMsg}`);

  const rows: string[][] = json?.result?.list ?? [];
  return rows
    .map((r) => ({
      ts: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Fetch klines by walking backwards through `end` timestamps.
 * Used for backtests that need more than 1000 bars.
 */
export async function fetchKlinesRange(
  symbol: string,
  interval: string,
  total: number,
  category: string = "linear",
): Promise<Kline[]> {
  const out: Kline[] = [];
  let end: number | undefined;
  while (out.length < total) {
    const url = new URL(`${BYBIT_BASE}/v5/market/kline`);
    url.searchParams.set("category", category);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "1000");
    if (end) url.searchParams.set("end", String(end));
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Bybit kline HTTP ${res.status}`);
    const json = await res.json();
    if (json.retCode !== 0) throw new Error(`Bybit kline error: ${json.retMsg}`);
    const rows: string[][] = json?.result?.list ?? [];
    if (rows.length === 0) break;
    const batch: Kline[] = rows
      .map((r) => ({
        ts: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }))
      .sort((a, b) => a.ts - b.ts);
    out.push(...batch);
    end = batch[0].ts - 1; // step back before the oldest we just got
    if (rows.length < 1000) break;
  }
  // Deduplicate by ts and sort.
  const seen = new Set<number>();
  const deduped = out.filter((k) => {
    if (seen.has(k.ts)) return false;
    seen.add(k.ts);
    return true;
  });
  return deduped.sort((a, b) => a.ts - b.ts).slice(-total);
}

export async function fetchTicker(symbol: string, category = "linear"): Promise<Ticker> {
  // Synthetic cross-rate ticker.
  if (isSynthetic(symbol)) {
    const [num, den] = SYNTHETIC_PAIRS[symbol];
    const [nt, dt] = await Promise.all([
      fetchTicker(num, category),
      fetchTicker(den, category),
    ]);
    const lastPrice = dt.lastPrice > 0 ? nt.lastPrice / dt.lastPrice : 0;
    const markPrice = dt.markPrice > 0 ? nt.markPrice / dt.markPrice : lastPrice;
    const indexPrice = dt.indexPrice > 0 ? nt.indexPrice / dt.indexPrice : lastPrice;
    const prevPrice24h = dt.prevPrice24h > 0 ? nt.prevPrice24h / dt.prevPrice24h : lastPrice;
    const high24h = dt.lowPrice24h > 0 ? nt.highPrice24h / dt.lowPrice24h : lastPrice;
    const low24h = dt.highPrice24h > 0 ? nt.lowPrice24h / dt.highPrice24h : lastPrice;
    return {
      symbol,
      lastPrice,
      markPrice,
      indexPrice,
      prevPrice24h,
      price24hPcnt: nt.price24hPcnt - dt.price24hPcnt,
      highPrice24h: high24h,
      lowPrice24h: low24h,
      turnover24h: nt.turnover24h,
      volume24h: nt.volume24h,
      fundingRate: 0, // cross-rate has no funding
      nextFundingTime: 0,
    };
  }

  const url = `${BYBIT_BASE}/v5/market/tickers?category=${encodeURIComponent(category)}&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Bybit ticker HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`Bybit ticker error: ${json.retMsg}`);
  const r = json?.result?.list?.[0];
  if (!r) throw new Error("Bybit ticker: empty result");
  return {
    symbol: r.symbol,
    lastPrice: Number(r.lastPrice),
    markPrice: Number(r.markPrice),
    indexPrice: Number(r.indexPrice),
    prevPrice24h: Number(r.prevPrice24h),
    price24hPcnt: Number(r.price24hPcnt),
    highPrice24h: Number(r.highPrice24h),
    lowPrice24h: Number(r.lowPrice24h),
    turnover24h: Number(r.turnover24h),
    volume24h: Number(r.volume24h),
    fundingRate: Number(r.fundingRate ?? 0),
    nextFundingTime: Number(r.nextFundingTime ?? 0),
  };
}

/** Compact market digest used to feed the LLM. */
export interface MarketDigest {
  symbol: string;
  interval: string;
  lastPrice: number;
  markPrice: number;
  pct24h: number;
  high24h: number;
  low24h: number;
  vol24h: number;
  fundingRate: number;
  recentCandles: Kline[];
  shortMA: number; // MA(10)
  longMA: number; // MA(50)
  rsi14: number;
  atr14: number;
}

export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeATR(klines: Kline[], period = 14): number {
  if (klines.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].high;
    const l = klines[i].low;
    const pc = klines[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Simple moving average of TR.
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function ma(closes: number[], period: number): number {
  if (closes.length < period) return closes.reduce((a, b) => a + b, 0) / Math.max(1, closes.length);
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export async function buildMarketDigest(
  symbol: string,
  interval: string,
  candles?: Kline[],
): Promise<MarketDigest> {
  const klines = candles ?? (await fetchKlines(symbol, interval, 120));
  const ticker = await fetchTicker(symbol);
  const closes = klines.map((k) => k.close);
  return {
    symbol,
    interval,
    lastPrice: ticker.lastPrice,
    markPrice: ticker.markPrice,
    pct24h: ticker.price24hPcnt * 100,
    high24h: ticker.highPrice24h,
    low24h: ticker.lowPrice24h,
    vol24h: ticker.volume24h,
    fundingRate: ticker.fundingRate * 100,
    recentCandles: klines.slice(-12),
    shortMA: ma(closes, 10),
    longMA: ma(closes, 50),
    rsi14: computeRSI(closes, 14),
    atr14: computeATR(klines, 14),
  };
}
