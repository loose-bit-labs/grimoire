# Phase 79 — The Commons: session presence registry (grim-server)

**Authority:** hierophant, 2026-08-17 (user: "adventurers of any stripe should make their presence known
regardless of kingdom"). **Repo:** grimoire. **Track: The Commons.**
**PRIORITY: lands before bounty-board phase 74** (the board rides this registry, not a private one).

Design: `docs/superpowers/specs/2026-08-17-the-commons-design.md`. This is the mesh foundation — the
concrete landing of the pact-topology mesh, extracted once so board + Guild Hall + adventurer-chat share it.

## What lands

The **session presence registry** — the "who's here, in which kingdom" — on grim-server (aid:3663, the one
hub every host reaches). Beside `.mm`, not replacing it.
- `lib/presence.js` (pure): `Presence {session_id, identity{role,name}, host, status, last_seen, ttl}`;
  `applyRegister/applyHeartbeat(now)`, `expire(now)` (TTL past → status `away`, then droppable) — the same
  liveness/lease mechanic as the bounty board (a session silent past TTL is presumed gone). Pure, `now` passed in.
- Store: reuse the bounty-store pattern (file under `GRIMOIRE_ROOT`, atomic temp+rename, single-writer
  `mutate`). **This is THE session registry** the bounty board's hunter registry will be a role-filtered view of.
- grim-server routes: `POST /api/presence/register`, `POST /api/presence/heartbeat`, `GET /api/presence`
  (snapshot), SSE `GET /api/presence/stream` emitting `presence:join|update|leave`. A sweep (unref'd
  interval) expires stale presence and broadcasts `leave`.
- `grim commons who` (CLI, HTTP client) — live presence grouped by kingdom; `grim commons hail`
  (register/heartbeat, piggybacks the loop tick). `session_id` from `--as`/`$CLAUDE_CODE_SESSION_ID`.

## Footprint

`lib/presence.js`, `lib/presence-store.js` (or reuse/generalize `lib/bounty-store` helpers), route block in
`bin/grim-server.js`, `bin/grim-commons.js` (partial: `who`/`hail`), one `COMMANDS` entry in `bin/grim.js`,
tests `test/presence.test.js` + `test/presence-server.test.js`.

## Success checks

- Register two sessions on different `host` values → `GET /api/presence` lists both, grouped by kingdom.
- Heartbeat renews `last_seen`; a session past its TTL is swept to `status:'away'` and a `presence:leave`
  SSE frame fires (test drives the sweep with an injected `now`).
- SSE stream + sweep interval are `unref`'d — tests self-terminate.
- Server is the sole writer; presence survives a reload (recomputed from persisted `last_seen`).
- Full suite green + deterministic.

## Out of scope

No message channel yet (phase 80). No NATS, no new daemon, no Discord. Do not touch `.mm`.
