# Cross-phase roadmap

**Authority:** hierophant, 2026-07-08; extended 2026-07-17. Binding for all phases.

Three tracks, one loop. Phases run in numeric order 1→7; phases 5–7 have no
dependency on 1–4, so the mage may pull them forward if a Track A phase blocks.

- **Track A (phases 1–4):** WanTan extraction — move generic tooling into grimoire.
- **Track B (phases 5–6):** grimoire server as config authority (spec: `tmp/moar.md`).
- **Track C (phase 7):** adopted deltas from the memory-architecture spec (`tmp/other.md`).

## Ruling on tmp/other.md (2026-07-17)

The spec describes what grimoire largely already is: entity files + index (scribe),
session lifecycle + briefing (grim-session), local embeddings (vectra/nomic), graph
expansion (oracle --depth), personas, MCP tools, nightly loop (grim-ritual + cron:
rest → scribe → divine → pathfind → scribe → noise-floor). **Adopted deltas:** dedup
stage in the ritual, and the noise-floor addressed-message footgun check (§3.2) —
phase 7. **Deferred by ruling, do not build:** federated external retrieval (§2.2),
code RAG (§2.4), presence/mailbox bus daemon (§3.1). Reason: the spec's own build
order defers them until a demonstrated need; grim mm is the mailbox we need today.

## Track A — WanTan extraction

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

| Phase | Brief | What moves | Status |
|-------|-------|-----------|--------|
| 0 (optional warm-up) | KB: `meta_technique_grimoire_known_bugs_list` | Fix `grim tome <sub>` argv off-by-one (`bin/grim.js:87` injects cmd; `grim-tome.js:201` expects the subcommand) + regression test | ⏳ still open — hit again during phase 4, not yet fixed |
| 1 | plans/phase-1.md | ComfyUI client → `lib/comfy-client.js` + `lib/comfy-watch.js` | ✅ accepted (`plans/reviews/phase-1.md`) |
| 2 | plans/phase-2.md | cull UI → `bin/grim-cull.js` + `grim cull` subcommand | ✅ accepted (`plans/reviews/phase-2.md`) |
| 3 | plans/phase-3.md | civitai downloader → `bin/grim-civitai.sh` | ✅ accepted (`plans/reviews/phase-3.md`) |
| 4 | plans/phase-4.md | `grimoire:cull` spell + KB entities | ✅ accepted (`plans/reviews/phase-4.md`) — Track A complete |

Phase 1 creates the `ext/grimoire` symlink; later phases assume it exists.

## Track B — config authority (phases 5–6)

**Goal:** kill config drift. Canonical `lbl-config.json` lives in this repo, served
read-only by grim-server; per-box `~/.config/lbl-config.json` becomes a last-good
cache, not a source of truth. Every current reader keeps working unchanged.

**Transport ruling:** HTTP route **and** MCP tool; the CLI wraps the HTTP route.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 5 | plans/phase-5.md | canonical `config/lbl-config.json` in repo + `GET /config/lbl` (+ `?path=`) + MCP `config_get` + `bin/grim-config.js` (`grim config get/sync`) | ✅ accepted (`plans/reviews/phase-5.md`) |
| 6 | plans/phase-6.md | client precedence layer (env → fetch → cache → fallback) in `lib/env.js` + `model-ask.js` migrated as proof + KB entity update + noise-floor event on config commit | ✅ accepted (`plans/reviews/phase-6.md`) — Track B complete |

## Track C — memory-spec deltas (phase 7)

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 7 | plans/phase-7.md | report-only dedup stage in grim-ritual + noise-floor addressed-message warning | 🔄 briefed, minion working — last phase |

## Acceptance bar (mage enforces per phase)

- Success checks in the brief actually run and pass — verify, don't trust the report.
- `git diff --stat` in **both** repos matches the brief's declared footprint exactly.
- Moved code matches grimoire lib style (`'use strict'`, doc-block header — see
  `lib/a1111-client.js`); shims stay under ~20 lines each.
