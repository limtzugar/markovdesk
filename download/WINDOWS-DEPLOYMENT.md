# Markov Desk — Windows Deployment Guide

Run the HMM × LLM paper-trading bot on your Windows PC for several days, with
the LLM learning from trades via memory + reflection loop.

## Prerequisites

1. **Node.js 20+** — download from https://nodejs.org/ (LTS recommended)
2. **Bun** (optional but faster) — `powershell -c "irm bun.sh/install.ps1 | iex"`
3. **Git** — https://git-scm.com/download/win

## Setup

```powershell
# 1. Clone or copy the project folder
cd C:\Users\YourName\markov-desk

# 2. Install dependencies
bun install
# or: npm install

# 3. Create .env file (see below)
copy .env.example .env
# Edit .env — add your DeepSeek API key if you want DeepSeek reasoning

# 4. Initialize the database
bun run db:push
# or: npx prisma db push

# 5. Start the bot
bun run dev
# or: npm run dev
```

Open http://localhost:3000 in your browser.

## .env file

```env
# Database (SQLite — no setup needed, file is created automatically)
DATABASE_URL="file:./db/custom.db"

# --- LLM Providers (optional) ---
# Default is GLM (via z-ai-web-dev-sdk, no key needed in this sandbox)
# On your own PC, you'll need to set one of these:

# DeepSeek (recommended for trading reflection — deepseek-reasoner uses chain-of-thought)
# Get key: https://platform.deepseek.com/api_keys
DEEPSEEK_API_KEY=sk-your-deepseek-key-here

# OpenAI-compatible (works with OpenAI, OpenRouter, Together, etc.)
# OPENAI_API_KEY=sk-your-openai-key
# OPENAI_BASE_URL=https://api.openai.com/v1
```

## Switching to DeepSeek

Once you have `DEEPSEEK_API_KEY` in `.env`:

1. Open the dashboard at http://localhost:3000
2. Stop the bot if running
3. In the **Bot configuration** panel, click `deepseek` in the LLM provider row
4. (Optional) Set model override via API:
   ```powershell
   curl -X PATCH http://localhost:3000/api/bot/config -H "Content-Type: application/json" -d "{\"llmModel\":\"deepseek-reasoner\"}"
   ```
5. Start the bot

DeepSeek will now be used for both:
- **Signal decisions** (with memory + lessons injected)
- **Reflection loop** (every N closed trades, reviews history and emits lessons)

## Running for several days

### Option A: Keep terminal open
Just leave `bun run dev` running. The SQLite database persists all trades,
memory, lessons, and reflections.

### Option B: Run as Windows service (recommended)
Use `pm2` or `nssm` to keep the bot running even when you log out:

```powershell
# Install pm2
npm install -g pm2

# Start the bot
pm2 start "bun run dev" --name markov-desk

# Save & auto-restart on boot
pm2 save
pm2 startup
```

### Option C: Use Task Scheduler
1. Open Task Scheduler
2. Create Basic Task → "Markov Desk"
3. Trigger: At log on
4. Action: Start a program → `bun.exe` with args `run dev` in your project folder
5. Check "Run whether user is logged on or not"

## Configuring the portfolio

Default symbols: `BTCUSDT,ETHUSDT,SOLUSDT,BTCSOL`

Change via the dashboard header (toggle symbol buttons) or API:

```powershell
curl -X PATCH http://localhost:3000/api/bot/config -H "Content-Type: application/json" -d "{\"symbols\":\"BTCUSDT,ETHUSDT,SOLUSDT,BTCSOL\"}"
```

**BTCSOL** is a synthetic cross-rate (BTC/SOL) computed from BTCUSDT and SOLUSDT.
It has no funding rate. Other synthetic pairs available: `ETHBTC`, `SOLETH`.

## How the LLM learns

The bot has a 3-layer learning system:

### 1. Trade Memory (automatic)
Every closed trade is saved as a `TradeMemory` row with:
- A **feature signature** (RSI, ATR, MA spread, funding, HMM probability, etc.)
- A **digest** string ("BTCUSDT LONG @ $62k, RSI 42, ATR 1.1% → +1.2% WIN")
- **Tags** (oversold, trend-up, high-vol, hmm-strong, etc.)

Before each new LLM decision, the bot finds the top-K most similar past trades
(cosine similarity on the feature signature) and injects them into the prompt:
```
"3 similar past setups found:
 1. [sim 91%] BTCUSDT LONG @ $61.9k, RSI 42... → +1.2% WIN
 2. [sim 85%] BTCUSDT LONG @ $60.2k, RSI 45... → -0.8% LOSS (stop)
 3. [sim 78%] BTCUSDT LONG @ $63.5k, RSI 40... → +2.1% WIN
 Pattern: 2 wins, 1 loss (67% win rate, avg +0.83%)"
```

### 2. Strategy Lessons (reflection loop)
Every `reflectionInterval` closed trades (default 8), the LLM reviews recent
trades and emits structured lessons:

```
Category: PATTERN | RISK | TIMING | OVERRIDE | CONFIRMATION
Severity: INFO | WARNING | CRITICAL
Lesson: "LONG on oversold + HMM RISE won 4/5 times"
SuggestedAction: "increase position size when RSI<30 and HMM p>0.7"
Confidence: 0.0-1.0
```

These lessons are injected into every future LLM decision via the
"ACTIVE STRATEGY LESSONS" section of the prompt.

### 3. Reflection Log (audit trail)
Every reflection session is logged with:
- Number of trades reviewed
- Net PnL
- LLM summary
- Lessons generated
- Raw LLM response

View in the dashboard's "Reflection Log" panel.

## Tuning parameters

In the Bot configuration panel (or via API):

| Parameter | Default | What it does |
|-----------|---------|--------------|
| `reflectionInterval` | 8 | Run reflection every N closed trades |
| `memoryTopK` | 5 | How many similar past trades to inject |
| `llmWeight` | 0.35 | How much LLM can override HMM (0=HMM only, 1=LLM only) |
| `llmProvider` | glm | glm / deepseek / openai |
| `llmModel` | (empty) | Model override (e.g. `deepseek-reasoner`) |
| `trainingWindow` | 200 | HMM training data length (L in thesis) |
| `deltaPct` | 0.0015 | Dead-zone threshold for observable states (∆ in thesis) |
| `stopLossPct` | 0.03 | Hard stop loss per trade |
| `maxDrawdownPct` | 0.15 | Auto-halt if portfolio drawdown exceeds this |

## Monitoring

- **Dashboard**: http://localhost:3000
- **API endpoints**:
  - `GET /api/bot/status` — live snapshot
  - `GET /api/portfolio` — per-symbol breakdown
  - `GET /api/memory?limit=50` — trade memory browser
  - `GET /api/lessons?limit=20` — strategy lessons
  - `GET /api/reflection?limit=10` — reflection sessions
  - `POST /api/reflection` — manually trigger a reflection run
  - `POST /api/bot/start` / `POST /api/bot/stop` — control the bot

## Backup

The SQLite database is at `db/custom.db`. To back up:

```powershell
copy db\custom.db db\custom-backup-$(Get-Date -Format "yyyy-MM-dd").db
```

## Troubleshooting

**Bot not cycling?**
- Check `GET /api/bot/status` — is `running: true`?
- Check the dev server console for errors
- Bybit API may rate-limit — increase the interval

**LLM not learning?**
- Check `GET /api/memory` — are memories being created?
- Check `GET /api/reflection` — are reflections running?
- If using DeepSeek, verify `DEEPSEEK_API_KEY` is set in `.env`

**High memory usage?**
- Reduce `trainingWindow` (default 200)
- Use fewer symbols
- Use a longer interval (60m instead of 15m)

**DeepSeek errors?**
- Verify API key at https://platform.deepseek.com/usage
- DeepSeek reasoner can take 30-60s per call — increase timeout
- Rate limit: 60 req/min on free tier
