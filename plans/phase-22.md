# Phase 22 — Grafana provisioning: datasource + dashboard auto-load

**Authority:** hierophant, 2026-07-24. **Repo:** grimoire only. Track F.
Fixes a real phase-13 gap found in the field: `setup-telemetry.sh up` brings up a
**blank** Grafana — no datasource, no dashboard — because the compose only mounts
`grafana-data`. The dashboard JSON exists but never loads; a human has to hand-import
it and hand-add the datasource. Make it reproducible.

Two live fixes were already applied by hand on aid (2026-07-24) and must be encoded so
a fresh hub / a `down --volumes` reproduces them:
- compose now runs Grafana on `network_mode: host` (committed) so it can reach
  host-net Prometheus at `localhost:9090` past aid's ufw. Keep that.
- a `prometheus` datasource (uid `prometheus`, `http://localhost:9090`) and the
  hotspots dashboard were POSTed via the API — that state lives only in the volume.

## What lands

1. **`deploy/telemetry/provisioning/datasources/prometheus.yml`** (JSON is fine too) —
   provisions the Prometheus datasource: name `Prometheus`, uid `prometheus`,
   `url: http://localhost:9090`, `access: proxy`, `isDefault: true`. uid **must** be
   `prometheus` — the shipped dashboard references it by that uid.
2. **`deploy/telemetry/provisioning/dashboards/grimoire.yml`** — a dashboard provider
   pointing at a mounted folder, plus the existing `dashboard-hotspots.json` copied/
   mounted into it so it auto-appears.
3. **`compose.json`** — mount both into Grafana:
   `./provisioning:/etc/grafana/provisioning:ro` and the dashboards folder. Grafana is
   host-net now (no ports block) — keep it that way.
4. Confirm `dashboard-hotspots.json`'s datasource refs resolve against uid
   `prometheus` (they already do — verified in the field).

## Out of scope / do NOT

- No move of Prometheus off host-net (it needs host-net to scrape LAN agents).
- No auth/dashboard redesign. No new panels.
- Don't rely on the API-imported state already in aid's volume — provision from files
  so it survives a volume wipe.

## Success checks (mage runs these)

- `docker compose -f compose.json down --volumes` then `setup-telemetry.sh up` (or
  `compose up -d`) on a **clean** volume → Grafana comes up with the Prometheus
  datasource present (health OK) and the hotspots dashboard already listed, no manual
  import. This is the whole point — verify from a wiped volume, not the live one.
- A panel renders `gen_gpu_vram_used_mb` for `node="aid"` without hand-configuration.
- Datasource health endpoint returns OK against `http://localhost:9090`.
- Footprint: `deploy/telemetry/provisioning/*` (new), `compose.json` (mounts),
  README note, one KB entity for the telemetry stack.
