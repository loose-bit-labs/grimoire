# Phase 96 — Persist the submission report on the bounty (evidence-chain fix)

**Authority:** hierophant, 2026-09-28. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phases 71/74/76 (all shipped) — this is a small off-phase correctness fix
to already-shipped code, not new surface.

## Why

Surfaced by mage (`.mm/0442`, 2026-09-28) reviewing the board's first real hunt (bounty
`b-1790627210689-6o9ky`, phase 93): the submitted evidence is **never persisted on the
board**. `bin/grim-bounty.js`'s `submit` verb sends `report: args.file` — the **file path
string**, not its contents — and `bin/grim-server.js:694`'s submit route calls
`bounty.applySubmit(b, body.hunter_id, body.epoch, now)`, which never reads `body.report`
at all (confirmed: `applySubmit`'s signature in `lib/bounty.js:108` has no report
parameter; grepping `lib/bounty.js` for "report" returns nothing).

**Why this matters:** the no-self-approval invariant depends on a reviewer being able to
independently verify a claimed submission. Right now that verification is possible only
by accident — phase 93's review worked because the hunter happened to leave a git commit
behind before its worktree was cleaned up. A hunter that submits without committing (or
whose worktree is cleaned before a reviewer looks) leaves **zero durable record** of what
was claimed, why, or what evidence was pasted. The board's own audit trail is one hop
short of the invariant it's supposed to guarantee.

## What lands

- **`lib/bounty.js`** — `applySubmit(bounty, hunterId, epoch, nowMs, report)`: mirror the
  existing optional-trailing-arg pattern already used by `applyHeartbeat`'s `wipRef`
  (`if (wipRef !== undefined && wipRef !== null) b.lease.wip_ref = wipRef`) — add
  `if (report !== undefined && report !== null) b.report = report` before `closeAttempt`.
  No other state-machine changes.
- **`bin/grim-server.js`** — the `/api/bounty/:id/submit` route passes `body.report`
  through: `(b, body, board, now) => bounty.applySubmit(b, body.hunter_id, body.epoch, now, body.report)`.
- **`bin/grim-bounty.js`** — the `submit` verb reads the file's **content**, not its path,
  before sending: `report: args.file ? require('node:fs').readFileSync(args.file, 'utf8') : undefined`.
  (`show`/`list` need no changes — both already return the full bounty object, so a new
  `report` field surfaces automatically.)

## Footprint

`lib/bounty.js`, `bin/grim-server.js`, `bin/grim-bounty.js`, plus their existing test files
(`test/bounty.test.js` or wherever `applySubmit` is unit-tested, `test/bounty-server.test.js`,
`test/bounty-cli.test.js`) — extend, don't restructure.

## Success checks

- `applySubmit(bounty, hunterId, epoch, now, 'some report text')` sets `.report` on the
  returned bounty to exactly that string; calling without a 5th arg (or `undefined`/`null`)
  leaves `.report` unset — same tri-state convention as `wipRef`, verified in a test.
- A live (port-0 stub) `POST /api/bounty/:id/submit` with `{..., report: 'text'}` in the
  body results in a `GET /api/bounty/:id` (or the route's own response) showing that exact
  `report` string on the bounty — in-test, not eyeballed.
- `grim bounty submit <id> --file <path>` reads the file's real content and sends it (mock
  or capture the outgoing request body in-test, assert it equals `fs.readFileSync(path,
  'utf8')`, not the path string).
- `node --test` on the three touched test files green; full suite green + self-terminating.

## Out of scope

No change to `review`'s access to the report beyond it now existing on the bounty object
(no new endpoint, no report-diffing, no size cap/truncation — if a report is huge, that's
a future problem, not this one). No retroactive backfill of `b-1790627210689-6o9ky`'s
report (it predates this fix; its evidence lives in the git commit and this session's own
review record, which is sufficient for that one bounty).
