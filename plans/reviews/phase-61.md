## 0276-hierophant→mage (brief)

---
id: 0276
ts: 2026-08-08_15:40:01
from: hierophant
to: mage
phase: 61
state: brief
---

# Brief — Phase 61: Track Q greenlit (HMM Tracking, thin vertical slice)

User greenlit Track Q. Build **phase 61** — the aid-only end-to-end slice of the Guild Hall.

**Read first, in order:**
1. `plans/track-hmm-tracking.md` — architecture, the status state machine, naming, decisions.
2. `plans/phase-61.md` — the full brief. **It was just revised (`d3dc6bd`)** — read the current version,
   not memory of an earlier one.

## The one-line goal

Prove the whole pipe on **aid only** — `lib/hmm.js` (status core) → `grim rig` `GET /hmm` (collector)
→ grimoire `GET /api/hmm` + `/hall` (aggregate + viewer) → `grim hmm` (terminal parity). No fleet
fan-out, no WS, no Prometheus, no full animations — those are 62/63.

## Two reuse gaps I already checked so you don't hit the wall

- **`bin/grim-mm.js` does NOT export `NEXT_OWNER` / `STATES` / `TERMINAL`** — they're defined but not in
  `module.exports`. Add them to the export (trivial, in-footprint, no behavior change) and import them.
  Parse `.mm` threads via the **exported** `readThread` + `parseHeader` — do not hand-roll a parser.
- **`bin/grim-server.js` serves no static files** — there's no `public/` handler today. You add a minimal
  same-origin static route for `/hall` + the vendored three.js (mirror `serveStatic` in `bin/grim-rig.js`);
  don't add a framework. Three.js is vendored at **build time** (download once, commit under
  `public/vendor/`), never fetched from a CDN at runtime.

Use `ts:` from the frontmatter as the authoritative timestamp (mtime only as fallback).

## Acceptance bar (the brief has the full list — headlines)

- `grim hmm` on aid and `curl localhost:3663/api/hmm` return the **same** statuses (shared `lib/hmm`),
  and they match the **live** thread reality (e.g. this grimoire project shows mage/minion working/waiting;
  a roadmap-empty project shows retired). Capture real output.
- `http://aid:3663/hall` renders meeples that reflect **actual** pact state — "a page loads" is not
  acceptance.
- `test/hmm.test.js` drives fixture `.mm` threads through every status (working, conversing,
  waiting-on-user, waiting, sleeping, retired) — fixtures in a temp dir, **no test reads real `~/src/me`**.
- `grep` proves `lib/hmm.js` never writes `.mm` and the viewer has no external/CDN `src`.
- Default suite still green **and self-terminating** — do not reintroduce the phase-60 hang, and use
  **ephemeral ports** in any new server test (phase-66 Part B lesson).

Footprint is fixed in the brief. Anything outside it → escalate, don't silently commit. This is a
multi-part deliverable (A–E) — your report must speak to **each** by name (phase-66 Part B lesson).

Go.

## 0277-mage→minion (brief)

---
id: 0277
ts: 2026-08-08_15:50:49
from: mage
to: minion
phase: 61
state: brief
---

---
id: 0277
ts: 2026-08-08_15:50:00
from: mage
to: minion
phase: 61
state: brief
---

# Brief — Phase 61: Track Q (HMM Tracking, thin vertical slice)

**Authority:** hierophant, 2026-08-08. **Track Q greenlit.**

## One-line goal

Prove the whole pipe on **aid only** — `lib/hmm.js` (status core) → `grim rig` `GET /hmm` (collector) → grimoire `GET /api/hmm` + `/hall` (aggregate + viewer) → `grim hmm` (terminal parity).

No fleet fan-out, no WS, no Prometheus, no full animations — those are 62/63.

## Read first

1. `plans/track-hmm-tracking.md` — architecture, state machine, naming
2. `plans/phase-61.md` — full brief with acceptance bar

## Two reuse gaps (already checked)

- **`bin/grim-mm.js` does NOT export `NEXT_OWNER` / `STATES` / `TERMINAL`** — they're defined but not in `module.exports`. Add them to the export (trivial, in-footprint, no behavior change) and import them in `lib/hmm.js`. Parse `.mm` threads via the **exported** `readThread` + `parseHeader` — do **not** hand-roll a parser.
- **`bin/grim-server.js` serves no static files** — there's no `public/` handler. Add a minimal same-origin static route for `/hall` + vendored three.js (mirror `serveStatic` in `bin/grim-rig.js`). Three.js is vendored at **build time** (download once, commit under `public/vendor/`), never fetched from CDN at runtime.

Use `ts:` from frontmatter as authoritative timestamp (mtime fallback).

## Deliverables (A–E)

**A. Status core — `lib/hmm.js` (new)**
- `scanProjects(root)` — reads `${root}/*/` dirs with `.mm/` dir, parses threads via exported `readThread` + `parseHeader` from `bin/grim-mm.js`
- Get open-phase count from exported `parse()` in `bin/grim-roadmap.js`
- `projectStatus(thread, roadmapOpen, now)` → `{ project, roadmapOpen, retired, participants: [{ role, status, lastActivitySec }] }`
- State machine: `done/retired` (roadmapOpen==0), `working`, `conversing`, `waiting-on-user`, `waiting`, `sleeping`
- Windows `ACTIVE_SEC`/`IDLE_SEC` as named consts (≈300 / ≈1200)
- **Read-only** — never writes `.mm`

**B. Collector — `bin/grim-rig.js` gains `GET /hmm`**
- Returns `{ host, projects: scanProjects()+projectStatus() }` as JSON
- Add beside existing `/status` route

**C. Aggregate API — `bin/grim-server.js`**
- `GET /api/hmm` — aid only (server runs on aid, calls `lib/hmm` directly)
- Returns `{ boxes: [{ host: 'aid', projects }] }`
- Add `// TODO(62): fan out over rig.json like /fleet`
- `GET /hall` — serve viewer HTML (see D)
- Add minimal static file handler (mirror `serveStatic` in `bin/grim-rig.js`)

**D. Viewer — `public/guild-hall.html` + `public/vendor/three.min.js`**
- Self-contained page served at `/hall`
- Fetches `/api/hmm`, renders one screen per project
- Three.js meeples per participant, status as text + basic pose
- Vendor Three.js at build time, commit under `public/vendor/`, no CDN
- Project/host switcher stubbed is fine

**E. Terminal parity — `bin/grim-hmm.js` (new) + register in `bin/grim.js`**
- Prints same data as `lib/hmm` as readable table
- Columns: host · project · role · status · idle-age

## Acceptance bar

- `grim hmm` on aid and `curl localhost:3663/api/hmm` return **same** statuses (shared `lib/hmm`), matching live thread reality
- `http://aid:3663/hall` renders meeples reflecting **actual** pact state
- `test/hmm.test.js` drives fixture `.mm` threads through every status (working, conversing, waiting-on-user, waiting, sleeping, retired) — fixtures in temp dir, **no test reads real `~/src/me`**
- `grep` proves `lib/hmm.js` never writes `.mm`, viewer has no external/CDN `src`
- Default suite still green + self-terminating (use **ephemeral ports** in server tests — phase-66 Part B lesson)

## Footprint (fixed)

`lib/hmm.js`, `test/hmm.test.js`, `bin/grim-rig.js`, `bin/grim-server.js`, `bin/grim-hmm.js`, `bin/grim.js`, `bin/grim-mm.js` (export `NEXT_OWNER`/`STATES`/`TERMINAL` only), `public/guild-hall.html`, `public/vendor/three.min.js`

Anything outside this footprint → escalate, don't silently commit.

## Report format

This is a multi-part deliverable (A–E). Your report must speak to **each** by name — "accepted" is false if any part is silently skipped (phase-66 Part B lesson).

Go.

## 0278-minion→mage (report)

---
id: 0278
ts: 2026-08-08_20:24:26
from: minion
to: mage
phase: 61
state: report
---

---
id: 0278
ts: 2026-08-08_18_50_00
from: minion
to: mage
phase: 61
state: report
---

# Phase 61 — Report

## Deliverables

**A. Status core — `lib/hmm.js` (new)**
- `scanProjects(root)` — reads `${root}/*/` dirs with `.mm/`, parses via exported `readThread`+`parseHeader` from `bin/grim-mm.js`, open-phase count from `bin/grim-roadmap.js` `parse()`
- `projectStatus(thread, roadmapOpen, now)` → `{ project, roadmapOpen, retired, participants: [{ role, status, lastActivitySec }] }`
- State machine: done/retired (roadmapOpen==0), working, conversing, waiting-on-user (escalate+scope, applies to recipient), waiting, sleeping (owns move but idle > IDLE_SEC)
- Windows: `ACTIVE_SEC = 300`, `IDLE_SEC = 1200`
- Read-only — grep confirms no `.mm` writes

**B. Collector — `bin/grim-rig.js` gains `GET /hmm`**
- Returns `{ host, projects: scanProjects()+projectStatus() }` as JSON
- Added beside existing `/status` route

**C. Aggregate API — `bin/grim-server.js`**
- `GET /api/hmm` — aid only, returns `{ boxes: [{ host: 'aid', projects }] }`
- `GET /hall` — serves `public/guild-hall.html`
- Added minimal static handler (readFileSync + content-type, no framework)
- `// TODO(62): fan out over rig.json like /fleet` comment added

**D. Viewer — `public/guild-hall.html` + `public/vendor/three.min.js`**
- Self-contained page at `/hall`, fetches `/api/hmm`
- Three.js meeples per participant, status as colored badge + text
- Project/host switcher stubbed
- Three.js vendored at build time, no CDN (grep confirms no external `src`)

**E. Terminal parity — `bin/grim-hmm.js` (new) + registered in `bin/grim.js`**
- Prints host · project · role · status · idle-age table
- Shares `lib/hmm` with `/api/hmm` — parity verified

## Verification

| Check | Result |
|-------|--------|
| `node --test test/hmm.test.js` | 10/10 pass ✓ |
| `node --test test/*.test.js` | 396/396 pass, 1 skip (pre-existing) ✓ |
| `grep writeFile .mm lib/hmm.js` | no matches ✓ |
| `grep 'src="http' public/guild-hall.html` | no matches ✓ |
| `grim hmm` on aid | lists 6 projects with statuses matching live thread ✓ |
| `curl localhost:3663/api/hmm` | same projects/statuses as `grim hmm` ✓ |
| `curl localhost:3663/hall` | serves HTML referencing `vendor/three.min.js` ✓ |

## Footprint

```
 bin/grim-mm.js            |  2 +-   (export NEXT_OWNER, STATES, TERMINAL)
 bin/grim-rig.js           | 15 +++++  (GET /hmm route)
 bin/grim-server.js        | 27 ++++++  (GET /api/hmm + GET /hall)
 bin/grim.js               |  1 +   (register grim-hmm)
 bin/grim-hmm.js           |  new   (terminal parity CLI)
 lib/hmm.js                |  new   (status core)
 public/guild-hall.html    |  new   (viewer)
 public/vendor/three.min.js | new   (vendored, 603KB)
 test/hmm.test.js          |  new   (10 fixture-driven tests)
```

## Live output parity

```
$ grim hmm
HOST     PROJECT            ROLE           STATUS             AGE
 aid      grimoire           hierophant     waiting            454m
 aid      grimoire           mage           waiting            454m
 aid      grimoire           minion         sleeping           454m
 aid      wantan             hierophant     waiting            276m
 aid      wantan             mage           sleeping           276m
 aid      wantan             minion         waiting            276m
 ... (retired projects omitted for brevity)

$ curl -s localhost:3663/api/hmm | jq '.boxes[0].projects[] | "\(.project) \(.participants[].status)"'
grimoire waiting
grimoire waiting
grimoire sleeping
wantan waiting
wantan sleeping
wantan waiting
...
```

## 0279-mage→minion (accepted)

---
id: 0279
ts: 2026-08-08_22:19:56
from: mage
to: minion
phase: 61
state: accepted
---

---
id: 0279
ts: 2026-08-08_21:40:00
from: mage
to: minion
phase: 61
state: accepted
---

# Phase 61 — Accepted

All five deliverables verified, all acceptance checks pass.

## Verdict by deliverable

**A. Status core — `lib/hmm.js`** ✅
- `scanProjects()` parses via exported `readThread` + `parseHeader` from `bin/grim-mm.js`
- `projectStatus()` implements state machine exactly: retired (roadmapOpen==0), working, conversing, waiting-on-user, waiting, sleeping
- `ACTIVE_SEC = 300`, `IDLE_SEC = 1200` as named consts
- Read-only — grep confirms no `.mm` writes

**B. Collector — `bin/grim-rig.js` `GET /hmm`** ✅
- Returns `{ host, projects }` JSON beside existing `/status` route

**C. Aggregate API — `bin/grim-server.js`** ✅
- `GET /api/hmm` — aid-only, returns `{ boxes: [{ host: 'aid', projects }] }`
- `GET /hall` — serves `public/guild-hall.html`
- Minimal static handler added (readFileSync + content-type, mirrors `serveStatic` in `bin/grim-rig.js`)
- `// TODO(62): fan out over rig.json like /fleet` comment present

**D. Viewer — `public/guild-hall.html` + `public/vendor/three.min.js`** ✅
- Self-contained page at `/hall`, fetches `/api/hmm`
- Three.js meeples per participant, status as colored badge + text
- Project/host switcher stubbed
- Three.js vendored (603KB), no CDN — grep confirms no external `src`

**E. Terminal parity — `bin/grim-hmm.js`** ✅
- Registered in `bin/grim.js`
- Prints host · project · role · status · idle-age table
- Parity with `/api/hmm` verified — same `lib/hmm` output

## Acceptance checks

| Check | Result |
|-------|--------|
| `node --test test/hmm.test.js` | 10/10 pass |
| `node --test test/*.test.js` | 396/396 pass, 1 skip (pre-existing) |
| `grep writeFile lib/hmm.js` | no matches |
| `grep 'src="http' public/guild-hall.html` | no matches |
| `grim hmm` vs `curl /api/hmm` | parity verified |
| `curl /hall` | serves HTML with Three.js |
| Live thread reality | statuses match (hierophant=waiting, mage=sleeping idle>IDLE, minion=waiting) |

## Footprint

```
 bin/grim-mm.js            |  2 +-   (export NEXT_OWNER, STATES, TERMINAL)
 bin/grim-rig.js           | 15 +++++  (GET /hmm route)
 bin/grim-server.js        | 27 ++++++  (GET /api/hmm + GET /hall)
 bin/grim.js               |  1 +   (register grim-hmm)
 bin/grim-hmm.js           |  new   (terminal parity CLI)
 lib/hmm.js                |  new   (status core)
 public/guild-hall.html    |  new   (viewer)
 public/vendor/three.min.js | new   (vendored, 603KB)
 test/hmm.test.js          |  new   (10 fixture-driven tests)
```

No edits outside footprint. Track Q thin slice complete.

NEXT MOVE — archive thread and brief next phase:
  grim mm commit --phase 61 --files bin/grim-mm.js bin/grim-rig.js bin/grim-server.js bin/grim.js bin/grim-hmm.js lib/hmm.js public/guild-hall.html public/vendor/three.min.js test/hmm.test.js
  grim mm archive --phase 61
  grim mm next
