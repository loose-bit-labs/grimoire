# Grimoire Telemetry Stack

Prometheus + Grafana for rig agent telemetry.

## Quick start

```bash
# Bring up the stack (generates scrape config from rig.json)
deploy/setup-telemetry.sh up

# Tear it down (removes containers, volumes, network)
deploy/setup-telemetry.sh down

# Just regenerate scrape targets
deploy/setup-telemetry.sh generate

# Check container status
deploy/setup-telemetry.sh status
```

## Endpoints

| Service | URL | Notes |
|---------|-----|-------|
| Prometheus | http://localhost:9090 | `/targets` to see scraped boxes |
| Grafana | http://localhost:3000 | admin / grimoire |

## Scrape targets

Targets are **generated**, not hand-edited. Run `deploy/setup-telemetry.sh generate` to
regenerate `prometheus.json` from `$GRIMOIRE_ROOT/rig.json`. Boxes with `"skip": true` are
excluded. Each non-skipped box gets one scrape target on port 18081 (the `grim rig serve`
agent).

Regeneration is deterministic — delete and re-run produces byte-identical output.

## Dashboard

The hotspots dashboard is auto-loaded via Grafana provisioning (no manual import needed).
It provides:

1. **VRAM Hotspots** — bar gauges of VRAM usage % per node (green → yellow → red at 70/90%)
2. **Models Loaded** — count of currently loaded models
3. **Queue / Running** — time series of pending queue depth and running requests per service
4. **VRAM > 90% Alert** — state color panel flags nodes exceeding 90% VRAM

## Retention

Default is 30 days (`--storage.tsdb.retention.time=30d` in the Prometheus command in
`compose.json`). Change the value and restart to adjust.

## Files

```
deploy/telemetry/
  compose.json                    # Docker Compose (Prometheus + Grafana)
  generate-scrape.sh              # Generator: rig.json → prometheus.json
  prometheus.json                 # Generated Prometheus scrape config
  dashboard-hotspots.json         # Grafana dashboard (source)
  README.md                       # This file
  provisioning/
    datasources/prometheus.yml    # Grafana datasource provisioning
    dashboards/grimoire.yml       # Dashboard provider config
    dashboards/dashboard-hotspots.json  # Dashboard (copied for mounting)
```
