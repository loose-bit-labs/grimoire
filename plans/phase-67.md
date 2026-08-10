# Phase 67 — auto-onboard a registered host to the fleet + telemetry

**Authority:** hierophant, 2026-08-10. **Repo:** grimoire. **Track K (host onboarding).**
Today a new host that registers gets a KB entity but is **invisible to telemetry** until someone
manually edits `rig.json`, regenerates the scrape config + dashboards, and reloads Prometheus (the
exact dance done by hand for `tbona` on 2026-08-10). This phase makes that automatic: **register a
host → it appears in the fleet and in Grafana with no manual step.**

## The key constraint that drives the design

The telemetry reconcile (regenerate `deploy/telemetry/prometheus.json` + reload the **Docker**
Prometheus) can only run **on aid** — that's where `rig.json`, the repo, and the Prometheus/Grafana
containers live. `deploy/grim-register-host.sh` runs **on the new box**. So the reconcile **must be
server-side** (the grimoire server on aid does it), triggered by the registration — never in the
register script itself.

## What lands

**A. Fleet upsert helper — `bin/grim-rig.js` `upsertBox(rigPath, box)` (exported).**
- Idempotent read-modify-write of `$GRIMOIRE_ROOT/rig.json`. If a box already exists (match on `host`,
  or any `aliases` entry), **no-op** → return `{ added:false }`. Else append
  `{ host, label: host, aliases:[host], services:[], note:"auto-onboarded <date>" }`, write back with
  the **existing 2-space formatting** (byte-shape consistent with the current file), return
  `{ added:true }`. Preserve all existing boxes exactly. Reuse `loadBoxes` shape — don't re-derive the
  path logic.

**B. Reconcile action — `bin/grim-rig.js` `reconcileTelemetry()` (exported) + `grim rig reconcile` CLI.**
- Regenerate: run `deploy/telemetry/generate-scrape.sh` and `deploy/telemetry/generate-dashboard.js`
  (shell out / require — mirror how `setup-telemetry.sh generate` does it).
- Reload Prometheus: `POST http://localhost:9090/-/reload`. **Best-effort / graceful (non-negotiable):**
  if Prometheus is unreachable or returns non-2xx, **log a warning and continue** — never throw, never
  fail the registration (Prometheus may be down; the regenerated files are still correct and will be
  read on next start). Return `{ regenerated:bool, reloaded:bool }`.
- The `grim rig reconcile` CLI is the manual/backstop entry point (run it any time rig.json changed by
  hand).

**C. Onboard endpoint — `POST /api/hosts/onboard`** (`bin/grim-server.js`).
- Body: `{ host, label?, aliases? }` (minimum: `host`). Steps: `upsertBox(...)`, then **only if
  `added`** call `reconcileTelemetry()` (don't reload Prometheus on every re-register — idempotent).
  Return `{ host, addedToFleet:bool, telemetryReloaded:bool }`.
- **Server-only guard:** requires `config.root` (the aid server that owns rig.json + local telemetry).
  If `config.root` is unset (a client proxy), return 409/501 with a clear message — a client can't
  onboard. Keep it beside the existing `/api/hosts/*` routes.
- This is **additive** — it does NOT touch the entity write. The host entity is still written by the
  existing `grim-register-host.sh` → `/api/tome/remember` path (phase 66 left that dry-run-friendly;
  don't disturb it).

**D. Register script calls onboard — `deploy/grim-register-host.sh`.**
- After a **successful** register (the existing remember POST), make one extra call:
  `POST /api/hosts/onboard {"host":"<hostname>"}`. Best-effort — a failed/again-non-2xx onboard prints
  a warning but does **not** fail the script (the entity is already registered).
- **Respect `DRY_RUN`** (phase 66): in dry-run, skip the onboard call too (print what it would do).

## Out of scope / do NOT

- **No service discovery** — the onboarded box gets `services:[]` (like tbona/meinherz/superack). Adding
  real service checks is a later, manual/again-separate concern.
- **No rig-agent install** — this wires the *fleet + telemetry config*; the box must already be running
  `grim rig serve` on `:18081` (that's `setup-client`'s job). Registration ≠ agent running. Note it in
  the endpoint's response if the agent isn't reachable, but don't try to install it.
- **No auth** on the endpoint (matches the rest of `/api/hosts/*`). No new npm dependency.
- Don't reload Prometheus when the box was already in `rig.json` (idempotent — avoid churn).
- rig.json lives in the **KB** (librarian-committed) — writing it is expected; do NOT `git add`/commit
  it from this code. Out-of-footprint defects → escalate.

## Success checks (verify in the real path)

- **Idempotency:** `upsertBox` on a temp rig.json adds a missing box once; a second call is a no-op;
  existing boxes untouched; file re-parses and keeps 2-space shape. Unit-tested against a **temp**
  rig.json (never the real one).
- **Endpoint (hermetic):** `POST /api/hosts/onboard {host:"faux"}` against a temp rig.json + a
  **stubbed** `reconcileTelemetry` (do NOT hit real Prometheus/Docker in tests) → asserts
  `addedToFleet:true` and reconcile called **once**; a repeat call → `addedToFleet:false`, reconcile
  called **zero** more times.
- **Graceful reload:** `reconcileTelemetry` with Prometheus unreachable → returns `reloaded:false`,
  **no throw** (test the failure path explicitly — Rule 9).
- **End-to-end (manual, user-gated, capture output):** register a throwaway/again a real box (or curl
  the onboard endpoint for a not-yet-fleet host that has a live agent) → it appears in
  `curl localhost:9090/api/v1/targets` as `up` and in the Grafana series, with **no** hand edits.
  *"Endpoint returns 200" is not acceptance — the box must actually show up in Prometheus.*
- Default suite green + self-terminating; ephemeral ports in any new server test (phase-66 lesson);
  `grep` proves tests never touch the real `rig.json` or real Prometheus.
- Footprint: `bin/grim-rig.js` (`upsertBox`, `reconcileTelemetry`, `reconcile` CLI),
  `bin/grim-server.js` (`/api/hosts/onboard`), `deploy/grim-register-host.sh` (onboard call, dry-run
  aware), `test/*.test.js` (upsert idempotency + onboard hermetic + graceful-reload).
