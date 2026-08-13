---
name: grafana
description: Use when adding, editing, or troubleshooting a Grimoire fleet telemetry (Grafana) dashboard — "a dashboard is broken / empty / not updating", "my edits don't show up", "add a new dashboard/host to the board". Encodes the provisioning model + the four traps that keep confusing the pact. NOT for reading service status (that's /rig).
version: 1.0.0
allowed-tools: [Bash, Read, Edit, Write]
---

# GRAFANA — telemetry dashboards, the file-owned way

The fleet has **one** Grafana: the Docker container `grim-grafana` (host network, `:3000` on
the telemetry box — currently aid; `admin/grimoire`). In host `ps` it runs as **UID 472** — the
`grafana` user *inside* the container, not a host account. The repo's `deploy/grim-grafana.service`
(native tarball) is **not installed** and must stay that way — enabling it spawns a *second*
Grafana fighting for `:3000`.

The setup **works**, but it traps anyone who doesn't hold the whole map. This skill is the map.

## The one rule that prevents 90% of the confusion

**Provisioned dashboards are FILE-OWNED and read-only in the UI.** To change one, edit the JSON
on disk and wait ≤30s for the provider to reload. **Never Import / Save / Save-As in the browser** —
that writes a second, *unmanaged* copy into Grafana's DB that shadows the file and never updates
from it. Every "my edits don't show up" so far has been a UI-imported ghost.

Dashboards live in `deploy/telemetry/provisioning/dashboards/*.json` in the grimoire repo. The dir
is bind-mounted twice into the container: the whole `provisioning/` → `/etc/grafana/provisioning`
(so `dashboards/grimoire.yml` is the provider config), and `dashboards/` → `/var/lib/grafana/dashboards`
(where the provider reads JSONs, reload every 30s, `allowUiUpdates:false`).

## To edit or add a dashboard

1. Edit (or add) the bare-model JSON in `deploy/telemetry/provisioning/dashboards/<name>.json`.
   It **must** be the bare dashboard model — top-level `{"uid":..., "title":..., "panels":[...]}` —
   **not** the share/API export wrapper `{"dashboard":{...},"meta":{...}}`, and `uid` must be non-empty.
   A wrapper or empty uid → the provider fails to parse → 0 panels.
2. Save. Wait ≤30s. Do nothing in the browser.
3. **Verify it landed** (run locally if you're on the telemetry box — Rule 15):
   ```bash
   curl -s -u admin:grimoire 'http://localhost:3000/api/search?type=dash-db'      # loaded dashboards + uids
   docker logs grim-grafana --since 5m | grep -iE 'provision|dashboard|error'      # parse failures
   ```
   Do **not** trust the JSON's own `version` field — Grafana tracks its own internal revision. Check
   actual panel content / the API list.

## The four traps (diagnose in this order)

1. **Ghost UI-import.** A dashboard whose `uid` has **no backing file** (someone hit Import/Save).
   It shadows the real one; editing the file changes nothing. Symptom: recurring log spam
   `Invalid dashboard UID in annotation request` + `404 /api/dashboards/uid/<ghost>`. Fix — delete it:
   ```bash
   curl -s -u admin:grimoire -X DELETE http://localhost:3000/api/dashboards/uid/<ghost-uid>
   ```
   Cross-check every loaded uid against a file: any uid from `/api/search` with no matching
   `provisioning/dashboards/*.json` is a ghost.
2. **Wrapper vs bare model** — a JSON in the wrapper shape (`{"dashboard":...,"meta":...}`) or with an
   empty uid renders 0 panels. Restore the bare model from source (see `generate-dashboard.js`).
3. **gridPos on collapsed rows** — sub-panels nested in a collapsed row's `panels[]` must have
   `gridPos.y=0`; a `y=1` renders 0 panels. Grafana's row panel-counting is unforgiving.
4. **Missing compose / pact clutter** — the compose file the container launched from
   (`deploy/telemetry/compose.json`) can go missing from disk/git, leaving `docker compose` in that dir
   with no config (the container keeps running on its original mounts — regenerate compose.json). And
   never run a `.mm/` pact from inside `provisioning/dashboards/` — Grafana ignores non-`.json`, but the
   stray `.role-*`/`.gitignore` files are a smell. Pacts belong at the repo root.

## Regenerating per-host rows

Dashboards with one row per fleet host are generated from `rig.json` by
`deploy/telemetry/generate-dashboard.js` (idempotent — rows are keyed by a `▸ ` title prefix). Add a
host to `rig.json`, rerun the generator, copy the output into `provisioning/dashboards/`. Do **not**
hand-edit generated rows, and do **not** use Grafana's row-*repeat* feature for per-host titles — the
`$variable` title substitution is a long-standing upstream bug (see KB
`meta_technique_grafana_row_repeat_title_substitution_is_broken...`).

## Rules

- Never edit a provisioned dashboard in the browser. File is the source of truth.
- Never enable `deploy/grim-grafana.service` — one Grafana only.
- Bare dashboard model, non-empty uid, always. No API/share-export wrappers.
- Resolve the telemetry host/URL rather than hardcoding when off-box; on-box, use `localhost:3000`.

## Tone

Terse and diagnostic. State which trap it is, the fix, and how you verified. No dashboard poetry.
