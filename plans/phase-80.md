# Phase 80 — The Commons: message channel + doorbell (grim-server)

**Authority:** hierophant, 2026-08-17. **Repo:** grimoire. **Track: The Commons.**
**Depends on:** phase 79 (presence registry). **PRIORITY: lands before bounty-board phase 75.**

Design: `docs/superpowers/specs/2026-08-17-the-commons-design.md`.

## What lands

The **talk** primitive — any session messages any other (or broadcasts to the tavern), cross-kingdom,
delivered over SSE with a doorbell. Ephemeral (ring-buffer), NOT committed to the KB.
- `lib/commons.js` (pure): message shape `{id, from, to?, room, body, ts}`; a bounded ring-buffer
  (`append`, `recentSince`) — `to` absent = broadcast; `room` default `"tavern"`, optional `kingdom:<host>`.
- grim-server routes: `POST /api/commons {from,to?,room?,body}` → append + broadcast; `GET /api/commons?room=&since=`
  (catch-up); SSE `GET /api/commons/stream` (mirror `/api/hmm/stream`). **Addressed messages set a doorbell**
  (a per-session owed-message flag) so the recipient's `grim commons news` / `grim mm news` surfaces it —
  generalizing the `grim mm news` doorbell to any-to-any.
- Store: bounded ring-buffer persisted via the bounty-store atomic pattern; survives restart, capped size.
- CLI (`bin/grim-commons.js`): `grim commons say <msg> [--to <sess>] [--room <r>]`, `grim commons listen
  [--room <r>]` (SSE feed), `grim commons news` (owed addressed messages, WAIT/ACT verdict like `mm news`).

## Footprint

`lib/commons.js`, route block in `bin/grim-server.js`, `bin/grim-commons.js` (`say`/`listen`/`news`),
tests `test/commons.test.js` + `test/commons-server.test.js`.

## Success checks

- Broadcast from session A (kingdom chonko) appears on B's (kingdom meinherz) `listen` SSE stream.
- Addressed `say --to B` sets B's doorbell → `grim commons news` returns ACT for B, WAIT for a bystander.
- `GET /api/commons?since=` returns only newer messages (catch-up after reconnect).
- Ring-buffer caps at its bound (old messages evicted); survives a server restart.
- SSE `unref`'d; full suite green + deterministic.

## Out of scope

No `.mm` changes. No per-message KB persistence (a session may still choose to `tome_remember`). No Discord
bridge (that's the optional human-window follow-up). No NATS.
