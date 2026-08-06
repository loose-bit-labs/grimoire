# Phase 61 — HMM Tracking, thin vertical slice: aid end-to-end

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track Q (HMM Tracking).**
Design doc: `plans/track-hmm-tracking.md` (read it first — architecture, state machine, naming, decisions).
Goal of *this* phase: prove the **whole pipe** on **aid only** — collector → API → viewer — before any
fleet fan-out or avatar polish. If the pipe works for aid's own pact projects, 62/63 are just breadth.

## What lands

**A. Status core — `lib/hmm.js` (new, the deterministic heart, Rule 13 — no model).**
- `scanProjects(root)` — for each `${root}/*/` that has a `.mm/` dir (default `root = ~/src/me`), read
  the thread. Each `.mm/*.md` message is YAML-frontmatter (`from`,`to`,`phase`,`state`); file mtime =
  timestamp. **Reuse, don't re-derive:** import `NEXT_OWNER`/state list from `bin/grim-mm.js`, and the
  open-phase count from `bin/grim-roadmap.js` (`parse()` of that project's `plans/ROADMAP.md` if present).
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
- `GET /hall` — serve the viewer HTML (D).

**D. Viewer — "The Guild Hall"** (`public/guild-hall.html` + vendored `public/vendor/three.min.js`).
- Self-contained page the grimoire serves at `/hall`. Fetches `/api/hmm`, renders **one screen per
  project**, a **3D meeple per participant** (Three.js), status shown as text now + a *basic*
  status-driven pose/animation (full 8-state animation set is phase 63). A project/host switcher is fine
  to stub. **Vendor Three.js locally, serve same-origin — no CDN hotlink** (local-first value; grep
  checks for external `src=`/`http` in the page).

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
  `bin/grim.js`, `public/guild-hall.html`, `public/vendor/three.min.js`.
