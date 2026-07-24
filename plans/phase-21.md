# Phase 21 — fleet dashboard front-door on `:3003`

**Authority:** hierophant, 2026-07-24. **Repo:** grimoire only. Track F.
Depends on phase 12/17 (agent + `/cluster` + `/fleet`, accepted). User ask: a stable
dashboard on `:3003` showing per-host info, so you bookmark one URL instead of hitting
a particular box's agent.

## The distinction (binding)

- **`:18081` = the agent.** Runs on every box (phase 18/20). Per-box `/status`,
  `/metrics`, `/cluster`. **Unchanged — do not move this port.**
- **`:3003` = the dashboard front-door.** A designated *hub* box serves the fleet
  cockpit here. `3003` is the canonical mirror port for the dashboard role — record it
  in `config/lbl-config.json`'s `ports` block next to `grim_rig: 18081`.

## What lands

1. **`grim rig dashboard [--port 3003] [--listen 0.0.0.0]`** — a new subcommand (or a
   `--dashboard` mode of `serve`; mage's call, keep it small). It serves the **same**
   `/cluster` page and `/fleet` aggregate the agent already has — this is a *role*, not
   new UI. It does **not** need to collect local host metrics; it is purely the
   aggregating front-door. Reuse the existing `/fleet` fan-out and the existing
   `rig-cluster.html` verbatim — no dashboard-specific fork of the page.
2. The fleet list it fans out to comes from the **same source the agent uses**
   (`rig.json` / the registry) — do not hardcode box names. A box that's down shows
   `up:false` (already the `/fleet` contract), never breaks the page.
3. **Deploy path:** a hub runs this as a second user service
   (`grim-rig-dashboard.service`, same user-unit pattern as phase 18) — only on the
   box(es) chosen as hub, not the whole fleet. `setup-client.sh` installs it only when
   the box is flagged a dashboard hub (a `rig.json` field like `"dashboard": true`, or
   an install flag — pick the lighter one).
4. Record `dashboard: 3003` in the lbl-config `ports` block; KB entity update.

## Out of scope / do NOT

- No move of the agent's `:18081`. No change to `/cluster`'s look (phase 17 is signed
  off). No new metrics.
- No auth; same bind rules/notes as the agent.
- Not every box runs the dashboard — it's a hub role. Don't add it to the default
  `setup-client.sh` path for all boxes.

## Success checks (mage runs these)

- On the hub: `grim rig dashboard` (or the service) serves `http://<hub>:3003/cluster`,
  and it shows **every** box in `rig.json` — up ones with live gauges, down ones dimmed.
- The per-box agent on `:18081` is untouched and still serves its own `/cluster`.
- A remote box can hit `http://<hub>:3003/`.
- A non-hub box's `setup-client.sh` run does **not** install the dashboard service.
- Footprint: `bin/grim-rig.js` (dashboard subcommand/mode),
  `deploy/grim-rig-dashboard.service` (new), `deploy/setup-client.sh` (conditional
  install), `config/lbl-config.json` (`ports.dashboard`), one KB entity, one test.
