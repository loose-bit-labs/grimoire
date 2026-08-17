# Phase 73 — Bounty Board: persistence store (`lib/bounty-store.js`)

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phase 71 accepted (uses its `apply*` fns + `newBounty` + `ConflictError`).

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 3** — exact code + tests there.

## What lands

`lib/bounty-store.js` — file-based JSON store under `<GRIMOIRE_ROOT>/bounties/`, **no new dependency**
(single-writer server serializes; atomicity via temp-file + `fs.renameSync`). The key invariant: **durable
state and ephemeral lease state live in SEPARATE files.**
- `paths(root)` → `{dir, boardFile, leasesFile, huntersFile, gitignoreFile}`.
- `loadBoard(root)` → `{bounties, hunters}`, merging each ephemeral lease back into its bounty's `.lease`.
- `saveBoard(root, board)` → strips `lease` from durable `board.json`, writes leases to `leases.json`,
  hunters to `hunters.json`, all atomic temp+rename; writes a `.gitignore` containing `leases.json`.
- `mutate(root, fn)` → the single-writer critical section: a per-root chained-promise queue that loads →
  `fn(board)→{board,result}` → saves → resolves `result` (survives a rejecting link).
- `upsertHunter(board, {hunterId, host, session_id, nowMs})` → registry first_seen/last_seen.
- Re-export `ConflictError` for the server to map to 409.

## Footprint

`lib/bounty-store.js`, `test/bounty-store.test.js`.

## Success checks

- Round-trip: after a claim, `board.json` has **no** `lease` field; `leases.json['<id>'].owner` is set;
  `.gitignore` contains `leases.json`; `loadBoard` returns the merged lease.
- **Durability/recovery:** `expires_at` is read from persisted `leases.json` (not an in-memory timer).
- Concurrency: 5 concurrent `mutate` `attempts++` calls ⇒ final `attempts===5` (no lost update).
- `node --test test/bounty-store.test.js` green; full suite green + self-terminating.

## Out of scope

No server routes, no HTTP (that's 74). No KB-graph writes (live claim state never touches the KB).
