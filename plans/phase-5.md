# Phase 5 — grim-server as config authority (server side)

**Spec:** `tmp/moar.md`. **Repo:** grimoire only. Wantan untouched.

## What lands

1. **Canonical config in repo:** `config/lbl-config.json` — seed it from the current
   `~/.config/lbl-config.json` on aid, byte-identical content. This file is the single
   edit point from now on; git history is the change log.

2. **HTTP route** in `bin/grim-server.js`, next to the existing `/config`-free routes:
   - `GET /config/lbl` → the exact current JSON of `config/lbl-config.json`
     (read from disk per request — no restart needed after a commit).
   - `GET /config/lbl?path=use.coding` → the single value at that dot-path,
     as JSON (`{"path":"use.coding","value":...}`); 404 with a JSON error if
     the path doesn't resolve.

3. **MCP tool** `config_get` in the existing `/mcp` block of grim-server:
   optional `path` argument, same semantics as the route. Match the shape of the
   existing MCP tool definitions exactly.

4. **CLI** `bin/grim-config.js` + `grim config` wired into `bin/grim.js`:
   - `grim config get [<path>]` — fetch from the server (`config.host` via `lib/env.js`);
     if the fetch fails and `$GRIMOIRE_ROOT`-style local repo access exists (we're on aid),
     fall back to reading `config/lbl-config.json` directly. Print value (raw string for
     scalars, pretty JSON otherwise).
   - `grim config sync` — fetch full config from server, and on success write it to
     `~/.config/lbl-config.json` (the last-good cache). Print what changed (diff of keys)
     or "unchanged".

5. **Validation:** on server start and in `grim config get` local fallback, if the JSON
   doesn't parse, fail loud with the file path. No schema engine — parse + require the
   top-level `endpoints` and `use` objects exist. Extend the existing pre-commit hook to
   run this check on `config/lbl-config.json`.

## Style

`'use strict'`, doc-block header, class-per-file OOP — match `bin/grim-host.js`.

## Success checks (mage runs these)

- `grim config get use.coding` against a running server prints the same value as
  `jq .use.coding ~/.config/lbl-config.json`.
- `grim config get` (no path) round-trips: output parses and deep-equals `config/lbl-config.json`.
- `grim config sync` writes the cache and is idempotent on second run ("unchanged").
- `curl 'http://grimoire.local:3663/config/lbl?path=nope.nope'` → 404 JSON error.
- MCP `config_get` returns the same payload as the route (test via `/mcp` curl).
- Footprint: `config/lbl-config.json` (new), `bin/grim-config.js` (new),
  `bin/grim-server.js`, `bin/grim.js`, pre-commit hook file. Nothing else.
