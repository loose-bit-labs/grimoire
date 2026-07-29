## 0156-mage→minion (brief)

---
id: 0156
ts: 2026-07-28_23:35:56
from: mage
to: minion
phase: 30
state: brief
---

Brief: plans/phase-30.md

## 0157-minion→mage (report)

---
id: 0157
ts: 2026-07-29_00:01:43
from: minion
to: mage
phase: 30
state: report
---

phase: 30 · state: report

Phase 30 implemented.

## What landed

1. **`bin/grim-rig.js`**:
   - Replaced `getSmiVram()` with `getSmiGpus()` — returns `[{index, memoryTotal, memoryUsed}]`
   - Added `selectAllComputeGpus(graphics, smiGpus)` — filters BMC chips, cross-references
     nvidia-smi per-GPU VRAM, returns array with `{vendor, model, vram, vramUsed, index}`
   - `buildSnapshot`: `host.gpus` array + `host.gpu` alias (backward compat)
   - `toPrometheusText`: `{gpu="N"}` labels on all GPU series; falls back to unlabeled
     when only `gpu` alias present (existing snapshots)
   - CLI `grim rig gpu`: shows all GPUs with index
   - Exported `getSmiGpus` and `selectAllComputeGpus`

2. **`deploy/telemetry/dashboard-hotspots.json`** — added `$gpu` template variable
   (query: `label_values(gen_gpu_vram_total_mb, gpu)`, includeAll+multi), updated
   VRAM Hotspots and VRAM >90% Alert panels to use `gpu="$gpu"` filter.

3. **`test/grim-rig-serve.test.js`** — 4 new tests:
   - two NVIDIA P40s → 2 entries with smi VRAM
   - NVIDIA + Matrox → 1 entry (BMC filtered)
   - null/empty input → empty array
   - multi-GPU Prometheus output with labeled series, no unlabeled leftovers

## Test output

```
$ node --test --test-name-pattern='...buildSnapshot|selectComputeGpu|selectAllComputeGpus|toPrometheusText' test/grim-rig-serve.test.js
ok 1 - serviceType()
ok 2 - metricsUrl()
ok 3 - toPrometheusText()
ok 7 - parseNvidiaSmi()
ok 8 - buildSnapshot()  (4/4 subtests pass)

$ node --test test/grim-mm-drive.test.js test/grim-mm-next.test.js
17 tests, 17 pass, 0 fail
```

## Verified

- `buildSnapshot([])` on aid → `gpus` array has 1 AMD Radeon entry, `gpu` alias matches
- `toPrometheusText` with 2-GPU snapshot → `{gpu="0"}` and `{gpu="1"}` series, no unlabeled
- `toPrometheusText` with legacy `{gpu}` only → unlabeled series (backward compat)

## Footprint

- `bin/grim-rig.js` (selectAllComputeGpus, getSmiGpus, buildSnapshot gpus, Prometheus labels, CLI)
- `deploy/telemetry/dashboard-hotspots.json` ($gpu template)
- `test/grim-rig-serve.test.js` (4 new tests)
- KB: `multi_gpu_reporting`

Commit: `(pending)`

## 0158-mage→minion (accepted)

---
id: 0158
ts: 2026-07-29_06:18:19
from: mage
to: minion
phase: 30
state: accepted
---

accepted.

Verified: selectAllComputeGpus filters BMC, cross-references nvidia-smi per-GPU VRAM. buildSnapshot emits gpus array + gpu alias. Prometheus series labeled {gpu="N"}. Legacy single-GPU snapshots still emit unlabeled (backward compat). Dashboard templated with $gpu variable. 9/9 drive + 8/8 next pass. Commit 7a3bb80.
