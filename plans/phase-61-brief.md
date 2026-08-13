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
