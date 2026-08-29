# Phase 88 — `/hunter` loop skill (autonomous bounty hunter)

**Authority:** hierophant, 2026-08-28. **Repo:** grimoire. **Track: Bounty Board (MVP).**
**Depends on:** phase 76 (the `grim bounty` CLI it drives) — and transitively 74 (server routes).

## Why

The board's first hunter is a **dedicated competent-model session**, not the pact minion (user,
2026-08-28) — the whole point is to hunt discrete solutions **outside** the fixed hmm pact, where
open-ended contemplation pays. Phases 74+76 give the board and its CLI; this phase gives a session the
**skill** to work it autonomously — the `/minion`-analog, but pulling from an OPEN pool instead of a
linear brief. Without it, hunting is hand-driven CLI calls; with it, a session self-drives:
`next → claim → work → submit → repeat`.

## What lands

- **`plugin/skills/hunter/SKILL.md`** — the `/hunter` spell (prose + steps; skills carry judgment, the
  CLI carries mechanics — Rule 13). It encodes:
  - **The loop** (uses only real phase-76 verbs, no invented commands):
    1. `grim bounty next --json` → the highest-priority eligible OPEN bounty for this hunter (or empty).
    2. `grim bounty claim <id> --as <hunterId>` → atomic lease (409 = someone beat you; pick the next).
    3. Read the bounty's task — it points at a `plans/`/spec file or carries an inline description **and
       a declared footprint**; do exactly that, nothing outside the footprint.
    4. `grim bounty heartbeat <id>` periodically while working (holds the lease; the board reclaims a
       silent lease).
    5. `grim bounty submit <id> --file <report.md>` with pasted evidence (commands + output), then loop.
  - **Rules that mirror the minion's discipline:** never self-approve (submission goes to the board's
    reviewer — mage or hierophant, per no-self-approval); stay inside the declared footprint; on a
    blocker or out-of-scope need, `grim bounty release <id>` (or submit `blocked`) — **do not improvise**
    across the boundary. Tests run offline; green is necessary, not sufficient (the reviewer re-verifies).
  - **Hunter identity:** a stable `--as <hunterId>` (or the env the CLI reads) so reputation/claim
    history attribute correctly across sessions.
  - **Autonomous mode** under `/loop` (dynamic): each wake, run the loop once — claim+work+submit a
    single bounty, or if none eligible / over budget, reschedule (WAIT) or stop. **State lives on the
    board**, so it survives compaction: every wake re-reads via `grim bounty next`.
- **KB entity** (new-spell rule): `SoftwareApplication`, `part_of: project_grimoire`, tags
  `["grimoire","skill","bounty","hunter"]` — invocation, the loop, and the no-self-approval/footprint
  rules; note it drives the phase-76 CLI and is the open-board analog of `/minion`.

## Footprint

`plugin/skills/hunter/SKILL.md`, one KB entity (via `tome_remember` + `scribe`). No engine code — the
mechanics are phase 76; this phase is the skill that *drives* them.

## Success checks

- **No invented mechanics:** every command the skill instructs exists in the phase-76 CLI
  (`next/claim/heartbeat/submit/release/list/hunters`); grep the SKILL.md against `bin/grim-bounty.js`
  verbs — zero mismatches.
- **Rules present and explicit:** no-self-approval, footprint containment, release-on-blocked,
  reviewer-re-verifies, stable hunter id.
- **End-to-end walkthrough (once 74+76 exist):** seed one bounty; a session following `/hunter` claims
  it (`claim` returns the lease), does trivial work, `submit`s, and the bounty lands in a review state
  for the reviewer — no self-approval path reachable.
- **KB entity** registered and found via `oracle_search "hunter"`; `scribe` rebuilt.

## Out of scope

- The board/CLI themselves (74/76). SSE-driven wake, reclaim sweep (75), telemetry (77) — deferred.
- The **intake bridge** (research/blocked-report → auto-filed bounty) — a later phase; for the first
  experiment, bounties are seeded from the backlog by hand.
- Deciding the reviewer (mage vs hierophant) — experiment-time config, not part of the skill.
