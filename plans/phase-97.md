# Phase 97 — grim-mm role-stamp collision guard (warn-only)

**Authority:** hierophant, 2026-09-29. **Repo:** grimoire. **Track: Pact Tooling.**
**Depends on:** nothing.

## Why

`.mm/.role-<session-id>` self-stamps are unguarded — two live sessions can each claim the
same pact role (mage/minion/hierophant) with no check, since nothing verifies another
session doesn't already hold it. Happened once (2026-09-17, `.mm/0426`): a session that had
never been assigned a role defaulted to `--role mage`, coincidentally the same role a
separate, genuinely-running mage session had open at the same time. No conflicting verdict
resulted, but it cost ~1h of thread-forensics and a correction message
(`concept_feature_request_grim_mm_role_stamp_collision_guard_mm_role`).

**Design already decided** — TypeSafe/Jev judgment, 2026-09-20 (`~/tmp/locatesta/jev-mm-stamp-guard.mjs`):
`choice` over 4 designs (reject-if-recent / warn-only / lease-takeover / no-guard) picked
**warn-only** at 0.71 probability (vs. reject 0.14, lease 0.11, no-guard 0.04), confidence
0.61; a companion `noul` on "worth building now" came back 0.61 (a lean, not a slam-dunk,
but positive). Reasoning: liveness is only inferable from a stamp's last-write timestamp,
and a role may be legitimately held idle for hours or days — a hard reject or TTL/lease
would create false blocks; warn-only has zero false blocks and depends only on the
session reading a printed warning, which matches how this thread already self-corrects
(the 2026-09-17 incident resolved itself via a correction message with no guard at all).
Re-triaged 2026-09-29 as part of a broader backlog pass — composite-ranked as a top-2
"ready now" quick win (small effort, already-decided design) — see
`concept_backlog_triage_jev_2026_09_29_5_candidates_safesandbox_decom`.

## What lands

**Ground truth (read from `bin/grim-mm.js` directly, 2026-09-29):** `stampRole(dir, role,
session)` (line ~209) writes only the role name to `.role-<session>` — there is no
timestamp field in the file today. It's called unconditionally for both `read` and `write`
invocations, right after role resolution (~line 886), before either verb's own logic runs.
"Last-write" must come from the **filesystem mtime** of the `.role-*` file itself
(`fs.statSync(...).mtimeMs`) — nothing new to add to the file's content.

- In `stampRole`, before writing this session's own stamp: glob `.role-*` in `dir`
  (excluding this session's own file), read each, and find any whose **content equals the
  same `role`** and whose `mtimeMs` is newer than `Date.now() - <threshold>` (pick a
  threshold on the order of hours, not minutes — roles are legitimately held idle for hours;
  a few hours matches the incident's own timeline). If found: **print a loud warning to
  stderr** naming the other session id (parsed from the filename) and how long ago it last
  wrote. **Do not block** — still write this session's own stamp, still return normally.
  This makes the warning fire on *both* `read` and `write`, which is fine and arguably
  better (a session usually self-stamps via `read` first).
- Separately, in the `write` verb's message-construction path (~line 430, the YAML
  frontmatter template with `id/ts/from/to/phase/state`), add a `contested: true` line
  (mirroring the existing conditional `scopeLine` pattern just above it) **only when this
  particular write hit the collision above** — so a reader of the thread sees which
  specific message was sent during a contested window, not just a console warning nobody
  will scroll back to see.
- No new state file, no TTL/lease semantics, no `grim mm claim-role` command — those were
  the rejected designs.

## Footprint

`bin/grim-mm.js` (`stampRole` + the `write` verb's message-construction path only),
`test/mm.test.js` (or wherever `grim-mm.js` is tested — extend, don't restructure).

## Success checks

- Two sessions writing under the same role, both stamps fresh (within the threshold):
  the second writer's call prints the warning to stderr and still succeeds (message file is
  written, exit code 0).
- The written message's header carries the `contested` marker in that case.
- A stale stamp (older than the threshold, i.e. no live collision) produces **no** warning
  and no `contested` marker — this is the whole point of warn-only, not reject-if-recent.
- Existing `grim mm write`/`read` behavior is unchanged for the normal (no-collision) case
  — no regression in current tests.
- `node --test` on the touched test file green; full suite green + self-terminating.
  (Tests control freshness via `fs.utimesSync` on a fixture `.role-*` file rather than
  real sleeps.)

## Out of scope

No TTL/lease/expiry mechanism (explicitly rejected by the Jev judgment). No new CLI verb.
The `contested` header marker only applies to `write` (the only verb that constructs a
message); the underlying collision check in `stampRole` fires for both `read` and `write`
by design, since that's the shared code path both verbs already go through.
