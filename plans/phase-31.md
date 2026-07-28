# Phase 31 — telemetry off docker, onto user-space systemd (house convention)

**Authority:** hierophant, 2026-07-28. **Repo:** grimoire only. Track F.
Removes the lab's lone docker dependency. Prometheus + Grafana become pinned user-space
systemd units like every other service (grim-rig-serve is the template).

## Why (ruling)

`deploy/telemetry/compose.json` runs `prom/prometheus:v2.55.0` and `grafana/grafana:11.3.0`
in docker — the only containerized thing in a lab where six other services
(grim-bridge, grim-rig-serve, grim-seer, grim-world-fs/derive, flimsflams) are user-space
systemd units. Both containers already run `network_mode: host`, so docker's isolation is
discarded — it buys nothing here and *cost* the split-brain networking incident
(grafana bridge ↔ prometheus host-net ↔ aid ufw). Both are single static Go binaries with
config/provisioning/data already on host disk. Native user-space units are strictly
simpler and consistent with the house convention.

## What lands

1. **Two pinned binaries, house-convention install.** Fetch Prometheus **v2.55.0** and
   Grafana **v11.3.0** (match the current image tags exactly — no silent upgrade) into a
   managed dir (e.g. `%h/.grimoire-telemetry/bin/` or reuse the pinned-binary pattern from
   phase 24). `setup-telemetry.sh` downloads + verifies them; fail loud with the exact
   fetch line if absent. Idempotent.
2. **`deploy/grim-prometheus.service`** (user unit): `ExecStart=<pinned>/prometheus
   --config.file=%h/.grimoire/deploy/telemetry/prometheus.yml
   --storage.tsdb.path=%h/data/telemetry/prometheus
   --storage.tsdb.retention.time=30d --web.enable-lifecycle`, `Restart=on-failure`,
   `WantedBy=default.target`. Reuse the existing prometheus config file as-is (it's already
   the YAML mounted at `prometheus.yml`; keep the same scrape targets — generated, not
   hardcoded).
3. **`deploy/grim-grafana.service`** (user unit): `ExecStart=<pinned>/grafana server
   --homepath <grafana-dist> --config %h/.grimoire/deploy/telemetry/grafana.ini`, data at
   `%h/data/telemetry/grafana`, provisioning from the existing
   `deploy/telemetry/provisioning` tree (datasource + hotspots dashboard from phase 22 —
   unchanged). Admin creds (`admin`/`grimoire`) via `grafana.ini` or env, matching today.
4. **Rewrite `deploy/setup-telemetry.sh`**: replace `docker compose up` with binary install
   + `systemctl --user enable --now grim-prometheus grim-grafana` (+ linger, as
   grim-rig-serve already ensures). Idempotent re-run = no-op.
5. **Delete** `deploy/telemetry/compose.json` and scrub docker from
   `deploy/telemetry/README.md`. One deploy path, not two.

## Ports & networking

- Keep **Prometheus :9090** and **Grafana :3000** — third-party upstream defaults, per the
  2026-07-24 port ruling (palindromes are for grimoire-authored services only).
- Everything on localhost now — the grafana datasource points at `http://localhost:9090`
  (already does since the host-net fix); no bridge, no ufw bridge→host special-case.

## Out of scope / do NOT

- Don't change scrape targets, dashboards, provisioning, or metrics — pure runtime swap.
- Don't upgrade versions — pin to the exact current image tags.
- Don't touch grim-rig-serve (the agent) — this is only the central scrape/dashboard side.

## Success checks (mage runs these on aid)

- `systemctl --user status grim-prometheus grim-grafana` → both **active (running)**, on
  the pinned binaries.
- `curl -s localhost:9090/-/healthy` and `curl -s localhost:3000/api/health` → healthy;
  Grafana's Prometheus datasource query returns rig metrics (no split-brain).
- `docker ps` shows **no** grim-* containers; `compose.json` gone.
- Re-running `setup-telemetry.sh` is a no-op. Survives logout (linger).
- Footprint: two `.service` files, `setup-telemetry.sh`, `grafana.ini`, README scrub,
  compose.json deletion, KB note. No new npm deps.
