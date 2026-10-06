# Phase 99 — grim-mm collision scan: ignore non-UUID holder stamps

**Authority:** mage brief (user-directed: give the minion work). Phase number ratified
2026-10-06 by the mage at acceptance — sequential board number, board was clear. The underlying
gap was surfaced live by the hierophant in `.mm/0451` and noted on the FR entity for
"whenever `grim-mm.js` gets touched again". **Repo:** grimoire. **Track: Pact Tooling.**
**Depends on:** phase 97 (landed `0883482`).

## Why

Phase 97's role-collision guard fired for real on 2026-10-01 — and false-positived.
The hierophant's post-landing `grim mm read` warned: "role 'hierophant' is also held by
session test-session". Root cause: months of informal manual testing left ~10 **non-UUID**
debris stamp files in `.mm/` (`.role-test`, `.role-test-session`, `.role-master`,
`.role-default`, `.role-probe`, …), one holding a same-role stamp with a fresh mtime.
Real sessions always self-stamp with a UUID (`$CLAUDE_CODE_SESSION_ID`); debris never is.
The scan can't tell the two apart, so a dead test artifact can warn a live session.
The debris was deleted by hand this time; the guard should be robust to it recurring.

## What lands

- In `stampRole`'s collision scan (`bin/grim-mm.js` — the phase-97 loop over other
  `.role-*` files): when evaluating a candidate holder, **skip any holder whose session id
  (the filename after `.role-`) does not parse as a UUID** — lenient shape check is fine
  (8-4-4-4-12 hex groups; case-insensitive). Encode the rationale in a comment at the
  check: real session ids are env-derived UUIDs; non-UUID holders are manual-test debris,
  not live sessions, and must not trigger a collision warning.
- **Do not change the warn-only semantics for genuine (UUID) holders** — phase 97's
  pre-decided design (Jev 0.71) stands untouched. Same threshold, same warning text, same
  `contested` threading.
- **No auto-deletion of debris stamps** — deleting files from the read/stamp path is a
  side effect this brief does not ask for; manual cleanup is the established practice.

**Before coding:** read the phase-97 tests in `test/grim-mm.test.js` (`describe
'stampRole role-collision guard'`) and note what fixture session ids they use. If any
existing collision-positive test uses a non-UUID fixture name, update that fixture to a
UUID-shaped name — the test's intent is a *real* session collision, and under this change
a non-UUID fixture would correctly no longer warn. Renaming fixtures to preserve test
intent is in scope; do not weaken any assertion.

## Footprint

`bin/grim-mm.js` (the `stampRole` scan only), `test/grim-mm.test.js` (extend; adjust
fixture names only where test intent requires it).

## Success checks

- A fresh (mtime within the window) same-role holder with a **non-UUID** name → **no**
  stderr warning, `stampRole` returns false, this session's own stamp still written.
- A fresh same-role holder with a **UUID** name → warning + true, exactly as today
  (regression guard: phase 97's core behavior must be bit-identical in the real case).
- All pre-existing `grim-mm` tests still pass (44/44 as of `0883482`, modulo the fixture
  name updates above — the count may grow, never shrink below the existing coverage).
- `node --test` on `test/grim-mm.test.js` green; canonical full suite
  (`node --test 'test/*.test.js'`) green + self-terminating. (Known current baseline: one
  unrelated live-network failure in `test/grim-research.test.js` from ar5iv latency and an
  intermittent `test/portal.test.js` parallel-run flake — neither is yours; report them
  as environment if they appear, do not touch those files.)

## Out of scope

Auto-cleanup of debris `.role-*` files. Any change to the warn-only design, the 4h
window, or the `contested` frontmatter mechanic. Adding timestamps to stamp file content
(liveness stays mtime-based).
