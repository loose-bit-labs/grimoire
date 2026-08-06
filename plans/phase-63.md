# Phase 63 — The Guild Hall: meeple polish (the fun part)

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track Q (HMM Tracking).**
Design doc: `plans/track-hmm-tracking.md`. Depends on **62** (fleet payload + WS + switcher exist; the
data is live and fleet-wide). This phase is almost entirely **`public/guild-hall.html`** — turning the
rough Three.js scene into the cute, legible viewer the user drew in `/tmp/hmm.md`. Frontend/visual work:
acceptance is **user eyeball**, plus a data-shape smoke assertion (no unit test can judge "cute").

## What lands (all in the viewer unless noted)

**A. Full status → animation mapping.** Each participant meeple animates its status (spec: "animation to
indicate its status"), covering the state machine from `lib/hmm.js`:
- **working** — heads-down / typing bob
- **conversing** — two meeples turn toward each other, alternating "talk" bob (drive from the
  conversing pair the collector already identifies)
- **waiting-on-user** — looks up, a `?`/`!` bubble floats above
- **waiting** — idle shift / foot-tap, facing the counterpart it's waiting on
- **sleeping** — `z z z` bubble, slumped
- **retired** — fades to grey and leaves the screen (spec pt 5: project no longer shown)

**B. Distinct per-role avatars** (spec: "visually distinguishable"; avatars pt 2). Hierophant / mage /
minion each get a distinct meeple — color + a silhouette cue (e.g. hierophant taller/crowned, mage
mid, minion small). Consistent across projects so you learn them at a glance. Model label under each
(mockup "Opus 5 / Qwen3.6") — best-effort from the payload; role name if model unknown.

**C. Gray-out on inactivity** (spec pt 7). A project with no activity past a threshold desaturates the
whole screen (distinct from per-meeple `sleeping`) — the "this table's gone cold" cue. Threshold a
named const; drive off the `lastActivitySec` already in the payload.

**D. Idle-cycle auto-tour** (spec pt 6). When the viewer is left alone (no interaction for N s), it
auto-cycles through the **active** projects/hosts on a timer — a lobby/attract mode. Any user
interaction cancels the tour; it resumes after idle.

**E. Info panel** (spec pt 8). An info icon per screen → click opens a detail panel: project, host,
roadmap open count + which phase is live, latest phase/state, last-activity age, per-participant status.
Needs a small **detail endpoint** — `GET /api/hmm/:host/:project` in `bin/grim-server.js` returning the
richer per-project view (`lib/hmm` already computes most of it; expose the fuller object). Keep the list
payload lean; the panel fetches detail on demand.

**F. Hover tooltips** (avatars pt 5). Mousing a meeple shows role · model · status · idle-age.

## Out of scope / do NOT

- No new data semantics — statuses, timestamps, and project set all come from `lib/hmm` as-is. If the
  viewer needs a field the payload lacks (e.g. the conversing-pair, live phase number), add it to the
  **existing** `lib/hmm` output + document it; don't invent a parallel status path in the browser.
- Keep the page **self-contained + same-origin** — vendored Three.js, no CDN, no external fetch beyond
  grimoire's own `/api/hmm*` (CSP/local-first). No new npm deps.
- Don't touch the collector's state machine or the fan-out/WS from 61/62 except to widen the payload.
- Retired projects leave the display but stay in the KB/thread — this is a viewer filter, not a delete.
- Out-of-footprint defects → escalate, don't silently commit.

## Success checks

- **User eyeball (the real gate):** open `http://aid:3663/hall` against the live fleet — each active
  project shows distinct role meeples animating their true status; a real status change (drive a `.mm`
  write) visibly changes the right meeple's animation via WS; a quiet project greys out; leaving it
  alone starts the idle tour; the info icon opens correct project detail; hover shows the tooltip.
  *A screenshot/among the acceptance evidence.*
- **`GET /api/hmm/:host/:project`** returns the detail object (roadmap-open, live phase, per-participant
  status, last-activity) matching what `grim hmm` + the list endpoint report for that project (parity).
- **Data smoke (automatable):** a test asserts the detail endpoint's shape + that every status the state
  machine can emit has a defined animation key in the viewer's status→anim map (guard against an
  unmapped status rendering a frozen meeple). Fixtures only — no real `~/src/me`.
- Self-contained check: `grep` proves no external/CDN `src` and no fetch outside `/api/hmm*`.
- `node --test test/` still green + self-terminating.
- Footprint: `public/guild-hall.html` (the bulk), `bin/grim-server.js` (`/api/hmm/:host/:project`),
  `lib/hmm.js` (fuller detail object + any field the viewer needs, e.g. conversing-pair/live-phase),
  `test/hmm.test.js` (detail shape + status→anim completeness).
