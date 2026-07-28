# Phase 28 — agent picks the real compute GPU, not the BMC display chip

**Authority:** hierophant, 2026-07-28. **Repo:** grimoire only. Track F.
Live bug found during dashboard testing. Independent of phase 29.

## The bug (confirmed against remember log + code)

`bin/grim-rig.js` `buildSnapshot` (~line 640–646):
```
const graphics = await si.graphics()...
if (graphics && graphics.controllers && graphics.controllers.length > 0) {
  gpuInfo = graphics.controllers[0]   // <-- blindly index 0
}
```
On chonko, `controllers[0]` is the Dell iDRAC/BMC **Matrox G200eW3** (~16 MB VRAM),
not either **Tesla P40**. Downstream:
- `vramTotalMb` = 16 (line ~679) — wrong, should be 24576.
- `gpuPercent` = `computeApps usedMiB ÷ gpuInfo.vram * 100` (line ~681–682) → real
  llama-server usage ÷ 16 MB = **270463 %**. The bogus denominator poisons the gauge.

## What lands

1. **Select the real compute GPU, not index 0.** Filter `graphics.controllers` to drop
   BMC/integrated display chips before picking. Robust, cheap heuristics (combine, don't
   rely on one):
   - vendor is NVIDIA or AMD (drop Matrox, ASPEED, Intel iGPU when a discrete card is
     present);
   - drop any controller whose `vram` is implausibly small for compute (e.g. `< 256` MB) —
     a BMC display chip is ~16–64 MB;
   - prefer the controller that the nvidia-smi/rocm-smi fallback (already gathered, line
     ~650) actually reports, since that path only sees real compute GPUs. If smi returned
     a GPU, trust its VRAM total over `si.graphics()`.
2. **When smi and si.graphics disagree, smi wins** for `vramTotalMb`/`vramUsedMb` — it's
   the compute-truth source; `si.graphics()` is only a vendor/model label fallback.
3. **Guard the percent math**: if the chosen `vramTotal` is missing or absurd, emit
   `gpuPercent: null` rather than a >100 % number. A gauge should never read 270463.

## Out of scope / do NOT (noted for a follow-on, not this phase)

- **Multi-GPU reporting** (chonko has *two* P40s; snapshot currently carries a single
  `gpu`). Reporting *both* means an array in the snapshot + per-GPU Prometheus labels +
  dashboard repeat — that's a **separate phase (propose 30)**. This phase only fixes
  *which single* controller we report so the numbers stop lying. Pick the primary compute
  GPU (highest VRAM / smi index 0) for now.
- No dashboard changes. No new deps.

## Success checks (mage runs these)

- On chonko: `curl :18081/status` → `vramTotalMb` ≈ 24576 (a P40), **not** 16; `gpuPercent`
  is 0–100 or null, never >100. Paste the JSON.
- On aid (single real GPU): unchanged — still correct.
- A unit test with a fabricated `si.graphics()` result containing a 16 MB Matrox first and
  a 24576 MB NVIDIA second → selector returns the NVIDIA one.
- Footprint: `bin/grim-rig.js`, one test, KB note on the BMC-filter rule.
