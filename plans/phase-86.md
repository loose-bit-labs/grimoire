# Phase 86 — Fleet roster single-source: derive `grim rig` from the host registry

**Authority:** hierophant, 2026-08-25. **Repo:** grimoire. **Track: F cont. (fleet roster).**
**Depends on:** nothing hard; reuses phase 64's `GET /api/hosts/inventory` + `grim host` inventory reader.

## Why

There are **two host rosters** and they drift. `grim host` reads the KB registry
(`hardware/inventory` entities) — auto-registered by `grim host register`, self-updating, currently
9 boxes. `grim rig` reads a **hand-curated `rig.json`** — 5 boxes, and it silently misses every box
registered after someone last edited the file (blip, plink, tachi, vier were invisible until a manual
edit 2026-08-25). The service-health/GPU view is only as fresh as the last hand-edit.

Decision (user, 2026-08-25): **one roster, two lenses.** The KB registry is the single source of the
box *list*; `rig.json` stops owning the roster and keeps only the thing the KB doesn't have — the
per-host **service-check definitions**. A newly-registered box then auto-appears in `grim rig` with no
hand-editing. (This is the roadmap's own "generate, don't duplicate" principle — Track E /
SERVICE-MESH-LITE — and the filed request `concept_feature_request_kb_write_triggered_rig_json_dashboard_sync_g`.)

## What lands

- **`lib/fleet.js`** — `loadFleet(config)` → the merged roster, the single entry point everything uses:
  1. **Roster from the registry.** Reuse the `grim host` inventory reader (the shared fn behind
     `grim host list` / the server `/api/hosts` route — reads `hardware/inventory` entities for
     `{host, ip, aliases}`). Local (KB via `config.root`) or, on a client, `GET /api/hosts/inventory`
     (phase 64). This is the authoritative box list.
  2. **Service-checks overlay from `rig.json`.** Re-interpret `rig.json` as a **keyed overlay**, not a
     roster: match each entry to a registry host by `host`/`aliases`; attach its `services` (+ `label`,
     `aliases`, `unit` overrides). A registry host with no `rig.json` entry → `services: []`.
  3. **Fallback:** a `rig.json` entry whose host is *not* in the registry is still included (nothing
     silently lost if a box isn't registered yet).
  4. Preserve `aliases` (registry ∪ rig.json) — `isLocal`/Rule-15 detection depends on them.
- **`bin/grim-rig.js`** — `loadBoxes()` calls `loadFleet(config)` instead of `JSON.parse(rig.json)`.
  The rest of the probe/render path is unchanged (it already consumes `{host,label,aliases,services}`).
- **Telemetry generators** — `deploy/telemetry/generate-dashboard.js` and
  `deploy/telemetry/generate-scrape.sh` currently iterate the `rig.json` roster; repoint them to the
  same derived roster (call `loadFleet` / a `grim rig roster --json` emit) so scrape targets +
  dashboard rows cover **every registered box**, not just hand-listed ones. Otherwise the drift just
  moves from the CLI to the dashboards.
  - **Regen must not blank the live config, and must actually take.** (Live incident 2026-08-31: a
    mid-regen error left `deploy/telemetry/prometheus.json` **0 bytes**; the `grim-prometheus`
    container serves that file as its config, so Prometheus came up with **zero scrape targets** and
    every Grafana GPU panel went "No data" — restored by `git checkout HEAD -- prometheus.json` +
    `docker restart grim-prometheus`.) Two hard requirements for the generator:
    1. **Atomic output** — write to a temp file and `rename()` into place (or only overwrite after the
       node/jq step *succeeds*); never truncate-then-fill, so a generator crash can never leave an
       empty/partial config that a reload will happily load as "no targets."
    2. **Reload correctly, accounting for the inode swap.** The container bind-mounts the **file**
       `deploy/telemetry/prometheus.json` → `/etc/prometheus/prometheus.yml`; a Docker *file* mount
       pins the **original inode**. Any atomic rename gives the path a **new inode**, which the running
       container does **not** see — so `POST /-/reload` re-reads the *stale* inode and silently keeps
       the old config. `generate` must therefore either rewrite **in place** (preserving the inode)
       **and** `POST /-/reload`, or `docker restart grim-prometheus` to re-resolve the mount. Pick one
       and make `setup-telemetry.sh generate` do it end-to-end — a "generate" that leaves the live
       Prometheus on the old config is the bug we just hit.
- **`rig.json` cleanup** — drop the four empty stopgap entries (blip/plink/tachi/vier — now supplied by
  the registry) and any roster-only rows; keep only entries that carry real `services`. Stale
  note-only rows (superack/tbona/meinherz) either gain real `check`s or lose the note (a note is no
  longer a roster mechanism).

## Footprint

`lib/fleet.js`, `test/fleet.test.js`, `bin/grim-rig.js`, `deploy/telemetry/generate-dashboard.js`,
`deploy/telemetry/generate-scrape.sh`, and the `rig.json` in `$GRIMOIRE_ROOT` (data edit, not code).

## Success checks

- **Roster is derived:** with **no** `rig.json` entry for blip, `grim rig` still lists blip (it comes
  from the registry) with an empty service area — remove a box from `rig.json` and it does **not**
  disappear.
- **Checks still overlay:** aid/chonko show their live `● / ○` service badges (checks came from the
  `rig.json` overlay, matched by host).
- **All registered boxes appear:** `grim rig` shows all 9 `grim host` boxes with zero hand-editing of
  the roster.
- **Telemetry parity:** `generate-dashboard.js` emits one row per registry host; `generate-scrape.sh`
  emits a target per host (agentless boxes may be `down` targets — acceptable, they're real).
- **Regen never dark-fails:** simulate a generator error mid-run → `prometheus.json` is **unchanged**
  (still the last-good config), never 0-byte/partial. After a successful `setup-telemetry.sh generate`,
  the **live** Prometheus (`/api/v1/status/config`) reflects the new config — not the pre-regen one —
  proving the reload accounted for the inode swap (in-place rewrite + reload, or container restart).
- **Client mode:** on a box with no `GRIMOIRE_ROOT`, `loadFleet` derives the roster via
  `GET /api/hosts/inventory` (mirror phase 64's remote fallback), never throwing `local KB required`.
- `node --test test/fleet.test.js` green; full suite green + self-terminating.

## Out of scope

- Auto-populating real `check` commands for superack/tbona/meinherz/the laptops — a follow-up data
  edit once we probe them (this phase makes them *appear*; accurate service badges come after).
- The `grim host register` → `reconcileTelemetry` auto-cascade (phase 67's onboard hook) — orthogonal;
  deriving the roster makes it far less load-bearing.
- Merging `grim rig` and `grim host` into one command / aliasing — explicitly rejected: they are two
  lenses (liveness vs inventory) over one roster, not one command.
