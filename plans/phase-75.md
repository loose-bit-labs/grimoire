# Phase 75 — Bounty Board: active reclaim sweep + SSE doorbell (`bin/grim-server.js`)

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phase 74 accepted (replaces its `broadcastBounty` stub; adds SSE + sweep).

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 5** — exact code + tests there.

## What lands

- `GET /api/bounty/stream` — SSE, mirroring the existing `/api/hmm/stream`: on connect send a `snapshot`
  frame, then a `data:` frame per transition. Track clients in a module array; drop on `req.on('close')`.
- Replace the phase-74 `broadcastBounty` **stub** with the real one: write `data: {event, bounty}\n\n` to
  every SSE client.
- `async function sweepBounties(root, nowMs = Date.now())` — **exported**; scans CLAIMED bounties whose
  `expires_at` has passed, applies `applyExpire`, persists via `mutate`, and broadcasts `bounty:reclaimed`
  (or `bounty:triage` when the result is `NEEDS_TRIAGE`). Returns the changed list. This is the **active
  sweep that writes** — lazy reclaim-on-read is not enough.
- `setInterval(() => sweepBounties(config.root), 30_000)` — **`.unref()`** so tests/process don't hang.

## Footprint

`bin/grim-server.js` (SSE endpoint, real `broadcastBounty`, `sweepBounties` + timer, export), `test/bounty-sweep.test.js`.

## Success checks

- Claim a bounty, call `sweepBounties(root, expires_at+1)` ⇒ returns 1 changed; `loadBoard` shows it `OPEN`.
- A bounty already at `attempts=2` that expires a 3rd time ⇒ `NEEDS_TRIAGE`, broadcast event `bounty:triage`.
- The sweep interval is `unref`'d — `node --test test/bounty-sweep.test.js` **exits on its own** (no hang).
- Full suite green + self-terminating.

## Out of scope

No CLI (76), no telemetry (77). SSE is server→browser push only (no `ws` dep — SSE ruling).
