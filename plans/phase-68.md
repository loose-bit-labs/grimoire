# Phase 68 — `grim research`: kill the pathological 60s cap (no short cap on dives)

**Authority:** hierophant, 2026-08-11. **Repo:** grimoire. **Track G (research brain).**
**PRIORITY: next grimoire-pact phase after 62 — ahead of 67** (user: "no need for such short cap …
fire and forget … it can't just fall in a hole"). Grimoire-side slice only; the durable dive **queue**
lives in fLimfLaMs Swandive (separate pact brief — see "Coupled work").

## The bug

`bin/grim-research.js` defaults the **whole-research** timeout to **60s** (`researchDrop` line ~564
`timeout = 60000`; CLI line ~734 `|| 60000`). That budget is passed to `judge()` (the LLM ARCHIVIST
call) and bounds the pipeline — but the same file runs `digRepo` with `ARCHAEOLOGIST_TIMEOUT = 300000`
(5 min). So the outer 60s **guillotines a dig that's allowed 5 min**, and any slow LLM judge. Swandive
shells out `grim research --json <drop>` with **no `--timeout`**, so every dive gets 60s → "⏱️ Lost the
signal — 60s and no bottom." (Same family as the phase-34 digRepo-timeout bug.)

## What lands (grimoire only)

- **Separate the two clocks.** Per-fetch **acquire** keeps its short timeout (`httpGet` 10s,
  `resolveRedirect` 5s) — a single stuck HTTP GET must still fail fast. The **overall research/judge
  budget** gets its own generous default via a named const:
  `const RESEARCH_TIMEOUT = 600000 // 10 min — must exceed ARCHAEOLOGIST_TIMEOUT`. Use it in both
  default sites (opts default + CLI default). No more bare `60000`.
- **Honor an explicit long/none.** `--timeout 0` (or a sentinel) means **no overall cap** — fire-and-
  forget callers (Swandive) can run a dig to completion. `parseInt` must not coerce `0` back to the
  default (`|| 60000` is the current bug that also swallows `0`).
- Keep the timeout message honest: when the overall cap *does* fire, it's a hard safety stop, not a
  silent hole — the pipeline still returns a terminal result object.

## Out of scope / do NOT

- No change to `httpGet`/`resolveRedirect` per-fetch timeouts (short is correct there).
- No Playwright/JS-render acquire work here (that's the acquisition-rules follow-up —
  `meta_technique_swandive_dive_acquisition_rules_...`).
- No Swandive/fLimfLaMs edits (separate pact). Footprint: `bin/grim-research.js`,
  `test/grim-research.test.js`.

## Success checks

- `grim research --json --timeout 0 <slow-drop>` runs past 60s to completion (no premature kill);
  capture a run that would have died at 60s.
- Default (`no --timeout`) budget is ≥ `ARCHAEOLOGIST_TIMEOUT`; a repo dig is no longer truncated at 60s.
- `grim research --timeout 0` is respected as "no cap" (regression test: `parseInt('0')` path doesn't
  fall back to the default).
- Default suite green + self-terminating.

## Coupled work (NOT this phase — track separately, fLimfLaMs pact)

The user's "can't fall in a hole" also needs Swandive to be **durable**: it currently runs each dive as
an in-memory background subprocess, so a service restart (and it's crash-looping) **loses** in-flight
dives. That's a fLimfLaMs Swandive brief: persist accepted dives to disk → single-worker queue drains
them → resume-on-restart → always post a terminal embed. Swandive should also pass a long/`0` `--timeout`
once this phase lands. And its crash-loop + stale deploy must be fixed first (nothing runs otherwise).
