# Cross-phase roadmap

**Authority:** hierophant, 2026-07-08; extended 2026-07-17, 2026-07-19, 2026-07-22. Binding for all phases.

Six tracks, one loop. Phases run in numeric order; phases with no listed dependency
may be pulled forward if an earlier one blocks.

- **Track A (phases 1–4):** WanTan extraction — move generic tooling into grimoire. ✅
- **Track B (phases 5–6):** grimoire server as config authority (spec: `tmp/moar.md`). ✅
- **Track C (phase 7):** adopted deltas from the memory-architecture spec (`tmp/other.md`). ✅
- **Track D (phases 8–9):** pact tooling streamline + close the oldest open bug. ✅
- **Track E (phases 10–11):** typed clients + registry generators (spec: `tmp/hi/SERVICE-MESH-LITE.md`).
- **Track F (phases 12–13):** rig telemetry — agent mode + central scrape stack (spec: `tmp/hi/telementry-Full-PoC-Markdown-hand-this-to-your-agent.md`).

**Status: Tracks A–D complete (phases 1–9 accepted). Tracks E–F queued 2026-07-22.**

## Ruling on tmp/hi/SERVICE-MESH-LITE.md (2026-07-22)

Layer 1 (registry) **already exists** — Track B made `config/lbl-config.json`
authoritative with server route + client precedence. Layer 3 (typed clients) is the
real delta — phase 10. The doc's "generate, don't duplicate" rule is adopted as
phase 11 (registry → hosts/probes/caddy views, generation only). **Layer 2 deferred
by ruling, do not build:** DNS (dnsmasq/CoreDNS) and reverse-proxy deployment.
Reason: every Node caller already resolves by name through `lib/env.js`; a resolver/
proxy adds a SPOF ("it's always DNS" made load-bearing) for zero caller-visible gain
today. Revisit only when a non-Node consumer demonstrates need — the generated
Caddyfile from phase 11 will be sitting there ready.

## Ruling on the telemetry PoC (2026-07-22)

Adopted, reshaped: the per-box agent is not a new `/poc` tree — it's `grim rig serve`
(phase 12), because `grim rig status` is already the sensor layer and `rig.json` is
already the box/service inventory. The doc's hardcoded ports are **wrong for this
lab** — all targets derive from config. Central Prometheus+Grafana lands as a deploy
script with generated scrape targets (phase 13). **Deferred, do not build:** ComfyUI
custom node, Loki, remote_write, connection-level client tracking.

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
| 0 (optional warm-up) | KB: `meta_technique_grimoire_known_bugs_list` | Fix `grim tome <sub>` argv off-by-one (`bin/grim.js:87` injects cmd; `grim-tome.js:201` expects the subcommand) + regression test | ✅ fixed in Phase 9 (`plans/reviews/phase-9.md`) |
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
| 7 | plans/phase-7.md | report-only dedup stage in grim-ritual + noise-floor addressed-message warning | ✅ accepted (`plans/reviews/phase-7.md`) — Track C complete, three-track engagement done |

## Track D — pact tooling streamline (phase 8)

**Goal:** mechanics out of skill prose, into `grim mm` (Rule 13); cap the oversized
`grim load` briefing payload (~70K chars, overflows the MCP result limit).

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 8 | plans/phase-8.md | `grim mm status` + `grim mm archive --phase N` + role-aware next-move footer on `read`; pact SKILL.md files slimmed to judgment only; briefing projection capped (≤20K chars) | ✅ accepted (`plans/reviews/phase-8.md`) — Track D complete, engagement done |
| 9 | plans/phase-9.md | fix `grim tome <sub>` argv off-by-one (closes phase 0) + regression test + KB bug-list update | ✅ accepted (`plans/reviews/phase-9.md`) — board clean, engagement done |

## Track E — typed clients + registry generators (phases 10–11)

**Goal:** the one-off clients become a family with a shared base (name-resolved,
fail-loud, timeout-bounded); every derived view of the registry is generated.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 10 | plans/phase-10.md | `lib/service-client.js` base class + ner/a1111 clients migrated (export shapes unchanged; comfy-client explicitly excluded) | queued |
| 11 | plans/phase-11.md | `grim config gen hosts\|probes\|caddy` — deterministic generated views of lbl-config, stdout only | queued |

## Track F — rig telemetry (phases 12–13)

**Goal:** see hot spots across the lab — persistent per-box agent + central scrape.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 12 | plans/phase-12.md | `grim rig serve` — `/status` JSON + `/metrics` Prometheus text; systeminformation + service pollers from rig.json; graceful degradation | queued |
| 13 | plans/phase-13.md | `deploy/setup-telemetry.sh` + JSON compose/prometheus configs + generated scrape targets + hotspots dashboard | queued (blocked on 12) |

## Acceptance bar (mage enforces per phase)

- Success checks in the brief actually run and pass — verify, don't trust the report.
- `git diff --stat` in **both** repos matches the brief's declared footprint exactly.
- Moved code matches grimoire lib style (`'use strict'`, doc-block header — see
  `lib/a1111-client.js`); shims stay under ~20 lines each.
