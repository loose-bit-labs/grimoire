# Phase 81 — Guild Hall on live presence (repoint Track Q to the Commons feed)

**Authority:** hierophant, 2026-08-17. **Repo:** grimoire. **Track: The Commons.**
**Depends on:** phase 79 (presence registry). Can land any time after 79; independent of the board.

Design: `docs/superpowers/specs/2026-08-17-the-commons-design.md`.

## What lands

The Guild Hall (Track Q, phases 61/62 — live) currently derives session presence by **scraping `.mm`**
(`lib/hmm.js` `scanProjects`). Repoint it to the **live `/api/presence` feed** so it shows *every* session
(not just pact members) as a meeple, in real time, grounded in self-announced presence.
- `GET /api/hmm` (fleet aggregate) gains presence from `/api/presence` (merge with, or supersede, the
  `.mm`-scrape path — keep `.mm`-derived *pact state* where richer, add live presence for who's actually here).
- The Guild Hall page consumes the same SSE presence stream for join/leave/update (no polling).
- A session with `role` (hunter/mage/minion/host-persona) renders its distinct avatar; kingdom = its `host`.

## Footprint

`bin/grim-server.js` (`/api/hmm` merge), `lib/hmm.js` (accept live presence alongside `.mm` scan),
`public/guild-hall.html` (consume presence SSE), tests `test/hmm-presence.test.js`.

## Success checks

- A session that `grim commons hail`s appears as a meeple in the Guild Hall within one SSE tick, even with
  no `.mm` thread (proves it's live presence, not `.mm`-derived).
- Its kingdom (host) and role render correctly; a session going `away` (TTL) greys/drops its meeple.
- Existing `.mm`-derived pact status still renders for pact members (no regression).
- Full suite green + deterministic.

## Out of scope

No new viewer polish (that's the deferred phase 63). No Discord bridge. Do not remove the `.mm` pact-status
path — augment it with live presence.
