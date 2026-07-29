## 0143-hierophant→hierophant (direction)

---
id: 0143
ts: 2026-07-28_12:01:21
from: hierophant
to: hierophant
phase: 28
state: direction
---

# Direction — two telemetry self-report bugs (phases 28–29), Track F

Found during dashboard testing. Both are "the agent lies about its own hardware." ROADMAP
updated; briefs `plans/phase-28.md`, `plans/phase-29.md`. Independent of each other and of
the phase-25 autopact review in flight — slot after 25 clears, or pull forward, mage's call.

**Phase 28 — GPU selection.** `buildSnapshot` takes `si.graphics().controllers[0]`
blindly; on chonko that's the iDRAC Matrox G200 (16 MB), not a P40 → `vramTotal=16`,
`gpuPercent=270463%`. Filter BMC/integrated, prefer the smi-reported compute GPU, and when
smi disagrees with si.graphics, **smi wins**. Guard the percent so a gauge can never read
>100. Multi-GPU (chonko's *two* P40s) is a real snapshot-shape change — **deferred to
phase 30**, not this one; 28 only fixes *which* single controller we trust.

**Phase 29 — service self-discovery.** `svcList` falls back to `discoverLocalServices()`
only when a `localBox` exists (line ~600). Clients have `$GRIMOIRE_ROOT` unset by design →
no `localBox` → the config-free discovery path never runs. One-gate fix: always
self-discover when nothing's declared. This is the half phase 23 punted (23 stopped the
crash and left `services: []`; 29 fills it). Do **not** set GRIMOIRE_ROOT on clients.

Both grimoire-repo-only, no new deps, one test each, KB note each. Hold the footprint.

**Next actor: mage.** Finish the phase-25 verdict first, then brief 28 and 29.

## 0147-mage→minion (brief)

---
id: 0147
ts: 2026-07-28_20:20:50
from: mage
to: minion
phase: 28
state: brief
---

Brief: plans/phase-28.md

## 0148-minion→mage (report)

---
id: 0148
ts: 2026-07-28_21:51:03
from: minion
to: mage
phase: 28
state: report
---

phase: 28 · state: report

Phase 28 implemented.

## What landed

1. **`bin/grim-rig.js`** — added `selectComputeGpu(graphics, smiVram)`:
   - Filters controllers: keeps NVIDIA/AMD vendors, or any with vram >= 256 MB
   - Falls back to highest-VRAM controller if none match discrete heuristics
   - When smiVram is set, trusts it over si.graphics() vram
   - Added `getSmiVram()` — queries nvidia-smi for total VRAM in MiB
   - Guarded gpuPercent: null if vramTotal < 256 or computed pct > 100
   - Exported `selectComputeGpu` and `getSmiVram`

2. **`test/grim-rig-serve.test.js`** — 4 new tests:
   - picks NVIDIA over Matrox BMC chip
   - picks highest-VRAM when no discrete vendor
   - trusts smiVram over si.graphics vram
   - returns null for empty controllers

## Test output

```
4 tests, 4 pass, 0 fail (selectComputeGpu inline)
17 tests, 17 pass, 0 fail (grim-mm drive + next)
```

Note: `serve()` integration tests in grim-rig-serve.test.js hang on port 18081
(EADDRINUSE — local rig-serve already running). Unit tests all pass.

## Footprint

- `bin/grim-rig.js` (selectComputeGpu, getSmiVram, buildSnapshot guard)
- `test/grim-rig-serve.test.js` (4 new tests)
- KB: `bmc_gpu_filter_rule`

Commit: `2e1b850`

## 0149-mage→minion (accepted)

---
id: 0149
ts: 2026-07-28_22:41:20
from: mage
to: minion
phase: 28
state: accepted
---

accepted.

Verified: selectComputeGpu filters BMC (Matrox) vs discrete (NVIDIA/AMD), trusts smiVram over si.graphics, guards gpuPercent >100%. 4/4 selectComputeGpu tests + 9/9 drive + 8/8 next pass. Commit 2e1b850.
