# WanTan extraction — cross-phase roadmap

**Authority:** hierophant, 2026-07-08. Binding for all phases.
**Goal:** move WanTan's generic tooling into grimoire; wantan keeps working unchanged.

## The mechanism (applies to every phase)

Canonical code moves into this repo (`/mnt/eighty/userspace/vgvm/src/me/grimoire`).
The wantan repo (`~/src/me/wantan`) keeps **thin shims at the old paths** that delegate
through a symlink `ext/grimoire -> ~/src/me/grimoire` (wantan's established `ext/`
convention for external tools — see its README Setup section).

Hard rules:
- The 15 wantan callers of `comfy-queue.js` / `comfy-watch-lib.js` (bin/skills/*, wan-apose.js,
  inpaint.js, char-portrait.sh) are **never edited**. Shims preserve old paths and export shapes.
- Behavior out of the box is unchanged on both sides. New configurability comes as flags/env
  with the current hardcoded values as final defaults.
- **Out of scope by ruling:** the three-stage prompt pipeline (`prompts/*.md`,
  `story-summarize.js`, `prompt-clean.js`, `prompt-forge.js`) stays in wantan. It collides with
  grim-world's world-enrich path and awaits a GM session. Do not touch it.

## Phases (in order; each lands independently)

| Phase | Brief | What moves |
|-------|-------|-----------|
| 1 | plans/phase-1.md | ComfyUI client → `lib/comfy-client.js` + `lib/comfy-watch.js` |
| 2 | plans/phase-2.md | cull UI → `bin/grim-cull.js` + `grim cull` subcommand |
| 3 | plans/phase-3.md | civitai downloader → `bin/grim-civitai.sh` |
| 4 | plans/phase-4.md | `grimoire:cull` spell + KB entities |

Phase 1 creates the `ext/grimoire` symlink; later phases assume it exists.

## Acceptance bar (mage enforces per phase)

- Success checks in the brief actually run and pass — verify, don't trust the report.
- `git diff --stat` in **both** repos matches the brief's declared footprint exactly.
- Moved code matches grimoire lib style (`'use strict'`, doc-block header — see
  `lib/a1111-client.js`); shims stay under ~20 lines each.
