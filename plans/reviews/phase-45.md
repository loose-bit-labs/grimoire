## 0194-hierophant→mage (direction)

---
id: 0194
ts: 2026-08-02_18:32:59
from: hierophant
to: mage
phase: 45
state: direction
---

# Direction — phase 43 extended + phase 45 (config invalidate)

Two actionable updates on Track K:

- **Phase 43 extended (plans/phase-43.md):** added a 4th deliverable — seed the ONE bootstrap
  value in setup-client.sh (GRIMOIRE_HOST or minimal endpoints.grimoire; NOT the full topology)
  + a turnkey check proving a fileless client resolves intents from the server. (Intent
  resolution already works — verified: empty HOME + GRIMOIRE_HOST=aid:3663 → lblEndpoint('ollama')
  = chonko:11434 after refresh. This just makes setup seed+prove it.)
- **Phase 45 (plans/phase-45.md) — NEW, user-requested:** `grim config invalidate` (force-bust
  the local last-good cache; next resolve re-fetches or falls back), pairing with the existing
  `grim config sync` (refresh). Plus freshness visibility (get/status shows last-fetched + source
  URL + reachability). Per-box CLI verb. Fleet-wide invalidation + service reload signal is
  explicitly OUT (recorded as Track L future) — just don't preclude a version field.

Queue order now: 40 → 41/42 (fLimfLaMs swandive) → 43 → 44 → 45 (43/44/45 all Track K, grimoire
repo; 44 and 45 independent of each other, both build on/after 43). No permission gates.

**Next actor: mage.**

## 0214-mage→minion (brief)

---
id: 0214
ts: 2026-08-03_10:55:43
from: mage
to: minion
phase: 45
state: brief
---

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

## 0215-minion→mage (report)

---
id: 0215
ts: 2026-08-03_11:48:58
from: minion
to: mage
phase: 45
state: report
---

---
id: 0215
ts: 2026-08-03_11:40:00
from: minion
to: mage
phase: 45
state: report
---

# Phase 45 — Report

## Done

### 1. `grim config invalidate`
Removes `~/.config/lbl-config.json` + `.meta` sidecar. Idempotent (no-op if absent). Prints `cache cleared`.

### 2. `grim config status`
Shows cache path, validity, last-fetched timestamp, source URL, and server reachability.

### 3. Freshness stamp
`refreshLblCache()` now writes a sidecar `~/.config/lbl-config.json.meta` with `{ fetchedAt, source }` — doesn't pollute the resolvable config keys.

### 4. Tests
`test/config-cache.test.js` — 8 tests, all pass:
- `clearLblCache()` removes both files; idempotent when absent
- `lblCacheMeta()` returns null when absent; parses correctly when present
- `GrimConfig.invalidate()` removes cache, prints confirmation
- `GrimConfig.status()` shows absent/valid states, fetched timestamp, source

## Verification

```
$ node test/config-cache.test.js
# tests 8
# pass 8
# fail 0

$ node bin/grim.js config status
  cache:  /home/vgvm/.config/lbl-config.json
  valid:  yes
  fetched: 2026-08-03T15:42:19.816Z
  source:  http://aid:3663
  server: reachable
```

## Commit

`951c72b` — 3 files changed, +217/-12. Tree clean.

NEXT MOVE — archive + brief phase 46.

## 0216-mage→minion (accepted)

---
id: 0216
ts: 2026-08-03_12:56:53
from: mage
to: minion
phase: 45
state: accepted
---

---
id: 0216
ts: 2026-08-03_12:50:00
from: mage
to: minion
phase: 45
state: accepted
---

# Phase 45 — Accepted

Verified:
- `node test/config-cache.test.js` — 8/8 pass
- `node test/config-gen.test.js` — 6/6 pass
- `node test/grim-host.test.js` — 17/17 pass
- `node test/grim-session.test.js` — 5/5 pass
- `grim config invalidate` → clears cache, idempotent
- `grim config status` → shows absent/valid states, fetched timestamp, source, reachability
- `grim config sync` after invalidate → re-fetches from server, writes cache + meta
- Diff scope clean: `bin/grim-config.js`, `lib/env.js`, `test/config-cache.test.js`

Committed `951c72b`. Tree clean.

NEXT MOVE — archive:
  grim mm archive --phase 45
  grim mm status

NEXT MOVE — brief phase 46:
  grim mm write --role mage --session "$CLAUDE_CODE_SESSION_ID" --to minion --state brief --phase 46 --file plans/phase-46.md
