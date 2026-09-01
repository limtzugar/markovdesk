/**
 * Hidden Markov Model — implementation following
 * Andersson & Fransson (2016), "Algorithmic Trading Based on Hidden Markov Models",
 * University of Gothenburg, Bachelor's Thesis in Industrial and Financial Management.
 *
 * Adapted for crypto (Bybit) intraday data:
 *   - Time step t = 1 kline (instead of 1 trading day).
 *   - Hidden states N = 2: {1=DROP, 2=RISE} (next-kline price movement).
 *   - Observable states M = 9 = 3 × 3:
 *       var 1: Price movement  ∈ {RISE, CONST, DROP}
 *       var 2: Mean displacement (vs MA(10)) ∈ {HIGHER, EQUAL, LOWER}
 *   - Training via Baum-Welch (EM).
 *   - Decoding via Viterbi.
 *
 * References in the thesis:
 *   - §2.5.2 The Mathematics (model λ = {A, B, π})
 *   - §2.5.3 The Baum-Welch Algorithm
 *   - §2.5.4 The Viterbi Algorithm
 *   - §3.3.2 Choice of Observable and Hidden States
 *   - §3.3.3 / §3.3.4 Static vs Dynamic training
 *   - §3.3.6 Investment Strategy (long on RISE, short on DROP)
 */

export type Matrix = number[][];
export type Vector = number[];

export interface HMMParams {
  /** Transition matrix A — size N×N. a[i][j] = P(X_t = j | X_{t-1} = i). */
  A: Matrix;
  /** Emission matrix B — size N×M. b[i][k] = P(Y_t = k | X_t = i). */
  B: Matrix;
  /** Initial distribution π — length N. */
  pi: Vector;
}

export interface HMMModel {
  params: HMMParams;
  nStates: number;
  nObs: number;
  logLikelihood: number;
  iterations: number;
  converged: boolean;
}

export const N_HIDDEN = 2;
export const N_OBS = 9; // 3 × 3
export const MA_WINDOW = 10; // moving-average window for mean displacement

/** Hidden state semantics — matches thesis §3.3.2, Table 3.1. */
export enum HiddenState {
  DROP = 0,
  RISE = 1,
}

/** Price-movement state — thesis Table 3.2. */
export enum PriceMoveState {
  RISE = 0,
  CONST = 1,
  DROP = 2,
}

/** Mean-displacement state — thesis Table 3.3. */
export enum MeanDispState {
  HIGHER = 0,
  EQUAL = 1,
  LOWER = 2,
}

/**
 * Combine two ternary variables into a single observable index in [0..8].
 * Matches thesis Table 3.4: state = (priceMove - 1) * 3 + (meanDisp - 1) shifted to 0-index.
 */
export function observableState(priceMove: PriceMoveState, meanDisp: MeanDispState): number {
  return priceMove * 3 + meanDisp;
}

export function decodeObservable(state: number): { priceMove: PriceMoveState; meanDisp: MeanDispState } {
  return {
    priceMove: Math.floor(state / 3) as PriceMoveState,
    meanDisp: (state % 3) as MeanDispState,
  };
}

export const OBS_LABELS: string[] = (() => {
  const pm = ["Rise", "Const", "Drop"];
  const md = ["Hi", "Eq", "Lo"];
  const out: string[] = [];
  for (let p = 0; p < 3; p++) for (let m = 0; m < 3; m++) out.push(`${pm[p]}·${md[m]}`);
  return out;
})();

/** Tiny numerical helpers. */
function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

function normalizeRow(row: number[]): number[] {
  const s = row.reduce((a, b) => a + b, 0);
  return s > 0 ? row.map((v) => v / s) : row.map(() => 1 / row.length);
}

function safeLog(x: number): number {
  return x <= 0 ? -1e30 : Math.log(x);
}

/**
 * Build an observation sequence from a price series, following §3.3.2.
 *
 *  Price movement (eq 3.2):    opening_t − closing_{t-1}
 *  Mean displacement (eq 3.3): opening_t − MA_10(t)
 *
 * ∆ = `delta` (absolute price units). States use dead-zones of ±∆.
 *
 * Hidden labels for supervised init: sign of opening_{t+1} − closing_t
 *   DROP if < 0, RISE if ≥ 0 — matches thesis eq (3.1).
 *
 * @returns observations Y[0..T-1] and hidden labels X[0..T-1] (used to seed Baum-Welch).
 */
export function buildObservationSequence(
  candles: { open: number; close: number; high: number; low: number; ts: number }[],
  delta: number,
): { Y: number[]; X: number[]; valid: boolean } {
  if (candles.length < MA_WINDOW + 2) {
    return { Y: [], X: [], valid: false };
  }

  // MA(10) computed on close prices (thesis §3.3.2 second variable).
  const ma: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < MA_WINDOW - 1) {
      ma.push(NaN);
      continue;
    }
    let sum = 0;
    for (let k = i - MA_WINDOW + 1; k <= i; k++) sum += candles[k].close;
    ma.push(sum / MA_WINDOW);
  }

  const Y: number[] = [];
  const X: number[] = [];

  // Observation at time t uses candle[t].open as "opening_t".
  // Hidden label at time t uses candle[t+1].open − candle[t].close (upcoming price movement).
  for (let t = MA_WINDOW; t < candles.length - 1; t++) {
    const opening = candles[t].open;
    const prevClose = candles[t - 1].close;
    const move = opening - prevClose;
    const disp = opening - ma[t];

    const pm = move > delta ? PriceMoveState.RISE : move < -delta ? PriceMoveState.DROP : PriceMoveState.CONST;
    const md = disp > delta ? MeanDispState.HIGHER : disp < -delta ? MeanDispState.LOWER : MeanDispState.EQUAL;

    Y.push(observableState(pm, md));

    const upcoming = candles[t + 1].open - candles[t].close;
    X.push(upcoming >= 0 ? HiddenState.RISE : HiddenState.DROP);
  }

  return { Y, X, valid: Y.length >= 30 };
}

/**
 * Seed HMM parameters using supervised estimates from labelled X and Y,
 * exactly like MATLAB's hmmestimate(Y, X) used in §3.3.3.
 */
export function estimateFromLabels(Y: number[], X: number[], nStates = N_HIDDEN, nObs = N_OBS): HMMParams {
  const A = zeros(nStates, nStates);
  const B = zeros(nStates, nObs);
  const pi = Array.from({ length: nStates }, () => 0);

  // Count transitions & emissions.
  for (let t = 0; t < X.length; t++) {
    if (t === 0) {
      pi[X[t]] += 1;
    } else {
      A[X[t - 1]][X[t]] += 1;
    }
    B[X[t]][Y[t]] += 1;
  }

  // Normalize rows; add tiny smoothing to avoid zero probabilities (Rabiner's "small parameters" caveat §2.5.5).
  const eps = 1e-6;
  for (let i = 0; i < nStates; i++) {
    A[i] = A[i].map((v) => v + eps);
    B[i] = B[i].map((v) => v + eps);
    A[i] = normalizeRow(A[i]);
    B[i] = normalizeRow(B[i]);
  }
  const piSum = pi.reduce((a, b) => a + b, 0);
  pi.forEach((_, i) => (pi[i] = (pi[i] + eps) / (piSum + nStates * eps)));

  return { A, B, pi };
}

/** Forward pass — α_t(i) = P(Y_1..Y_t, X_t = i | λ). Returns scaled α and scale factors. */
function forward(Y: number[], params: HMMParams): { alpha: Matrix; scales: number[]; logLik: number } {
  const { A, B, pi } = params;
  const T = Y.length;
  const N = A.length;
  const alpha = zeros(T, N);
  const scales = Array.from({ length: T }, () => 0);

  // Initialization.
  for (let i = 0; i < N; i++) {
    alpha[0][i] = pi[i] * B[i][Y[0]];
  }
  let s = alpha[0].reduce((a, b) => a + b, 0);
  scales[0] = s > 0 ? s : 1e-30;
  for (let i = 0; i < N; i++) alpha[0][i] /= scales[0];

  // Induction.
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += alpha[t - 1][i] * A[i][j];
      alpha[t][j] = sum * B[j][Y[t]];
    }
    s = alpha[t].reduce((a, b) => a + b, 0);
    scales[t] = s > 0 ? s : 1e-30;
    for (let j = 0; j < N; j++) alpha[t][j] /= scales[t];
  }

  const logLik = scales.reduce((acc, c) => acc + safeLog(c), 0);
  return { alpha, scales, logLik };
}

/** Backward pass — β_t(i) = P(Y_{t+1}..Y_T | X_t = i, λ). Returns scaled β. */
function backward(Y: number[], params: HMMParams, scales: number[]): Matrix {
  const { A, B } = params;
  const T = Y.length;
  const N = A.length;
  const beta = zeros(T, N);

  for (let i = 0; i < N; i++) beta[T - 1][i] = 1 / scales[T - 1];

  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += A[i][j] * B[j][Y[t + 1]] * beta[t + 1][j];
      beta[t][i] = sum / scales[t];
    }
  }
  return beta;
}

/**
 * Baum-Welch — EM training (thesis §2.5.3, mirrors MATLAB's hmmtrain).
 * Initializes from `seed` params (or random if not provided) and iterates until convergence.
 */
export function baumWelch(
  Y: number[],
  seed?: HMMParams,
  opts: { maxIter?: number; tol?: number; nStates?: number; nObs?: number } = {},
): HMMModel {
  const maxIter = opts.maxIter ?? 200;
  const tol = opts.tol ?? 1e-5;
  const N = opts.nStates ?? N_HIDDEN;
  const M = opts.nObs ?? N_OBS;

  let params: HMMParams;
  if (seed) {
    params = { A: seed.A.map((r) => [...r]), B: seed.B.map((r) => [...r]), pi: [...seed.pi] };
  } else {
    // Random stochastic init.
    const A = zeros(N, N);
    const B = zeros(N, M);
    const pi = Array.from({ length: N }, () => Math.random() + 0.1);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) A[i][j] = Math.random() + 0.1;
      for (let k = 0; k < M; k++) B[i][k] = Math.random() + 0.1;
      A[i] = normalizeRow(A[i]);
      B[i] = normalizeRow(B[i]);
    }
    const piSum = pi.reduce((a, b) => a + b, 0);
    pi.forEach((_, i) => (pi[i] = pi[i] / piSum));
    params = { A, B, pi };
  }

  let prevLogLik = -Infinity;
  let iter = 0;
  let converged = false;
  const eps = 1e-7;

  for (iter = 1; iter <= maxIter; iter++) {
    const { alpha, scales, logLik } = forward(Y, params);
    const betaMat = backward(Y, params, scales);
    const T = Y.length;
    const N2 = params.A.length;
    const M2 = params.B[0].length;

    // γ_t(i) = α_t(i) β_t(i) / Σ_j α_t(j) β_t(j)
    const gamma = zeros(T, N2);
    for (let t = 0; t < T; t++) {
      let denom = 0;
      for (let i = 0; i < N2; i++) denom += alpha[t][i] * betaMat[t][i];
      if (denom <= 0) denom = 1e-30;
      for (let i = 0; i < N2; i++) gamma[t][i] = (alpha[t][i] * betaMat[t][i]) / denom;
    }

    // ξ_t(i,j) = α_t(i) A[i][j] B[j][Y_{t+1}] β_{t+1}(j) / denom
    const xi = zeros(N2, N2);
    for (let t = 0; t < T - 1; t++) {
      let denom = 0;
      for (let i = 0; i < N2; i++) {
        for (let j = 0; j < N2; j++) {
          denom += alpha[t][i] * params.A[i][j] * params.B[j][Y[t + 1]] * betaMat[t + 1][j];
        }
      }
      if (denom <= 0) denom = 1e-30;
      for (let i = 0; i < N2; i++) {
        for (let j = 0; j < N2; j++) {
          xi[i][j] += (alpha[t][i] * params.A[i][j] * params.B[j][Y[t + 1]] * betaMat[t + 1][j]) / denom;
        }
      }
    }

    // Re-estimate π, A, B.
    for (let i = 0; i < N2; i++) params.pi[i] = (gamma[0][i] + eps) / (1 + N2 * eps);

    for (let i = 0; i < N2; i++) {
      let denomA = 0;
      for (let t = 0; t < T - 1; t++) denomA += gamma[t][i];
      for (let j = 0; j < N2; j++) {
        params.A[i][j] = (xi[i][j] + eps) / (denomA + N2 * eps);
      }
      params.A[i] = normalizeRow(params.A[i]);
    }

    for (let i = 0; i < N2; i++) {
      let denomB = 0;
      for (let t = 0; t < T; t++) denomB += gamma[t][i];
      for (let k = 0; k < M2; k++) {
        let num = eps;
        for (let t = 0; t < T; t++) if (Y[t] === k) num += gamma[t][i];
        params.B[i][k] = num / (denomB + M2 * eps);
      }
      params.B[i] = normalizeRow(params.B[i]);
    }

    if (Math.abs(logLik - prevLogLik) < tol) {
      converged = true;
      prevLogLik = logLik;
      break;
    }
    prevLogLik = logLik;
  }

  return {
    params,
    nStates: N,
    nObs: M,
    logLikelihood: prevLogLik,
    iterations: iter,
    converged,
  };
}

/**
 * Viterbi — most probable hidden state sequence (thesis §2.5.4, mirrors hmmviterbi).
 * Returns δ path and the posterior proxy for the LAST state.
 */
export function viterbi(Y: number[], params: HMMParams): {
  path: number[];
  lastState: number;
  lastProb: number;
  logProb: number;
} {
  const { A, B, pi } = params;
  const T = Y.length;
  const N = A.length;

  const delta = zeros(T, N);
  const psi = zeros(T, N);

  for (let i = 0; i < N; i++) delta[0][i] = safeLog(pi[i]) + safeLog(B[i][Y[0]]);

  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      let best = -Infinity;
      let bestI = 0;
      for (let i = 0; i < N; i++) {
        const v = delta[t - 1][i] + safeLog(A[i][j]);
        if (v > best) {
          best = v;
          bestI = i;
        }
      }
      delta[t][j] = best + safeLog(B[j][Y[t]]);
      psi[t][j] = bestI;
    }
  }

  // Backtrack.
  const path = Array.from({ length: T }, () => 0);
  let best = -Infinity;
  let bestJ = 0;
  for (let j = 0; j < N; j++) {
    if (delta[T - 1][j] > best) {
      best = delta[T - 1][j];
      bestJ = j;
    }
  }
  path[T - 1] = bestJ;
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];

  // Posterior proxy for the last state — softmax over delta[T-1].
  const maxLog = Math.max(...delta[T - 1]);
  const exps = delta[T - 1].map((v) => Math.exp(v - maxLog));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((v) => v / sumExp);

  return {
    path,
    lastState: bestJ,
    lastProb: probs[bestJ],
    logProb: best,
  };
}

/**
 * Convenience — train + decode one-shot, returning the signal for the most-recent kline.
 * This is what the bot calls every cycle (STATIC mode reuses a cached model; DYNAMIC retrains).
 */
export interface HMMSignal {
  state: HiddenState;
  label: "RISE" | "DROP";
  probability: number; // Viterbi posterior proxy in [0,1]
  logLikelihood: number;
  iterations: number;
  converged: boolean;
  obsAtCursor: number; // last observation index
  obsLabel: string;
  params: HMMParams;
}

export function trainAndPredict(
  candles: { open: number; close: number; high: number; low: number; ts: number }[],
  delta: number,
  seed?: HMMParams,
): HMMSignal | null {
  const { Y, X, valid } = buildObservationSequence(candles, delta);
  if (!valid) return null;

  const seedParams = seed ?? estimateFromLabels(Y, X);
  const model = baumWelch(Y, seedParams, { maxIter: 120 });
  const v = viterbi(Y, model.params);

  return {
    state: v.lastState,
    label: v.lastState === HiddenState.RISE ? "RISE" : "DROP",
    probability: v.lastProb,
    logLikelihood: model.logLikelihood,
    iterations: model.iterations,
    converged: model.converged,
    obsAtCursor: Y[Y.length - 1],
    obsLabel: OBS_LABELS[Y[Y.length - 1]],
    params: model.params,
  };
}

/**
 * Predict using an already-trained model without retraining (STATIC mode fast path).
 */
export function predictWithModel(
  candles: { open: number; close: number; high: number; low: number; ts: number }[],
  delta: number,
  params: HMMParams,
): HMMSignal | null {
  const { Y, valid } = buildObservationSequence(candles, delta);
  if (!valid) return null;
  const v = viterbi(Y, params);
  return {
    state: v.lastState,
    label: v.lastState === HiddenState.RISE ? "RISE" : "DROP",
    probability: v.lastProb,
    logLikelihood: v.logProb,
    iterations: 0,
    converged: true,
    obsAtCursor: Y[Y.length - 1],
    obsLabel: OBS_LABELS[Y[Y.length - 1]],
    params,
  };
}

/** Sharpe ratio — thesis eq (2.1) simplified (rf = 0). */
export function sharpeRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(returns.length) : 0;
}

/** Max drawdown of an equity curve. */
export function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}
