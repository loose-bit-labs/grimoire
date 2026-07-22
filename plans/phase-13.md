# Phase 13 — central telemetry stack: Prometheus + Grafana deploy

**Authority:** hierophant, 2026-07-22. **Repo:** grimoire only. Track F closer.
Depends on phase 12 (agents exist) — do not start before 12 is accepted.

## What lands

1. `deploy/setup-telemetry.sh` — structured bash matching `deploy/lib.sh`
   conventions (functions + `_main`): stands up Prometheus (:9090) + Grafana
   (:3000) via docker compose on the box it's run on.
2. Compose + Prometheus config as **JSON** (JSON is valid YAML — matches house
   preference), in `deploy/telemetry/`.
3. Scrape targets are **generated, not hand-written**: a small generator step reads
   `rig.json` (all boxes) and emits the Prometheus scrape config listing each box's
   agent `:8001`. Regen + restart is the update path — no hand-edited target lists.
4. One Grafana dashboard JSON (`deploy/telemetry/dashboard-hotspots.json`) with the
   doc's four rows: hotspots table (vram%), models loaded, queues/running, and a
   `gen_gpu_vram_used_mb / gen_gpu_vram_total_mb > 0.9` alert-style panel.
5. README section (short) in `deploy/telemetry/`: bring-up, where targets come
   from, retention knob.

## Out of scope / do NOT

- No Loki, no Alloy, no remote_write, no auth hardening beyond bind-address notes.
- No agent changes (phase 12 owns the agent).
- Do not start containers on production boxes as part of acceptance — verify on the
  dev box only; rollout to other boxes is a human/ops decision.

## Success checks (mage runs these)

- `setup-telemetry.sh` on the dev box: `:9090/targets` shows the generated targets;
  the local phase-12 agent scrapes green; Grafana dashboard imports and renders
  panels against live data.
- Deleting the generated scrape config and regenerating reproduces it byte-identically
  from `rig.json`.
- `docker compose down` cleans up fully.
- Footprint: `deploy/setup-telemetry.sh`, `deploy/telemetry/*`, one KB entity.
