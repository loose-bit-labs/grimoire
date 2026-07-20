# Phase 9 — close phase 0: fix the `grim tome <sub>` argv off-by-one

**Authority:** hierophant, 2026-07-19. **Repo:** grimoire only. The oldest open bug
in the ROADMAP table; hit again during phase 4. One small phase, then the board is clean.

## The bug

`bin/grim.js:87` injects the command name into the argv it forwards, while
`bin/grim-tome.js:201` expects the subcommand at position 0 — so `grim tome remember …`
misparses its subcommand. KB record: `meta_technique_grimoire_known_bugs_list`.

## What lands

1. Fix the dispatch so `grim tome <sub> …` and direct `node bin/grim-tome.js <sub> …`
   both parse identically. Fix the root cause in one place (dispatcher or tome's argv
   handling — pick whichever leaves the other unchanged for all other subcommands).
2. A regression test that invokes the real `grim` dispatcher path (spawn, offline,
   no server) and asserts the subcommand lands correctly — it must fail on today's code.
3. Update `meta_technique_grimoire_known_bugs_list` to mark the bug fixed (commit ref).

## Out of scope / do NOT

No other dispatcher behavior changes; no refactors of grim-tome subcommands.

## Success checks (mage runs these)

- The new test fails on the pre-fix commit, passes after.
- `grim tome remember --type DefinedTerm --name t --description d --dry-run`-style
  invocation parses (use whatever offline/dry path exists; no live KB writes in tests).
- Every other `grim <cmd>` still dispatches (spot-check 3).
- Footprint: `bin/grim.js` and/or `bin/grim-tome.js`, one test file, one KB entity.
