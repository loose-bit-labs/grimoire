# Phase 23 — agent must run without rig.json (graceful degradation)

**Authority:** hierophant, 2026-07-24. **Repo:** grimoire only. Track F.
**PRIORITY — live incident:** agents on chonko/meinherz/superack crash-loop
(`status=1/FAILURE`), so only aid reports. This is the sole blocker for "see all hosts."

## Root cause (confirmed on chonko)

`bin/grim-rig.js` `loadBoxes()` (~line 47):
`const configPath = config.root ? path.join(config.root, 'rig.json') : null` — then if
the file is absent it `console.error(...)` + `process.exit(1)`. Client boxes
**intentionally have no `GRIMOIRE_ROOT`** (`.env`: "GRIMOIRE_ROOT is intentionally
unset; all KB access goes via the server") and no local `rig.json`, and `/mnt/eighty`
(where aid's rig.json lives) is not shared to them. So `serve` exits 1 → systemd
restarts → crash loop.

The design error: **an agent needs zero fleet inventory to report its own
host/GPU/mem.** `rig.json` only answers "which local *services* do I poll" and "which
boxes does the hub aggregate." Neither should gate booting.

## What lands

1. **`serve` no longer requires `rig.json`.** If no box config is found: log a single
   warning and continue with an **empty local-service list** — the agent still serves
   `/status`, `/metrics`, `/cluster` with full host + GPU data. `loadBoxes()` (or a
   `serve`-specific path) returns `[]` instead of `process.exit(1)`.
2. **Keep the hard error only where inventory is genuinely required** — e.g. the
   one-shot `grim rig status`/fleet-aggregation CLI paths that inspect *other* boxes.
   Serving one's own metrics must never exit non-zero for missing inventory.
3. **Local service discovery when config is absent:** a client box should still be able
   to report its own services. Minimum acceptable now: with no rig.json, report host +
   GPU and an empty services list (dashboards still get CPU/mem/GPU/VRAM/temp — the
   bulk of the value). Nicer, if cheap: let the agent read *just its own box entry*
   from a config source it already has (the grimoire server / lbl-config) — but do
   **not** block this phase on that; empty-services degradation is the acceptance bar.
4. `/fleet` on a non-hub agent: return just this box (or an empty peer list) rather
   than erroring — it's only meaningful on the hub anyway.

## Out of scope / do NOT

- No multi-GPU work (that's phase 24). No dashboard/scrape changes (phase 25).
- Do not "fix" this by requiring GRIMOIRE_ROOT on clients — that contradicts the
  intentional design. The agent must work with it unset.
- No new deps.

## Success checks (mage runs these)

- On a box with **no rig.json and no GRIMOIRE_ROOT** (reproduce by unsetting both):
  `grim rig serve` starts, stays up, and `curl :18081/status` returns real host + GPU
  data with `services: []`. It must **not** exit 1.
- aid (has rig.json) is unchanged — still polls its services, `/fleet` still aggregates.
- systemd: on chonko/meinherz/superack after `git pull` + restart, the service reaches
  **active (running)**, not auto-restart. Verify on at least one real client box.
- Footprint: `bin/grim-rig.js`, one test (serve-without-config path), KB entity note.
