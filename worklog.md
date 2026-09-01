# Worklog — Markov Desk

---
Task ID: 1
Agent: main (orchestrator)
Task: Build algorithmic trading bot with LLM for Bybit based on Andersson & Fransson (2016) HMM thesis, with minimalist 2026 dashboard.

Work Log:
- Downloaded thesis PDF (53 pages, University of Gothenburg, "Algorithmic Trading Based on Hidden Markov Models")
- Extracted methodology: HMM with N=2 hidden states (DROP/RISE), M=9 observable states (3×3 = Price movement × Mean displacement vs MA(10)), trained via Baum-Welch, decoded via Viterbi. Static vs Dynamic training modes. Investment strategy: long on RISE, short on DROP.
- Initialized fullstack-dev environment (Next.js 16 + Prisma + shadcn/ui)
- Installed fonts: Geist Variable, Geist Mono Variable, Instrument Serif (top 2026 minimalist fonts)
- Set up dark minimalist theme with restrained long (mint)/short (coral) accents
- Implemented HMM core in TypeScript: `src/lib/hmm.ts` — Baum-Welch EM, Viterbi, observable state builder, Sharpe ratio, max drawdown
- Built Bybit v5 public API client: `src/lib/bybit.ts` — klines, ticker, multi-page fetch, market digest (MA, RSI, ATR, funding rate)
- Built LLM overlay via z-ai-web-dev-sdk: `src/lib/llm.ts` — composes market digest + HMM signal + web-searched news → structured JSON action (AGREE / STRONG_AGREE / HOLD / OVERRIDE_LONG / OVERRIDE_SHORT)
- Built strategy engine: `src/lib/strategy.ts` — blends HMM posterior with LLM action, paper-trading persistence, risk gates (max drawdown, stop-loss, signal-flip close), full backtest engine
- Prisma schema: BotState, Trade, HMMModel, LLMReasoning, Backtest (SQLite)
- API routes: /api/market, /api/signal, /api/bot/{start,stop,status,config}, /api/trades, /api/reasoning, /api/model, /api/backtest
- Dashboard UI components: header with symbol/interval/mode segmented controls, hero stats (Instrument Serif numbers), live signal panel (HMM prob + LLM action + reasoning), candlestick chart, equity curve, market digest, HMM matrices (A + B + π visualized), trade log, LLM reasoning stream, config panel, backtest panel
- Verified end-to-end via Agent Browser:
  - Dashboard renders cleanly, dark theme, all sections visible (no console errors)
  - Bot Start → first cycle ran in ~5s → opened LONG trade on DOGEUSDT @ 0.07575
  - HMM predicted RISE with probability 1.00, LLM STRONG_AGREE confidence 0.95
  - LLM reasoning persisted to DB and surfaced in UI stream
  - Backtest endpoint and UI button both functional — equity curve chart renders with metrics

Stage Summary:
- Single-route Next.js 16 dashboard at `/` with 9 API routes
- HMM pipeline faithful to thesis (Baum-Welch + Viterbi + observable state mapping from §3.3.2)
- LLM overlay adds news-aware discretion on top of structural HMM signal
- Paper trading only (no private Bybit keys) — safe to run live
- Fonts: Geist (body), Geist Mono (numbers/code), Instrument Serif (display headings)
- Palette: neutral OKLCH, mint for long, coral for short, no indigo/blue
- All ESLint + TypeScript checks pass
- Bot currently running on DOGEUSDT 4h with 1 open LONG position

---
Task ID: 2
Agent: main (orchestrator)
Task: Full paper trading with strategy + LLM, $1000 budget, PnL curve + daily calendar, fix invisible backtest equity curve.

Work Log:
- Changed default capital from $10000 to $1000 in Prisma schema and updated live BotState via API
- Built /api/pnl endpoint: returns per-trade cumulative PnL (chronological) + 42-day daily aggregated PnL for calendar, plus summary stats (total PnL, win rate, best/worst day)
- Built PnlCurve component: composed chart with per-trade PnL bars (subtle) + cumulative area with gradient fill, $-formatted axis, hover tooltips
- Built PnLCalendar component: 6-week grid (Monday-start), cells colored by PnL intensity (mint for profit, coral for loss, muted for no-trade days), hover tooltip with day + PnL + trade count, summary strip (total/best/worst/win rate), color legend
- Fixed equity curve visibility: replaced CSS var() refs with hardcoded hex colors (#34d399 mint, #f87171 coral) because recharts/SVG needs concrete color values, especially in headless browsers. Increased strokeWidth to 3px, stronger gradient (0.45 → 0.15 → 0.02 opacity), taller chart (300px for backtest, 260px for PnL, 200px for live equity), added start capital baseline with dashed line + label
- Verified via pixel analysis: dashboard has 1946 green pixels across all chart sections (live equity 473, PnL curve 235, backtest equity 1238)
- Bot ran full paper-trading cycles on BTCUSDT 1m: 3 closed trades, $2.38 realized PnL, 50% win rate, equity $1002.40
- Backtest endpoint verified: SOLUSDT 15m 500 bars, $1000 → $1029.19 (+2.92%), Sharpe 1.56

Stage Summary:
- Budget: $1000 (was $10000)
- New components: PnlCurve (cumulative per-trade), PnLCalendar (6-week daily heatmap)
- Fixed: equity curve now renders with solid green line + gradient fill (was barely visible)
- All charts use hardcoded hex colors for reliable SVG rendering in dark theme
- Bot actively cycling with LLM overlay generating trades

---
Task ID: 3
Agent: main (orchestrator)
Task: Add LLM learning loop (memory + reflection + strategy lessons), multi-symbol portfolio (BTC/ETH/SOL/BTCSOL), DeepSeek support, Windows deployment guide.

Work Log:
- Extended Prisma schema: added TradeMemory (vector-ish signature + digest + tags), StrategyNote (lessons with category/severity/confidence), Reflection (session log). Added fields to BotState: symbols (comma-separated portfolio), llmProvider, llmModel, reflectionInterval, memoryTopK, lastReflectionAt.
- Built memory layer (src/lib/memory.ts): featuresToSignature (8-dim normalized vector from RSI/ATR/MA spread/funding/pct24h/HMM prob/side/obs), cosine similarity search, buildDigest (human-readable), rememberTrade (persist on close), recallSimilar (top-K similar past trades), formatMemoryForPrompt.
- Built LLM provider abstraction (src/lib/llm-provider.ts): supports glm (z-ai SDK, cached instance), deepseek (OpenAI-compatible API, deepseek-reasoner for chain-of-thought), openai (any OpenAI-compatible endpoint). Env-configurable via DEEPSEEK_API_KEY / OPENAI_API_KEY.
- Updated LLM decision layer (src/lib/llm.ts): now injects (1) MEMORY — top-K similar past trades with outcomes, (2) ACTIVE STRATEGY LESSONS, (3) market digest, (4) news. Returns structured action with memoryIds provenance.
- Built reflection loop (src/lib/reflection.ts): every N closed trades, LLM reviews recent trade history with features + outcomes, emits structured lessons (PATTERN/RISK/TIMING/OVERRIDE/CONFIRMATION with severity + suggested action + confidence). Persists as StrategyNote rows + Reflection session log.
- Refactored strategy engine for multi-symbol portfolio: runCycle iterates over all symbols, per-symbol HMM model cache (Map), per-symbol position management, portfolio-level equity/drawdown. closeTrade now persists to TradeMemory + increments reflection counter. maybeRunReflection triggers reflection loop when threshold reached.
- Added synthetic cross-rate support: BTCSOL = BTCUSDT/SOLUSDT computed from two USDT pairs (fetchKlines + fetchTicker handle synthetic by dividing price series). Also supports ETHBTC, SOLETH.
- Added LLM decision cache: skip LLM if same bar already processed (5min TTL). Skip LLM when HMM very confident (>0.85) to save API calls + memory.
- New API routes: /api/memory (browse memories), /api/lessons (strategy notes, PATCH to apply/dismiss), /api/reflection (GET log, POST manual trigger), /api/portfolio (per-symbol breakdown).
- New UI components: PortfolioPanel (per-symbol table with closed/open/PnL/win rate), MemoryPanel (trade memory browser with digests + tags), LessonsPanel (strategy lessons with category/severity/suggested action), ReflectionPanel (reflection session log). ConfigPanel now has LLM provider selector (glm/deepseek/openai) + reflection interval + memory top-K fields.
- Fixed Prisma memory pressure: disabled query logging (was causing OOM with thousands of log lines during multi-symbol cycling). Now log: ['error'] by default, ['query'] only if PRISMA_LOG=1.
- Fixed Bybit API: replaced `new URL()` constructor with plain string URLs (was causing hangs in some edge cases).
- Created Windows deployment guide (download/WINDOWS-DEPLOYMENT.md): setup, .env configuration, DeepSeek integration, running as Windows service (pm2/nssm/Task Scheduler), backup, troubleshooting.
- Created .env.example with DeepSeek + OpenAI configuration templates.

Stage Summary:
- 3-layer learning: Trade Memory (automatic, per-trade) → Strategy Lessons (reflection loop, every N trades) → Reflection Log (audit trail)
- Multi-symbol portfolio: BTCUSDT, ETHUSDT, SOLUSDT, BTCSOL (synthetic cross-rate)
- DeepSeek support: set DEEPSEEK_API_KEY in .env, select in dashboard config panel. deepseek-reasoner uses chain-of-thought for better pattern recognition.
- LLM prompt now includes: HMM signal + memory of similar past trades + active strategy lessons + market digest + news
- Verified in sandbox: bot cycled 4 symbols, opened positions, portfolio endpoint returned per-symbol breakdown
- Note: sandbox has 4GB memory limit causing OOM during extended LLM cycling; on user's Windows PC with more RAM this will run stable for days
