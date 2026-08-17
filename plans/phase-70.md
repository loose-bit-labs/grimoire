# Phase 70 — `nvtop -s` as the primary GPU collector (drop-in, cross-vendor)

**Authority:** hierophant, 2026-08-13. **Repo:** grimoire. **Track F (fleet telemetry).**
User wants one cross-vendor GPU source. Scope ruling (user, 2026-08-13): **DROP-IN — same metrics
we emit today, nvtop primary, nvidia-smi/rocm-smi fallback. No new gauges, dashboards untouched.**

## Why

`bin/grim-rig.js` collects GPU metrics through a vendor-specific tangle: `getSmiGpus()`
(nvidia-smi CSV, per-GPU VRAM/util/temp) + `getGpuMetricsFallback()` (rocm-smi **text scraping** —
`parseRocmSmi`, fragile positional "last % is GPU%, second-to-last is VRAM%") + `_amdVramUsedMb`
(computes AMD used-VRAM from a scraped %) + `selectAllComputeGpus` (systeminformation controllers).
The **AMD path is the weak link** and it's exactly what the V620 boxes hit. `nvtop -s` emits
structured JSON for NVIDIA **and** AMD (and Intel) from one tool — parse data, don't regex a TUI
(Rule 13). nvtop 3.3.2 is present on aid (snap).

`nvtop -s` schema (verified on aid 2026-08-13): array of devices, each with string-with-unit fields
`device_name, gpu_clock, mem_clock, temp ("38C"), fan_speed, power_draw, gpu_util ("3%"),
mem_util ("94%")` and — **when the driver exposes them** — bare-numeric-string **byte** fields
`mem_total, mem_used, mem_free` plus a `processes[]` array. **Driver caveat:** some AMD drivers
(the user's V620 sample) return `mem_util` % but **omit** `mem_total/used/free` and null `fan_speed`.

## What lands (grimoire only, drop-in)

- **`parseNvtop(stdout)`** — pure function, JSON.parse + unit-strip. Returns the **same shape as
  `parseSmiGpus`**: `[{ index, memoryTotal, memoryUsed, util, temp, vendor, model }]`, VRAM in **MiB**
  (`bytes / 1048576`, to match nvidia-smi's MiB). Rules:
  - Strip unit suffixes: `gpu_util "0%"→0`, `temp "30C"→30`. Non-numeric/`null` → `null`.
  - VRAM: prefer `mem_used`/`mem_total` bytes → MiB. **If a device gives `mem_util` % but no
    absolute bytes**, set `memoryTotal` from what's available and `memoryUsed = round(total * mem_util/100)`
    (the graceful-degradation path — mirrors `_amdVramUsedMb`); if neither, `memoryUsed=null`.
  - `index` = array position. `model`/`vendor` from `device_name` **only as a hint** — nvtop labels
    generically ("AMD GPU"); rig.json/KB model names stay authoritative for display.
- **`getNvtopGpus()`** — `exec('nvtop -s', {timeout:5000})`, `parseNvtop`, graceful `[]` on
  error/missing binary/unparseable (same contract as `getSmiGpus`).
- **Wire as PRIMARY in `buildSnapshot`** (~L839): try `getNvtopGpus()` first; if it returns ≥1 GPU,
  feed those into `selectAllComputeGpus` in place of `smiGpus` (or bypass to the same per-GPU
  `{vramTotalMb, vramUsedMb, util, temp}` build at L871/L890). **Only if nvtop yields nothing** fall
  back to the existing `getSmiGpus` + rocm/nvidia chain — unchanged. Never regress a box where nvtop
  is absent.

## Out of scope / do NOT

- **No new metrics or gauges** — `gen_gpu_vram_total_mb`/`used`/`util`/`temp` stay exactly as emitted.
  power/clocks/fan/per-process are the "rich" follow-up, explicitly deferred.
- **No dashboard edits.** `/fleet` and `/status` payload shapes unchanged.
- Do **not** remove `getSmiGpus`/`getGpuMetricsFallback`/`parseRocmSmi` — they're the fallback now.
- Do **not** trust nvtop `device_name` for the displayed model.

## Success checks

- `parseNvtop` unit test: (a) full NVIDIA-style device (bytes present) → correct MiB used/total, util,
  temp; (b) AMD-style device (`mem_util` % only, `fan_speed:null`, no byte fields) → used computed from
  %×total, no crash; (c) garbage/empty/non-JSON → `[]`.
- On a box with nvtop: `grim rig serve` `/metrics` emits the same `gen_gpu_*` gauges, now sourced from
  nvtop (verify values track a live load).
- On a box **without** nvtop (simulate: PATH-strip / rename): collector falls back to nvidia-smi/rocm
  and still emits gauges — no regression, no hang.
- Default suite green + self-terminating (see phase 66 — do not add order-coupled or live-service
  dependence; `parseNvtop` tests are pure).

## Coupled / notes

- `setup-client.sh` should ensure `nvtop` on fleet boxes (it's a new dependency; nvidia-smi/rocm-smi
  ship with drivers, nvtop does not). If that's non-trivial per-distro, note it in the report — the
  fallback means missing nvtop is degraded-not-broken, so the install can be a follow-up.
- Ties to the phase-67 auto-onboard work (both touch what a newly-registered box reports); independent
  footprint, land either order.
