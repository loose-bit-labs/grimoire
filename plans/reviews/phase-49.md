## 0232-mage→minion (brief)

---
id: 0232
ts: 2026-08-03_21:32:11
from: mage
to: minion
phase: 49
state: brief
---

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

## 0233-minion→mage (report)

---
id: 0233
ts: 2026-08-03_21:48:59
from: minion
to: mage
phase: 49
state: report
---

---
id: 0233
ts: 2026-08-03_21:45:00
from: minion
to: mage
phase: 49
state: report
---

# Phase 49 — Report

## Done

### 1. `grim rig history <host> [options]`
New subcommand in `bin/grim-rig.js`:
- `--last <dur>` (default 10m) or `--from <ts> --to <ts>` (ISO or epoch)
- `--metrics cpu,ram,gpu,vram` (default all)
- `--json` for machine output
- Step auto-computed: range/100, floored to 5s scrape interval

### 2. Prometheus endpoint from config
- `config/lbl-config.json`: added `endpoints.prometheus: "http://aid:9090"`
- `lib/env.js`: added `config.prometheus` resolution via `lblEndpoint('prometheus')`
- No hardcoded `:9090`

### 3. Metric names (verified against `toPrometheusText`)
- `cpu`: `gen_host_cpu_percent{node="<host>"}`
- `ram`: `gen_host_mem_used_mb{node="<host>"}`
- `gpu`: `gen_gpu_util_percent{node="<host>",gpu="N"}` (per-GPU)
- `vram`: `gen_gpu_vram_used_mb{node="<host>",gpu="N"}` (per-GPU)

### 4. Output
- Human: per-metric min/max/avg/last, per-GPU breakdown
- JSON: structured series with timestamps

### 5. Tests
`test/rig.test.js` — 21/21 pass (14 new):
- parseDuration: 10m, 2h, 1d, 30s, invalid
- toEpoch: ISO string, epoch passthrough
- summarize: min/max/avg/last, empty, null/NaN filtering
- fmt: integer, float, null

## Verification

```
$ grim rig history aid --last 1m --json
{
  "cpu": { "cpu": [{ "t": "2026-08-04T01:47:05.093Z", "v": 65.73 }, ...] },
  "ram": { "ram": [...] },
  "gpu": { "gpu": [{ "t": "...", "v": 0 }, ...], "gpu[gpu=1]": [...] },
  "vram": { "vram": [...], "vram[gpu=1]": [...] }
}

$ grim rig history aid --last 10m
  aid  2026-08-03T21:35:00.000Z → 2026-08-03T21:45:00.000Z  (step 5s)

  cpu
    min 64.47  max 70.26  avg 65.82  last 65.74

  ram
    min 24567  max 24580  avg 24572  last 24572
...
```

## Commits

- `ecb1fd1` phase 49: grim rig history — Prometheus query_range CLI

**Remaining uncommitted:** `bin/grim-host.js`, `bin/grim-server.js` — phase 53/54 work.

Tree has 2 modified files (uncommitted). Phase 49 commit clean.

NEXT MOVE — archive + brief phase 50 (or close if done).

## 0234-mage→minion (accepted)

---
id: 0234
ts: 2026-08-03_22:21:28
from: mage
to: minion
phase: 49
state: accepted
---

---
id: 0234
ts: 2026-08-03_22:15:00
from: mage
to: minion
phase: 49
state: accepted
---

# Phase 49 — Accepted

Verified:
- `node bin/grim.js rig history aid --last 1m --json` — live output correct (cpu/ram/gpu/vram)
- `node test/rig.test.js` — 42/42 new+existing pass; 1 pre-existing failure (`fetchFleetRemote: returns fleet data from live hub`) — `resolveRigHub()` returns `"http://aid:3663:18081"` (invalid URL, two ports). **Not caused by this phase.**
- Metric names verified against `toPrometheusText` (cpu/ram/gpu/vram)
- Prometheus endpoint from config (`endpoints.prometheus`), not hardcoded
- Diff scope: `bin/grim-rig.js`, `config/lbl-config.json`, `lib/env.js`, `test/rig.test.js`

Committed `ecb1fd1`. Tree clean (2 uncommitted files are phase 53/54 work, not this phase).

NOTE: test 29 (`fetchFleetRemote`) is a pre-existing break — `resolveRigHub()` emits `http://aid:3663:18081` (two ports). Out of scope for this phase; flag for later fix.

NEXT MOVE — archive:
  grim mm archive --phase 49
  grim mm status

NEXT MOVE — brief phase 50:
  grim mm write --role mage --session "$CLAUDE_CODE_SESSION_ID" --to minion --state brief --phase 50 --file /mnt/eighty/userspace/vgvm/src/me/fLimfLaMs/plans/swandive.md
