# Phase 61 — HMM Tracking, thin vertical slice: aid end-to-end

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track Q (HMM Tracking).**
Design doc: `plans/track-hmm-tracking.md` (read it first — architecture, state machine, naming, decisions).
Goal of *this* phase: prove the **whole pipe** on **aid only** — collector → API → viewer — before any
fleet fan-out or avatar polish. If the pipe works for aid's own pact projects, 62/63 are just breadth.

## What lands

**A. Status core — `lib/hmm.js` (new, the deterministic heart, Rule 13 — no model).**
- `scanProjects(root)` — for each `${root}/*/` that has a `.mm/` dir (default `root = ~/src/me`), read
  the thread. Each `.mm/*.md` message is YAML-frontmatter (`id`,`ts`,`from`,`to`,`phase`,`state`).
  **Reuse, don't re-derive (Rule 13):** parse threads with `bin/grim-mm.js`'s **exported** `readThread`
  + `parseHeader` (they already exist in `module.exports` — do NOT hand-roll a `.mm` parser). Use the
  frontmatter **`ts:` field** as the authoritative timestamp (fall back to file mtime only if `ts` is
  absent). Get the open-phase count from `bin/grim-roadmap.js` `parse()` (exported) of that project's
  `plans/ROADMAP.md` if present.
- **`NEXT_OWNER` / `STATES` are defined in `bin/grim-mm.js` but not yet exported.** Add them to its
  `module.exports` (a trivial, safe export addition — explicitly in-footprint) and import them here;
  do not duplicate the maps. `lib/hmm` uses `NEXT_OWNER` (+ `TERMINAL` states) to decide who owes the
  next message → `working` vs `waiting`/`waiting-on-user`. If `TERMINAL` isn't exported either, export
  it the same way rather than re-deriving it.
- `projectStatus(thread, roadmapOpen, now)` → `{ project, roadmapOpen, retired, participants: [{ role,
  status, lastActivitySec }] }` implementing the state machine in the design doc exactly: `done/retired`
  (roadmapOpen==0), `working`, `conversing`, `waiting-on-user`, `waiting`, `sleeping`. Windows
  `ACTIVE_SEC`/`IDLE_SEC` are named consts at the top (≈300 / ≈1200).
- **Read-only** — this module never writes `.mm`. (grep will check.)

**B. Collector endpoint — `grim rig serve` gains `GET /hmm`** (`bin/grim-rig.js`).
- Returns `{ host, projects: scanProjects()+projectStatus() }` as JSON. Same server that already serves
  `/status`; add the route beside it. (Prometheus `hmm_*` gauges are **phase 62** — not now.)

**C. Aggregate API — grimoire server** (`bin/grim-server.js`).
- `GET /api/hmm` — **slice scope: aid only.** The server runs on aid, so it calls `lib/hmm` directly
  (localhost) and returns `{ boxes: [{ host: 'aid', projects }] }`. **Fleet fan-out to other boxes'
  `:18081/hmm` is phase 62** — leave a one-line `// TODO(62): fan out over rig.json like /fleet`.
- `GET /hall` — serve the viewer HTML (D). **Note:** `bin/grim-server.js` currently serves **no static
  files** — there is no `public/` handler. Add a minimal, same-origin static route for `/hall` (and the
  one vendored asset it needs) beside the existing `/api/*` routes; don't pull in a static-file
  framework, a tiny `readFileSync` + content-type is enough (mirror `serveStatic` in `bin/grim-rig.js`).

**D. Viewer — "The Guild Hall"** (`public/guild-hall.html` + vendored `public/vendor/three.min.js`).
- Self-contained page the grimoire serves at `/hall`. Fetches `/api/hmm`, renders **one screen per
  project**, a **3D meeple per participant** (Three.js), status shown as text now + a *basic*
  status-driven pose/animation (full 8-state animation set is phase 63). A project/host switcher is fine
  to stub. **Vendor Three.js locally, serve same-origin — no CDN hotlink** (local-first value; grep
  checks for external `src=`/`http` in the page). Vendoring is a **build-time** step: download
  `three.min.js` **once** (aid has network), commit it under `public/vendor/`, and load it same-origin.
  The runtime page must never fetch from a CDN — the committed file is the only source.

**E. Terminal parity — `grim hmm`** (`bin/grim-hmm.js` new + register in `bin/grim.js` COMMANDS).
- Prints the same data `lib/hmm` produces as a readable table (host · project · role · status · idle-age).
  The CLI and `/api/hmm` must agree (they share `lib/hmm`).

## Out of scope / do NOT

- **No fleet fan-out, no WS, no Prometheus `hmm_*`** — all phase 62. Aid-only, plain `GET /api/hmm`.
- **No full animation set / idle-cycle / gray-out timing / info panel** — phase 63.
- No model/LLM anywhere — status is parsed. No writes to `.mm`. No CDN in the viewer.
- Don't duplicate Track F GPU logic. Don't refactor `grim rig`'s existing routes — add beside them.
- Any defect found outside this footprint → escalate, don't silently commit (acceptance bar).

## Success checks (verify in the real invocation path)

- **`grim hmm` on aid** lists aid's `~/src/me/*/` pact projects with a plausible status — e.g. the
  grimoire project shows the mage/minion as `working`/`waiting` matching the live thread, and a
  roadmap-empty project shows `retired`. Capture the real output.
- **`curl -s localhost:3663/api/hmm`** returns the same projects/statuses as `grim hmm` (parity — same
  `lib/hmm`). Show both outputs agreeing.
- **Open `http://aid:3663/hall`** — meeples render for aid's real projects; a participant's status on
  screen matches the thread reality. (User eyeballs the Guild Hall.) *"A page loads" is not acceptance —
  the meeples must reflect the actual live pact state.*
- **`lib/hmm.js` unit tests** (`test/hmm.test.js`) drive fixture `.mm` threads through `projectStatus`
  and assert each status: working, conversing, waiting-on-user, waiting, sleeping, and roadmapOpen==0 →
  retired. Fixtures in a temp dir — **no test reads real `~/src/me`** (same rule as phase 60).
- `grep` proves `lib/hmm.js` never writes `.mm`, and `guild-hall.html` has no external/CDN `src`.
- The default suite still runs green + self-terminating (don't reintroduce phase-60's hang).
- Footprint: `lib/hmm.js`, `test/hmm.test.js`, `bin/grim-rig.js`, `bin/grim-server.js`, `bin/grim-hmm.js`,
  `bin/grim.js`, `bin/grim-mm.js` (export `NEXT_OWNER`/`STATES`/`TERMINAL` only — no behavior change),
  `public/guild-hall.html`, `public/vendor/three.min.js`.
