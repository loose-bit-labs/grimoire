# Phase 45 — config cache invalidation: `grim config invalidate` + freshness visibility

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. **Track K** (hostname/config
resolution). Small. Completes the client-config story: clients pull the topology from grimoire
by intent (works today), `grim config sync` refreshes the cache — the missing verb is
**invalidate** (force-bust stale cache) plus a way to *see* how fresh the cache is.

## Context (what already exists)

- `lib/env.js` `refreshLblCache()` fetches `GET /config/lbl` and writes the last-good cache
  `~/.config/lbl-config.json`. `grim config sync` calls it (= the **refresh** verb).
- Resolution reads that cache synchronously (`config`/`lblEndpoint`). So the cache is the
  client's working copy; freshness depends on when `sync`/`refreshLblCache` last ran.

The gap: no way to **discard** a stale cache (force the next resolve to re-fetch or fall back),
and no way to **inspect** cache age/source — so you can't tell if a box is running on stale
topology.

## What lands

1. **`grim config invalidate`** — remove/clear the local cache (`~/.config/lbl-config.json`),
   so the next resolution must re-fetch from the server (or fall to hardcoded fallback if the
   server is unreachable). Idempotent (no-op if already absent). This is the deliberate
   cache-bust the user asked for — pairs with `grim config sync` (fetch+write).
   - Consider `grim config sync --force` as an alias/companion (invalidate + immediately
     re-fetch in one step). Implementer's call; keep the verbs clear.
2. **Freshness visibility** — `grim config get` (or a `grim config status`) shows: cache path,
   **last-fetched timestamp**, source (server URL it was pulled from), and whether the server
   is currently reachable. So an operator can answer "is this box on fresh topology?" at a
   glance. Stamp the fetch time when `refreshLblCache()` writes (e.g. a `_fetchedAt` field or a
   sidecar), without polluting the resolvable keys.
3. **Docs/help** — the `grim config` usage line documents the trio: `sync` (refresh),
   `invalidate` (bust), `get`/`status` (inspect).

## Out of scope / do NOT (but note for the future track)

- **Fleet-wide invalidation** (signal *all* clients to re-pull when the server config changes)
  is NOT this phase. This phase is the per-box CLI verb. The future extension — a config
  version/etag on `/config/lbl` so clients cheaply detect staleness, and a refresh signal for
  **long-running services** (grim-server, the flimflams bots) to reload in-memory config on
  SIGHUP or a version bump — is recorded as **Track L (future, not yet briefed)**. Don't build
  it here; just don't design `invalidate` in a way that blocks it (e.g. leave room for a
  version field).
- No DNS. No change to the intent-resolution contract or endpoint names.

## Success checks

- `grim config invalidate` removes the cache; a subsequent `grim config get <intent>` re-fetches
  from the server and resolves correctly; with the server stopped, it falls back gracefully
  (clear message, no crash).
- `grim config sync` then `grim config get`/`status` shows a fresh `last-fetched` timestamp and
  the source URL.
- Idempotent: `invalidate` twice is fine; `sync` after `invalidate` restores a working cache.
- Test: invalidate-then-resolve re-fetch path (mock server), freshness stamp present after sync.
- Footprint: `bin/grim-config.js`, `lib/env.js` (fetch timestamp + a clear-cache helper),
  help text, test, KB note.
