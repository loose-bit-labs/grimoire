---
name: config
description: Read the canonical shared homelab config (lbl-config.json) via the grimoire server, or sync the last-good local cache. Use when checking what host/model a `use.*` key resolves to, or refreshing ~/.config/lbl-config.json after a server-side config change.
argument-hint: "get [path] | sync"
allowed-tools: [Bash]
---

# /config — lbl-config client

Wraps `bin/grim-config.js` — the config-authority CLI. Canonical source is
`config/lbl-config.json` in this repo, served fresh per request by
`grim-server.js`; `~/.config/lbl-config.json` is a last-good cache, not the
source of truth.

## Arguments

$ARGUMENTS:
- `get [path]` — fetch config from the server (`config.host` in `lib/env.js`);
  falls back to reading the repo's `config/lbl-config.json` directly if the
  fetch fails and this is a local checkout. No path prints the full config;
  a dot-path (e.g. `use.coding`) prints just that value.
- `sync` — fetch the full config from the server and write it to
  `~/.config/lbl-config.json`; prints changed top-level keys, or "unchanged".

## Instructions

```bash
cd ~/src/me/grimoire
node bin/grim.js config get [path]
node bin/grim.js config sync
```

## Notes

- Never edit `~/.config/lbl-config.json` by hand to fix drift — that's the
  cache, not the source. Edit `config/lbl-config.json` in this repo and
  commit; every reader picks up the change on its next fetch/sync.
- `sync` is safe to run repeatedly — it's idempotent and reports "unchanged"
  when nothing moved.
- Server down and no local repo access? `get` fails loud rather than
  guessing at a stale value.
