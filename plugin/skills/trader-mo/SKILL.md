---
name: trader-mo
description: Run the trader-mo sentiment-dip + catalyst scanner — screen for S&P500 droppers, run full signal pipeline (price/volume/sentiment/fundamentals), show raw news being picked up, explain a ticker's gate results, or start the polling watch loop. Use when the user asks to scan for dip-buying signals, check what the market is doing, see what news is surfacing, or investigate why a specific ticker was/wasn't surfaced.
version: 1.1
allowed-tools: Bash, Read
---

# TRADER-MO

Sentiment-dip + catalyst entry-signal scanner. Screens for stocks selling off on noise (buy the panic) AND bullish catalysts not yet priced in (buy before the move). Tells you what to look at; you decide.

## Arguments

Optional: ticker symbol for `explain` command (e.g. `TSLA`)

## Morning routine

```bash
cd /Users/vgvm/src/me/trader-mo
bash run-me-val.sh
```

Runs in order: purge stale cache → warm cache (~2 min) → news snapshot → full scan → flag outcomes.

## Commands

All commands run from `/Users/vgvm/src/me/trader-mo`:

```bash
# Cheap daily screen — ranks S&P500 by drop, no LLM
node src/index.js screen

# Raw news snapshot — what sources are picking up right now, grouped by ticker
# No gating, no LLM, no candles — pure signal visibility
node src/index.js news

# Full pipeline — screen + news + LLM sentiment + fundamental check
# Shows: dip candidates, catalyst candidates, evaluated tickers with gate rationale + headlines
node src/index.js scan

# With threshold overrides
node src/index.js scan --dip 6 --screen 4

# Polling loop (Ctrl+C to stop)
node src/index.js watch

# Explain why a ticker was/wasn't a candidate (reads latest scan log)
node src/index.js explain TSLA
```

## Environment

- Requires `FINNHUB_TOKEN` in `.env`
- Local LLM endpoint resolved from `~/.config/lbl-config.json` (`use.openai` → named endpoint)
- AV key at `~/.local/share/api-keys/alphavantage.key` (optional, fallback for candles)

## Discovery Lanes

| Lane | Source | Price gate |
|------|--------|-----------|
| A — Screener | S&P500 daily drops | Hard ≥5% from 30d high |
| B — News-first | GDELT + Finnhub news + Reddit + Google News | Soft ≥3% floor |
| C — Watchlist | `config/watchlist.json` | Hard ≥5% from 30d high |
| D — Catalyst | News-lane tickers only | <8% above 30d low (hasn't run yet) + bullish direction + early maturity |

## Output

`scan` shows:
1. Ranked dip candidates with sentiment classification + summary
2. Catalyst Signals section — bullish pre-rise candidates not yet priced in
3. "Evaluated N ticker(s)" section — every filtered ticker with gate rationale (✓/✗) + triggering headlines

## Config

- `config/tuning.json` — `dipPct` (5), `volMult` (1.5), `topN` (15), `catalystRunPct` (8), `catalystMaturities`
- `config/watchlist.json` — conviction tickers always evaluated (28 tickers)
- `config/entities.json` — entity → ticker mapping for news lane (24 entities)
- `config/universe.json` — S&P500 screener universe (50 tickers)
- `config/sectors.json` — GICS sector → ticker map for spillover fan-out

## Rules

- Run `scan` not `screen` when you want the full signal — screen is just the cheap first pass
- Run `news` first if the scan is empty — it shows whether news sources are firing at all
- On holidays/weekends Yahoo returns null candle data; `CandleProvider` now rejects null values and falls through to AV → Stooq
- Purge today's bad candle cache before scanning: `find cache/candles -name "*$(date +%Y-%m-%d)*" -delete`
- `explain` reads the **latest** scan log — run `scan` first if the log is stale
- Candidates with `[FLAGGED]` have broken fundamentals but still passed gates — manual review required
- No orders are placed — this is a signal surface tool only
