---
name: trader-mo-warm-cache
description: Pre-warm the trader-mo candle/metrics cache before a scan to avoid Yahoo Finance rate-limit 403s. Run once before market open (--once) or leave running as a background daemon. Use when scans are showing mass "candles 403 degraded" failures or before an important scan session.
version: 1.1
allowed-tools: Bash
---

# TRADER-MO CACHE WARMER

Background daemon that cycles through all watchlist + universe tickers with a large inter-request delay, keeping the candle + metrics cache warm so live scans hit cache instead of hitting Yahoo Finance cold.

## Arguments

Optional: `--delay N` (ms between tickers, default 3000), `--cycle-delay N` (ms between full cycles in loop mode, default 1h), `--once` (one cycle then exit)

## Instructions

1. `cd /Users/vgvm/src/me/trader-mo` — **required**: all paths (`config/`, `cache/candles/`) are CWD-relative

2. **One-shot warm before a scan:**
   ```bash
   node bin/warm-cache.js --once --delay 2000
   ```
   Fetches candles + metrics for all tickers (watchlist ∪ universe) then exits. At 2s delay ≈ ~2–3 minutes total.

3. **Background daemon (keeps cache fresh all day):**
   ```bash
   node bin/warm-cache.js --delay 3000 &
   ```
   Loops with a 1h pause between cycles (`--cycle-delay` to change). Warmed tickers are free cache hits on re-check; only failed (uncached) tickers retry. Cache files are date-stamped so yesterday's cache is ignored automatically. Ticker list is re-read each cycle, so watchlist/universe edits apply without restart.

4. **After warming, run scan normally:**
   ```bash
   node src/index.js scan
   ```
   Should show no `403 degraded` failures — most tickers hit cache.

## How it works

- Loads all tickers from `config/watchlist.json` ∪ `config/universe.json` (deduped)
- For each ticker: fetches candles (**30d lookback — must match SignalEngine's window**; the cache key ignores the date range, so whatever range the warmer caches is what the scan's `dipFrom30dHigh` computes over) + metrics via CandleProvider
- CandleProvider uses Yahoo Finance first, AlphaVantage fallback (if `~/.local/share/api-keys/alphavantage.key` exists)
- Both candles and metrics land in `cache/candles/` (the endpoint is in the filename: `TICKER-candles-DATE.json`, `TICKER-metrics-DATE.json`)
- CandleProvider gets `candleDelayMs = delay/2`, spacing the candles→metrics pair within a ticker; `--delay` paces between tickers

## Rules

- Set `--delay` to at least 1500ms for Yahoo Finance — lower risks triggering the same 403s
- Cache is date-stamped (`ticker-candles-YYYY-MM-DD.json`) — run the warmer on the same calendar day as the scan
- AV key at `~/.local/share/api-keys/alphavantage.key` is picked up automatically — no config needed
- The warmer logs one line per ticker: `[warm-cache] TSLA  candles=ok  metrics=ok`
- A Yahoo 429/403 shows as `candles=no_data` (providers fail soft), not as an error line — mass `no_data` means you're currently rate-limited; wait and rerun
- Known tension: pre-market warming pins the dip gate's "current price" at yesterday's close for the day (Phase 27 fixes this with quote-based current price)
