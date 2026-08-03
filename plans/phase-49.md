# Phase 49 — `grim rig history`: query a host's telemetry over a time range

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. **Track F** (telemetry).
User-requested: "view telemetry for a host for a range of time — aid cpu/ram + gpu/vram from
TS1 to TS2, or the last 10m." The data exists; the query verb doesn't.

## Context (what exists)

- **Prometheus** (`:9090`, up) already stores the series — `grim rig serve` exposes `/metrics`
  (`toPrometheusText`, `bin/grim-rig.js:909`) scraped every 5s. Confirmed live:
  `gen_gpu_vram_used_mb`, `gen_gpu_util_percent`, etc., labeled by `node` and `gpu`.
- Grafana visualizes it, but there is **no CLI**: `grim rig status` is live-only (fans out
  `/status`); nothing queries Prometheus range data.

## What lands

`grim rig history <host> [options]` — a PromQL `query_range` reader that prints a host's
telemetry over a window.

- **Time window:** `--last <dur>` (e.g. `10m`, `2h`) **or** `--from <ts> --to <ts>` (ISO or
  epoch). Default `--last 10m`. Pick a sensible `step` from the range (e.g. range/100, floored
  to the 5s scrape interval).
- **Metrics:** `--metrics cpu,ram,gpu,vram` (default all). Map each to its Prometheus series:
  - gpu = `gen_gpu_util_percent{node="<host>"}`, vram =
    `gen_gpu_vram_used_mb / gen_gpu_vram_total_mb * 100{node="<host>"}` (per-GPU via the `gpu`
    label — show each GPU on multi-GPU hosts like chonko).
  - cpu / ram = the corresponding rig-serve host metrics — **read the actual metric names from
    `toPrometheusText` in `bin/grim-rig.js`** (don't guess; use what's emitted).
- **Output:** a compact per-metric summary — min / max / avg (and last) over the window, per
  GPU where relevant. A tiny ASCII sparkline per series is a nice-to-have, not required.
  `--json` for machine use.
- **Prometheus endpoint from config**, not hardcoded: add `endpoints.prometheus`
  (`http://aid:9090`) to `config/lbl-config.json` and resolve via `lib/env`; do not hardcode
  `:9090`. Graceful if Prometheus is unreachable (clear message, no hang — use a timeout).

## Out of scope / do NOT

- No new scraping/retention config; no Grafana changes. This is a read-only query over existing
  Prometheus data.
- Don't hardcode the Prometheus URL or metric names — resolve the URL from config, read metric
  names from the emitter.

## Success checks

- `grim rig history aid --last 10m` prints aid's cpu/ram/gpu/vram summary over the last 10 min.
- `grim rig history chonko --from <ts> --to <ts> --metrics gpu,vram` shows **per-GPU** series
  for chonko's two GPUs across the range.
- `--json` returns structured series. Prometheus down → graceful error, no hang.
- Metric names verified against `toPrometheusText` (no guessed names). Endpoint from config.
- Test: window/step parsing, PromQL URL construction, summary math (mock a `query_range` response).
- Footprint: `bin/grim-rig.js` (new `history` subcommand + PromQL client), `config/lbl-config.json`
  (+ `endpoints.prometheus`), help text, test, KB note.
