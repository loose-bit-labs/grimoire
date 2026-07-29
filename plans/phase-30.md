# Phase 30 — multi-GPU reporting (Track F)

**Authority:** mage, 2026-07-28. **Repo:** grimoire only. Track F.
**Depends on phase 28.** Chonko has two Tesla P40s; `buildSnapshot` currently reports a single GPU, silently dropping the second.

## Ruling

Report all compute GPUs as an array in the snapshot. Each GPU gets its own Prometheus series with a `gpu` label. The dashboard repeats gauges across GPUs.

Phase 28 fixed *which* single GPU we trust. This phase reports *all* of them.

## What lands

1. **`bin/grim-rig.js` — `buildSnapshot` GPU array.**
   - `selectComputeGpu` returns a single controller (unchanged).
   - `buildSnapshot` collects *all* discrete controllers via a new `selectAllComputeGpus(graphics, smiData)` helper:
     - Same BMC filter as phase 28 (NVIDIA/AMD vendor, or vram >= 256 MB).
     - For NVIDIA: cross-reference with nvidia-smi output to get per-GPU `memory.total` and `memory.used`. Match by index (smi returns ordered array; `si.graphics().controllers[i]` aligns).
     - For AMD/other: use `si.graphics().controllers[i].vram` / `memoryUsed`.
   - Snapshot shape change: `host.gpu` becomes `host.gpus` — an array of `{ vendor, model, vramTotalMb, vramUsedMb, gpuPercent, tempC, index }`.
   - `host.gpu` retained as alias to `gpus[0]` for backward compat with existing consumers during transition.
   - `getSmiVram()` becomes `getSmiGpus()` — returns `[{ index, memoryTotal, memoryUsed }]` or `[]`.

2. **`bin/grim-rig.js` — Prometheus metrics.**
   - `gen_gpu_vram_total_mb`, `gen_gpu_vram_used_mb`, `gen_gpu_util_percent`, `gen_gpu_temp_c` all gain a `{gpu="0"}`, `{gpu="1"}` label.
   - Old unlabeled series removed (or kept as sum — prefer labeled-only, cleaner).

3. **Dashboard — repeat GPU panels across GPUs.**
   - Grafana panel templates use `{{gpu}}` variable populated from `label_values(gen_gpu_vram_total_mb, gpu)`.
   - VRAM gauge, util gauge, temp gauge all templated.
   - Existing single-GPU panels replaced with templated versions.

4. **Tests.**
   - `selectAllComputeGpus` with two NVIDIA P40s → 2 entries, VRAM from smi.
   - `selectAllComputeGpus` with one NVIDIA + one Matrox → 1 entry (BMC filtered).
   - `toPrometheusText` with 2 GPUs → labeled series for both.
   - Backward-compat: `snapshot.host.gpu` still points to `gpus[0]`.

5. **KB.** `concept_multi_gpu_reporting` (DefinedTerm, works_on project_grimoire).

## Out of scope / do NOT

- No changes to `selectComputeGpu` (phase 28 already correct for single-GPU path).
- No changes to service metrics, host CPU/mem/disk.
- No changes to fleet aggregation (`getFleet`) — already per-box, unaffected.
- No dashboard UI polish beyond templating — this is telemetry correctness, not aesthetics.

## Success checks (mage runs these)

- `curl localhost:18081/status` on chonko → `gpus` array has 2 entries, both P40, correct VRAM.
- `curl localhost:18081/metrics` → `gen_gpu_vram_total_mb{node="chonko",gpu="0"}` and `{gpu="1"}` both present.
- `curl localhost:18081/metrics` → no unlabeled `gen_gpu_*` series.
- Aid (single Radeon) → `gpus` array has 1 entry.
- `snapshot.host.gpu` still resolves to first GPU (backward compat).
- 17/17 grim-mm tests still pass; grim-rig-serve tests pass.

## Footprint

- `bin/grim-rig.js` (selectAllComputeGpus, getSmiGpus, buildSnapshot gpus array, Prometheus labels)
- `deploy/telemetry/grafana-dashboards/` (templated GPU panels — or inline JSON if that's the convention)
- `test/grim-rig-serve.test.js` (3-4 new tests)
- KB: `concept_multi_gpu_reporting`
