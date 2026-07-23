# Phase 17 — the instrument cluster: `grim rig serve /cluster`

**Authority:** hierophant, 2026-07-23. **Repo:** grimoire only. Track F. Depends on
phase 12 (`grim rig serve` + `/status`) accepted. Benefits from phase 11 (`gen probes`
gives the fleet list). Design approved live 2026-07-23 — user reaction: "add it to
the plan."

An automotive instrument cluster for the lab: VRAM as a fuel gauge, GPU compute as the
speedometer, load as a revving tach (redline when pinned), GPU temp as coolant, loaded
model as the gear, plus per-box tell-tale warning lights and a garage row of every box.

## Start from the mockup — do NOT rebuild

`plans/assets/rig-cluster-mockup.html` is the **approved, working design** (canvas
gauges, needle easing, tell-tales, garage row, single dark cockpit theme, reduced-
motion path). The job is to make it live, not to redesign it. Keep the look.

## What lands

1. **`GET /cluster`** on `bin/grim-rig.js` — serves the cluster HTML. Self-contained
   page (inline CSS/JS, no external fetches for assets), same as `grim-cull`'s pattern.
2. **`GET /fleet`** on the agent — a **server-side aggregate**: fan out to every box's
   agent `/status` (targets from the registry via phase-11 `gen probes` / `rig.json`),
   return combined JSON `{ boxes: [{name, util, vramUsed, vramTotal, temp, model, up}] }`.
   Server-side fan-out avoids browser CORS to other boxes. A box that's down →
   `up:false`, never fails the whole response (graceful degradation).
3. **Swap the sim for real data:** the mockup's `tickSim()` fake loop is replaced by
   polling `/fleet` on an interval (default 2s). Needle easing stays — real values
   become the easing *targets*, so motion still reads smoothly between polls. A box
   marked `up:false` shows a dimmed "STALL"/offline cluster, not frozen garbage.
4. Serial-number the metric mapping honestly: fuel = VRAM used/total, speedo = GPU
   util %, tach revs = smoothed util (the mockup's derivation is fine), coolant = temp,
   gear = util band, odometer = VRAM GB. Redline thresholds configurable-later, hard-
   coded defaults now.

## Out of scope / do NOT

- No Electron/Tauri/native window — browser tab / pop-out only (tier 2 is a deferred
  follow-on, noted below). No packaging.
- No new metrics the agent doesn't already expose (phase 12 owns the sensor set).
- No auth; same bind rules as the agent (127.0.0.1 default).
- Don't touch the central Prometheus/Grafana stack (phase 13) — this is the glanceable
  cockpit, orthogonal to the scrape stack.

## Success checks (mage runs these)

- `grim rig serve`, open `/cluster` in a browser: real needles move against this box's
  live `/status` — util spikes when a job runs, VRAM fuel rises when a model loads.
- `/fleet` returns every configured box; killing one agent → that box shows offline,
  the page and the rest stay live.
- Reduced-motion: page renders static current values, no idle animation.
- Page body never scrolls sideways at phone width (mockup already handles this — keep it).
- Footprint: `bin/grim-rig.js`, the served HTML (moved from `plans/assets/` into
  wherever the agent serves it — `deploy/` or inline, mage's call), one test file
  (assert `/fleet` shape + a down-box path), one KB entity update for grim-rig.

## Deferred follow-on (NOT this phase)

Tier 2 — a frameless always-on-top desktop window (Electron/Tauri shell around
`/cluster`). Only if the user wants it after living with the browser version.
