---
name: cull
description: Generate a self-contained image culling UI (cull.html) for a directory of generated portraits/images. Use for reviewing and curating batches of AI-generated images — keep/cull/undo, drag-select, zone bulk actions.
argument-hint: "<dir>" [--all] [--serve-root <dir>] [--serve-url <url>]
allowed-tools: [Bash]
---

# /cull — The Cull

Generate a portrait/image culling UI over a directory of generated PNGs.

## Arguments

$ARGUMENTS:
- `<dir>` — directory of PNGs to curate (required)
- `--all` — scan the full tree under `<dir>` instead of just the top level
- `--serve-root <dir>` — base dir for computing the printed URL's relative path
- `--serve-url <url>` — base URL prefix for the printed link

## Instructions

```bash
cd ~/src/me/grimoire
node bin/grim.js cull <dir> [--all] [--serve-root <dir>] [--serve-url <url>]
```

This writes `cull.html` next to the images and prints its path/URL. Open it
in a browser to review: keep/cull/undo, drag-select, zone bulk actions, an
rm-command generator for the culled set, and an export list for keepers.

Report the generated `cull.html` path back to the user.

## Notes

- `--serve-root`/`--serve-url` only affect the printed URL (relative-path
  math) — `cull.html` itself works from any directory.
- Flag → env (`GRIM_CULL_SERVE_ROOT` / `GRIM_CULL_SERVE_URL`) → hardcoded
  default, in that priority order.
- Primary consumer: grim-world portrait review after a `world-enrich` run.
- All mechanics (scanning, HTML/JS generation) live in `bin/grim-cull.js` —
  this spell is a thin invocation wrapper.
