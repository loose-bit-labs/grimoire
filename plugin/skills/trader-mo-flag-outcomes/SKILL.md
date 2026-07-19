---
name: trader-mo-flag-outcomes
description: Run the trader-mo reversion calibration report — reads logs/flags.jsonl and backfills +5/+10 day returns to show whether flagged candidates actually reverted. Use after accumulating ~5+ trading days of scan data to validate the thesis by maturity × timeToImpact bucket.
version: 1.0
allowed-tools: Bash
---

# TRADER-MO FLAG OUTCOMES

Reversion calibration tool. Reads every candidate the scanner flagged, fetches what the price did 5 and 10 trading days later, and reports mean return + hit rate by (maturity × timeToImpact) bucket. This is how you know whether the thesis is working.

## Arguments

None.

## Instructions

1. `cd /Users/vgvm/src/me/trader-mo` — required, paths are CWD-relative

2. **Check if you have enough data:**
   ```bash
   wc -l logs/flags.jsonl
   ```
   Need at least ~10 rows (a few candidates across a few trading days) for meaningful stats.

3. **Run the calibration:**
   ```bash
   node bin/flag-outcomes.js
   ```
   Output: one row per (maturity × timeToImpact) bucket showing:
   - `n` — sample count
   - `avg5d` / `avg10d` — mean return at +5 and +10 trading days
   - `hit5d` / `hit10d` — % of candidates that were positive at that horizon

4. **Interpret:**
   - `rumor×years` with positive avg5d = early-stage noise dips reverting quickly ✓
   - `reported×immediate` with negative avg = real fundamental moves, scanner correctly flagging
   - Low sample counts (<5) mean the bucket isn't statistically meaningful yet

## How flags accumulate

Every time `node src/index.js scan` surfaces a candidate that passes all gates, it appends one row to `logs/flags.jsonl`:
```json
{"ticker":"MU","date":"2026-07-07","dipPct":6.2,"sentiment":"noise-driven","maturity":"research","timeToImpact":"quarters","score":0.74,"priceAtFlag":89.50}
```

The outcomes script fetches candles covering `flagDate + 15 calendar days` and computes returns from `priceAtFlag`.

## Rules

- Needs at least 5 trading days of data before the stats mean anything — don't over-interpret early results
- `no_data` candles (Yahoo 403, holiday) silently skip that row — small n is expected early on
- `priceAtFlag` is the live quote if available at scan time, else yesterday's close — small bias on holiday scans
- Run this weekly, not daily — the +10d window needs time to close
