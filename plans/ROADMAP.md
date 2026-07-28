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

## Ruling on port numbers (2026-07-24)

**Grimoire-authored services use mirror (palindrome) ports; third-party services keep
their upstream default.** A palindrome port is the ownership marker — `:3663`
(grimoire), `:3773` (ner), `:11311` (llama-server), `:17071` (a2c), `:13031` are all
ours and already mirrored; `:11434` ollama, `:7860` a1111, `:8188` comfyui keep their
upstream ports (fighting those causes drift and erases *their* identity). The lone
defector was the rig agent on `:8001` — reassigned to **`:18081`** (abcba). The
canonical service→port map is recorded in `config/lbl-config.json` (the config
authority, Track B) as the single source of truth; do not hardcode a port anywhere a
config lookup can answer.

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
| 10 | plans/phase-10.md | `lib/service-client.js` base class + ner/a1111 clients migrated (export shapes unchanged; comfy-client explicitly excluded) | ✅ accepted (`plans/reviews/phase-10.md`) |
| 11 | plans/phase-11.md | `grim config gen hosts\|probes\|caddy` — deterministic generated views of lbl-config, stdout only | ✅ accepted (`plans/reviews/phase-11.md`) |

## Track F — rig telemetry (phases 12–13)

**Goal:** see hot spots across the lab — persistent per-box agent, central scrape,
and a glanceable automotive cockpit.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 12 | plans/phase-12.md | `grim rig serve` — `/status` JSON + `/metrics` Prometheus text; systeminformation + service pollers from rig.json; graceful degradation | ✅ accepted (`plans/reviews/phase-12.md`) |
| 13 | plans/phase-13.md | `deploy/setup-telemetry.sh` + JSON compose/prometheus configs + generated scrape targets + hotspots dashboard | ✅ accepted (`plans/reviews/phase-13.md`) |
| 17 | plans/phase-17.md | `grim rig serve /cluster` — automotive instrument cluster (VRAM=fuel, compute=speedo, load=revs, temp=coolant) + `/fleet` aggregate; live off `/status`, built from approved mockup `plans/assets/rig-cluster-mockup.html` | ✅ accepted (`plans/reviews/phase-17.md`) |
| 18 | plans/phase-18.md | deploy `grim rig serve` as a persistent user systemd service, tied into `setup-client.sh` right after `grim-register-host.sh`; `/update-host` restarts it on every catch-up run; remote-reachability + logout-survival checks; amended to canonical port `:18081` (mirror-port ruling) | ✅ accepted (`plans/reviews/phase-18.md`) |
| 19 | plans/phase-19.md | stop `grim-rig.js`'s `si.graphics()` from shelling `xrandr` every poll on headless boxes — drop it for the existing nvidia-smi/rocm-smi/amd-smi paths, or scrub `DISPLAY`/`XAUTHORITY` at startup | ✅ accepted (`plans/reviews/phase-19.md`) — option (b), DISPLAY/XAUTHORITY scrub chosen |
| 20 | plans/phase-20.md | plink (macOS): launchd LaunchAgent (`com.grimoire.rig-serve.plist`) + `setup-client.sh` Darwin branch — same `:18081` agent, no systemd. **Acceptance must run on plink, not the Linux loop host.** | queued (hierophant, 2026-07-24) |
| 21 | plans/phase-21.md | fleet dashboard front-door on `:3003` — hub box serves existing `/cluster`+`/fleet` as a bookmarkable all-hosts view; agent stays `:18081` (role split, not a port move); hub-only deploy | queued (hierophant, 2026-07-24) — Track F complete after 19+20+21 |
| 22 | plans/phase-22.md | Grafana provisioning — auto-load Prometheus datasource + hotspots dashboard from files (fixes phase-13 blank-Grafana + host-net networking gap) | ✅ accepted (`plans/reviews/phase-22.md`) |
| 23 | plans/phase-23.md | **PRIORITY incident** — agent serves host+GPU without rig.json (graceful); fixes chonko/meinherz/superack crash-loop (no GRIMOIRE_ROOT on clients) | ✅ accepted (`plans/reviews/phase-23.md`) |
| 24 | plans/phase-24.md | grim-rig unit follows house convention — `%h/.grimoire/bin/node` pinned v21.7.1 + `~/.grimoire` symlink; setup-client.sh ensures it; kills fleet node-drift | ✅ accepted (`plans/reviews/phase-24.md`) |
| 28 | plans/phase-28.md | agent picks the real compute GPU — filter BMC/integrated (chonko's Matrox G200 → 16MB/270463% bug); smi wins over si.graphics for VRAM total; guard percent math. Multi-GPU reporting deferred to phase 30 | queued (hierophant, 2026-07-28) |
| 29 | plans/phase-29.md | client boxes self-report `services[]` — ungate `discoverLocalServices()` from the rig.json box-match (line ~600); the other half of phase 23's graceful degradation | queued (hierophant, 2026-07-28) |
| 30 | plans/phase-30.md | multi-GPU reporting — snapshot carries all real compute GPUs (chonko's two P40s), per-GPU Prometheus labels + dashboard repeat (deferred from 28) | reserved (hierophant, 2026-07-28) — brief when 28 lands |
| 31 | plans/phase-31.md | telemetry off docker → pinned user-space systemd units (grim-prometheus/grim-grafana); kills the lab's lone container + the split-brain networking special-case | queued (hierophant, 2026-07-28) |

## Track G — the research brain (phases 14–15)

**Goal:** turn a dropped link/term/note into an understood, filed, project-routed KB
entity. The acquisition front half that `grim ingest`/`grim crawl` never had. Design
dialogue: 2026-07-23; backlog fixture: `tmp/hi/idk.md`.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 14 | plans/phase-14.md | `grim research <drop>` — classify url\|reddit\|term, oracle-dedup, acquire (fetch / `.json` / Google CSE→DDG fallback), ARCHIVIST judge, file KB entity routed to project, `--json` digest | ✅ accepted (`plans/reviews/phase-14.md`) |
| 15 | plans/phase-15.md | feature-request classification + entity type (`needs-triage`, capture-only) + `grim features <project>\|--all` view | queued (blocked on 14) |

## Track H — grim-tavern: the capture doorbell (phase 16)

**Goal:** drop-to-Discord. **grim-tavern** — a thin `researcher` persona on flimflam
forwards drops to `grim research`; grimoire owns the brain, flimflam owns the mouth. The
tavern is where rumors/notes/links get dropped off and turned into filed KB entities.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 16 | plans/phase-16.md | flimflam `researcher` persona + DM handler → `grim research --json` via `ext/grimoire`; fail-loud (fLimfLaMs repo) | queued (blocked on 14+15) |

## Track I — Autopact: the pact runs itself (phases 25–27)

**Goal:** the mage/minion/hierophant loop self-drives and stops only on a **code**
verdict — a decision, a permission, an empty roadmap, a deadlock, or a budget breach —
never re-judged by the model each wake. Design dialogue: 2026-07-26. **Rope ruling
(binding):** the pact commits locally after each accepted phase and **never pushes**;
outward/irreversible actions (deploy, router/DNS, ufw, external/paid) carry `requires:
permission` in the brief header and HALT the router. Notification: terminal only.
Hierophant auto-decides architecture within existing tracks; new scope/track/product/
money HALTs to the user.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 25 | plans/phase-25.md | `grim mm next` — deterministic router: `ACT`/`WAIT`/`HALT <reason>` + exit codes; halt predicate (budget/deadlock/decision/permission/roadmap-empty); `escalate --scope` tag; brief `requires: permission` tag; ROADMAP phase-queue reader | ✅ accepted (`plans/reviews/phase-25.md`) |
| 26 | plans/phase-26.md | `grim mm drive` + `/loop` wiring for mage+minion — self-driving, commit-local/no-push, budget guard, compaction-survival; terminal-only halt | queued (blocked on 25) |
| 27 | plans/phase-27.md | hierophant auto-authority within tracks — escalate-woken (no polling), rules architecture, HALTs to user on scope/product/external; `drive` guard against ruling on reserved decisions | queued (blocked on 25+26) — Track I complete |

## Acceptance bar (mage enforces per phase)

- Success checks in the brief actually run and pass — verify, don't trust the report.
- `git diff --stat` in **both** repos matches the brief's declared footprint exactly.
- Moved code matches grimoire lib style (`'use strict'`, doc-block header — see
  `lib/a1111-client.js`); shims stay under ~20 lines each.
- Briefs may declare `requires: permission` in a header line; `grim mm next` will
  halt with `HALT permission` for such phases (commit locally, never push).
