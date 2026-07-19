# Phase 6 — config client layer + first migrated consumer

**Spec:** `tmp/moar.md`. **Depends on:** phase 5 (route + CLI exist).
**Repo:** grimoire only. Wantan untouched.

## Client contract (binding)

Precedence: **env var → grimoire server fetch → last-good cache
(`~/.config/lbl-config.json`) → hardcoded fallback.**

Sync/async split — this is the design constraint, respect it:

- `lib/env.js` is required synchronously at startup by everything. It keeps reading
  the cache file synchronously, exactly as today. It does **not** make HTTP calls
  at require time.
- Add `refreshLblCache()` to `lib/env.js` (async): fetch `GET /config/lbl` from
  `config.host`; on success, write the JSON to `~/.config/lbl-config.json` and return
  the fresh object; on any failure, return the cached object (or null) — never throw,
  never delete the cache. This is the one fetch implementation; `grim config sync`
  (phase 5) should be refactored to call it.
- Async consumers that care about freshness call `refreshLblCache()` once at task
  start and use its return value; sync consumers just keep reading the cache, which
  gets fresher every time any async consumer runs.

## What lands

1. `lib/env.js`: `refreshLblCache()` as above, exported; `bin/grim-config.js` sync
   subcommand refactored onto it.
2. **Proof migration — `bin/model-ask.js`:** at the start of its async entry path,
   call `refreshLblCache()` and use the returned config for `use.*` lookups instead of
   its private `_lbl()`-style file read. Behavior with the server down must be
   identical to today (cache fallback). Do not touch its model-routing logic.
3. **Change visibility:** in the pre-commit hook path from phase 5, when
   `config/lbl-config.json` is in the commit, POST a one-line summary of changed
   top-level keys to `POST /noise-floor/think` (best-effort — `curl --max-time 2 || true`;
   a down server never blocks a commit).
4. **KB entity:** update the existing lbl-config pattern entity (find it via
   `grim oracle lbl-config`) to describe the server-authority flow: canonical file in
   repo, route, precedence chain, cache role. Use `grim tome update`.

## Success checks (mage runs these)

- With server up: `node bin/model-ask.js` text task works; cache file mtime updates.
- With server unreachable (`GRIMOIRE_HOST=http://localhost:9` override): model-ask
  behaves exactly as today off the cache — no error, no hang (fetch timeout ≤ 2s).
- Commit touching `config/lbl-config.json` posts a noise-floor thought (check
  `GET /noise-floor/context`); commit succeeds with server down.
- KB entity renders the new flow (`grim oracle lbl-config` shows it).
- Footprint: `lib/env.js`, `bin/model-ask.js`, `bin/grim-config.js`, pre-commit hook,
  one KB entity touched. Nothing else.
