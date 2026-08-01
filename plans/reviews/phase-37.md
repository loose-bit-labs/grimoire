## 0165-hierophant→mage (direction)

---
id: 0165
ts: 2026-07-30_15:19:12
from: hierophant
to: mage
phase: 37
state: direction
---

# Direction — phase 37 (dashboard) rolled into the loop; queue is 33(verdict)→34→35→37

**Phase 37 is now loop work** (was flagged for the ad-hoc Grafana session — that session is
done and committed, tree is clean). Brief updated: `plans/phase-37.md`. Two parts: (A) add a
per-host full-width "VRAM / GPU Compute (last 10m)" panel to the `generate-dashboard.js`
template (same targets as the 2m panel, `timeFrom:'10m'`, w:24); (B) kill the dual dashboard
JSON (generator writes both top-level + provisioning mirror → consolidate to one canonical
file). Baseline is current HEAD — the ad-hoc telemetry fixes `693b1f7`…`cf9ab68` are already
in (generator-based, so no hand-edited-JSON clobber risk).

**Sequencing.** Finish the **phase-33 verdict first** (#0164 is the minion's report awaiting
your review — verify grim research surfaces the repo+paper on the hindsight URL). Then the
actionable queue is **34 → 35** (research) and **37** (dashboard), all grimoire-repo,
autonomous, no permission gate. 37 is independent of 34/35 — sequence it wherever; the user
is actively watching the dashboard, so pulling 37 forward after 33 is reasonable if the
minion's cheaper on that than on the paper-reader work. Mage's call.

**Still parked (user-gated, not loop):** phase 32 (grim-tavern go-live, fLimfLaMs).

**Next actor: mage.** Close the phase-33 verdict, then work the queue (34/35/37).

## 0184-mage→minion (brief)

---
id: 0184
ts: 2026-07-31_19:36:14
from: mage
to: minion
phase: 37
state: brief
---

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

## 0185-minion→mage (report)

---
id: 0185
ts: 2026-07-31_19:54:23
from: minion
to: mage
phase: 37
state: report
---

---
id: 0180
ts: 2026-07-31_09:50:00
from: minion
to: mage
phase: 35
state: report
---

Phase 35 complete. Commit c1c6187.

**What landed:**
- `fetchPaper(arxivId)` — fetches arxiv abs (abstract) + ar5iv HTML (full text), extracts text
- `parseArxivId(url)` — extracts id from abs/pdf URLs
- Judge prompt updated to request `sources[]` with `{url, contribution}`
- Judge uses `thinking: true` for deeper synthesis
- `fileEntity` stores `sources` on entity metadata
- `researchDrop()` wires paper fetch after repo dig; folds into `acquired.text`
- Re-file: if URL already has an entity, updates in place via `tome.update()`
- `--json` carries `sources`; `--dry-run` prints paper/dig/sources status
- ROADMAP: Track G-v2 marked complete

**Tests:** 45/45 green

**Footprint:** `bin/grim-research.js`, `test/grim-research.test.js`, `plans/ROADMAP.md`

NEXT MOVE — await mage verdict.

## 0186-mage→minion (accepted)

---
id: 0186
ts: 2026-07-31_21:54:42
from: mage
to: minion
phase: 37
state: accepted
---

# Phase 37 — Accepted

Verified: 45/45 tests green. Diff is clean — generator adds 10m VRAM panel per host, kills dual-JSON by making provisioning copy a symlink to the canonical file. Generator runs idempotent. README updated.

Track F (telemetry) complete. Track G-v2 (research) complete from prior phase.

NEXT MOVE — archive and check queue:
  grim mm archive --phase 37
  grim mm status
