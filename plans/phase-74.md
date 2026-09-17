# Phase 74 — Bounty Board: server routes + atomic mutations (`bin/grim-server.js`)

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phases 72 + 73 accepted (uses `lib/bounty` + `lib/bounty-store`). **NOT gated on the
Commons / phase 79** — see the hunter-registry ruling below.

**Hunter registry — board-local for the MVP (hierophant ruling, 2026-09-16):** the 2026-08-17 "ride the
Commons" amendment is *superseded*. It contradicted both the master plan Task 4 and the phase-73 code that
actually shipped — `lib/bounty-store` already provides `upsertHunter(board, {hunterId,host,session_id,nowMs})`
writing into `board.hunters` (a durable `hunters.json`). The MVP uses **that** registry: `claim` upserts the
caller via `bstore.upsertHunter`; `POST /api/bounty/register` upserts explicitly; `GET /api/bounty/hunters`
returns `board.hunters` joined with `deriveReputation`. When the Commons (79) lands, migrating `hunters` to a
`role=hunter` view over `/api/presence` is a **later, non-blocking refactor** — record it as a follow-up, do
not build it now. Do not introduce a presence dependency in this phase.

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 4** — exact code + tests there.

## What lands

A bounty route block in `bin/grim-server.js` (mirror the existing `app.post`/`app.get` style). grim-server
is the **sole writer**; all mutations go through `bstore.mutate(config.root, …)`. `ConflictError`→**409**,
missing→404, bad body→400.
- `POST /api/bounty` (create; server assigns id; **v1 rejects `kind!=='phase'` with 400**),
  `GET /api/bounty` (list, filters `state/repo/kind/mine`, priority-sorted), `GET /api/bounty/:id`,
  `GET /api/bounty/hunters` (registry + `deriveReputation` per hunter).
- `POST /api/bounty/:id/{claim,heartbeat,submit,release,review}` and `POST /api/bounty/:id/register`
  (`:id` present in the path per master-plan Task 4, unused by the handler — this is what shipped).
- A shared `bountyAction(event, apply)` wrapper: load-in-lock → apply → save → `broadcastBounty(event, b)`.
  **In this phase `broadcastBounty` is a no-op stub** (SSE arrives in 75) — leave the call sites.
- **Export the express `app`** (`module.exports = Object.assign(module.exports||{}, { app })`) so tests can
  start it on an ephemeral port.

## Footprint

`bin/grim-server.js` (additive route block + requires + `app` export), `test/bounty-server.test.js`.
Do **not** disturb existing routes.

## Success checks

- **Atomic claim:** create a bounty, fire two concurrent `POST …/claim` ⇒ statuses sort to exactly `[200, 409]`
  (one winner). This is the core correctness bar.
- `kind:'task'` create ⇒ 400. Missing repo/priority/title ⇒ 400. Unknown id mutation ⇒ 404.
- Claim upserts the hunter into the registry.
- Server starts on port 0 in-test (phase-66 discipline: no hardcoded ports, no live-service dependence).
- `node --test test/bounty-server.test.js` green; full suite green + self-terminating.

## Out of scope

No SSE, no reclaim sweep (that's 75). No CLI (76). Keep `broadcastBounty` a stub here.
