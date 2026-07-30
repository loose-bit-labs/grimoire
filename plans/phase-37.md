# Phase 37 — full-width 10m VRAM/GPU-Compute row per host + kill the dual dashboard JSON

**Authority:** hierophant, 2026-07-30. **Repo:** grimoire only. Track F (telemetry).
**Loop work** (rolled into the mage/minion pair 2026-07-30 — the ad-hoc Grafana session
is done and committed). Baseline is current HEAD: the ad-hoc telemetry fixes landed as
`693b1f7`…`cf9ab68` (rig accuracy, per-GPU util/temp, static per-host rows, 2m windows,
5s intervals), all **through `generate-dashboard.js`** — so the dashboard is generated,
tree is clean, no collision. Build the two changes below on that baseline.

## Two changes

### A. Add a per-host full-width "VRAM / GPU Compute (last 10m)" timeseries

The dashboard is **generated** — per-host rows come from the 7-panel template in
`generate-dashboard.js` (static rows, because Grafana row-repeat is buggy). So the new
panel goes in the **generator template, not the JSON** (the JSON is regenerated output).

- Add an 8th panel to the per-host template block: a **full-width** timeseries,
  `gridPos: { h: 8, w: 24, x: 0, y: 24 }` (a new row below the w:24 service panel at y:16).
- Title `VRAM / GPU Compute (last 10m)`; `timeFrom: '10m'`.
- **Same two targets** as the existing "VRAM / GPU Compute (last 2m)" panel (generator
  lines ~216–221) — copy them verbatim, only the window differs:
  - `gen_gpu_vram_used_mb{job!="grafana",node="${host}"} / gen_gpu_vram_total_mb{...} * 100`
    → `legendFormat: 'vram % gpu{{gpu}}'`
  - `gen_gpu_util_percent{job!="grafana",node="${host}"}` → `legendFormat: 'gpu compute %'`
  - keep `interval: '5s'`, keep the `$gpu` template var behavior (phase-30) so multi-GPU
    hosts (chonko) show per-GPU series.
- One per host, since it's in the per-host block. Let the existing per-host y-offset logic
  place each block (don't hardcode absolute y across hosts).

### B. Single source of truth — kill the duplicate JSON

Today `generate-dashboard.js` reads the top-level `dashboard-hotspots.json` as its base
**and** writes it **plus** `provisioning/dashboards/dashboard-hotspots.json` (lines
286–288) — two physical files that drift. Grafana only reads the provisioning copy
(`grimoire.yml` → `/var/lib/grafana/dashboards`).

Consolidate to one file on disk. **Recommended (minimal):** make
`provisioning/dashboards/dashboard-hotspots.json` a **symlink** to
`../../dashboard-hotspots.json`, and drop the generator's second `writeFileSync` (it now
writes one file; the symlink makes Grafana see it). Verify the symlink survives in git
(commit the symlink) and that native Grafana follows it.
*Alternative if the symlink is awkward under the provisioning mount:* keep the provisioning
copy as the ONLY file (generator writes only there, and reads its base from there too),
delete the top-level one, and update every `plans/*` / doc reference. Pick one; state which
and why. Either way: **one canonical dashboard JSON, generator writes it once.**

## Out of scope / do NOT

- Don't hand-edit the JSON to add the panel — it regenerates. Edit the generator.
- Don't change the existing 2m/temp panels, metrics, or `$gpu` templating.
- Don't touch bin/grim-rig.js or other in-flight telemetry files beyond what's above.
- Don't push; commit locally (coordinate the commit with the Grafana session's other WIP).

## Success checks

- `deploy/telemetry/generate-dashboard.js` runs clean; re-running is idempotent
  (byte-identical but the version bump when the row set changes).
- The rendered dashboard shows, per host, a **full-width** "VRAM / GPU Compute (last 10m)"
  graph with vram% + gpu compute% (per-GPU on chonko). Screenshot or panel JSON pasted.
- Exactly **one** dashboard JSON file on disk (the other is a symlink or gone); Grafana
  still provisions and renders it. `ls -lL` proves single source.
- Footprint: `generate-dashboard.js`, the consolidated JSON (+ symlink), doc-ref updates.
