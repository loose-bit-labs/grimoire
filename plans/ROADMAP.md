# Cross-phase roadmap

**Authority:** hierophant, 2026-07-08; extended 2026-07-17, 2026-07-19, 2026-07-22,
2026-07-26 (Track I Autopact), 2026-07-29 (Track G-v2, phase 32 tavern go-live,
containerization ruling), 2026-08-04 (Tracks K, H, I, O), 2026-08-05 (phase 58
commit guard + acceptance-bar hardening, phase 59 heterogeneous inventory).
Binding for all phases. Last updated 2026-08-08.

Six tracks, one loop. Phases run in numeric order; phases with no listed dependency
may be pulled forward if an earlier one blocks.

- **Track A (phases 1–4):** WanTan extraction — move generic tooling into grimoire. ✅
- **Track B (phases 5–6):** grimoire server as config authority (spec: `tmp/moar.md`). ✅
- **Track C (phase 7):** adopted deltas from the memory-architecture spec (`tmp/other.md`). ✅
- **Track D (phases 8–9):** pact tooling streamline + close the oldest open bug. ✅
- **Track E (phases 10–11):** typed clients + registry generators (spec: `tmp/hi/SERVICE-MESH-LITE.md`).
- **Track F (phases 12–13):** rig telemetry — agent mode + central scrape stack (spec: `tmp/hi/telementry-Full-PoC-Markdown-hand-this-to-your-agent.md`).

**Status (reconciled 2026-07-29): all tracks A–I complete — phases 1–31 accepted in the
`.mm` thread. Queue drained (`grim mm next` → roadmap-empty). Remaining open items are not
numbered phases: phase-20 macOS acceptance is on-trust (spot-check on real hardware), and
the grim-tavern/grim-npc "character memory" design phase is offered but not yet briefed.
One new phase queued 2026-07-29: phase-32 grim-tavern go-live (fLimfLaMs cutover,
user-gated `requires: permission` — the router HALTs on it for the user, by design).**

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

## Ruling on containerization (2026-07-28)

**A service runs as a pinned user-space systemd unit unless it clears a specific bar for
a container.** The whole lab — grimoire, grim-bridge, grim-rig-serve, grim-seer,
grim-world ×2, flimsflams, comfyui, and the pyenv-based NER service — is native
user-space; telemetry's docker prometheus+grafana was the lone exception and is migrated
to native units in phase 31. Docker earns its keep only when **both** hold: (1) the thing
genuinely can't run native — image-only, or a dependency tree you refuse to put on the
host (a real DB with extensions, a pinned-JVM app); **and** (2) you actually need its
isolation (untrusted code, ephemeral/CI, throwaway teardown). On a trusted single-user
LAN box running Go/Node/single-binary services that bar is almost never met — today it is
met by nothing (vectra is embedded, there is no separate DB). **Default: native
user-space unit + pinned binary + palindrome port for grimoire-authored services /
upstream port for third-party.** Reach for a container only after clearing the bar above,
and say which clause. The convention that tempts next is piper (TTS, ships a Dockerfile) —
if stood up as a service, native unit, not the vendored image.

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
| 20 | plans/phase-20.md | plink (macOS): launchd LaunchAgent (`com.grimoire.rig-serve.plist`) + `setup-client.sh` Darwin branch — same `:18081` agent, no systemd. **Acceptance must run on plink, not the Linux loop host.** | ✅ accepted (#0128 in thread) — acceptance on-trust; spot-check on real macOS hardware |
| 21 | plans/phase-21.md | fleet dashboard front-door on `:3003` — hub box serves existing `/cluster`+`/fleet` as a bookmarkable all-hosts view; agent stays `:18081` (role split, not a port move); hub-only deploy | ✅ accepted (#0131 in thread) — Track F core complete |
| 22 | plans/phase-22.md | Grafana provisioning — auto-load Prometheus datasource + hotspots dashboard from files (fixes phase-13 blank-Grafana + host-net networking gap) | ✅ accepted (`plans/reviews/phase-22.md`) |
| 23 | plans/phase-23.md | **PRIORITY incident** — agent serves host+GPU without rig.json (graceful); fixes chonko/meinherz/superack crash-loop (no GRIMOIRE_ROOT on clients) | ✅ accepted (`plans/reviews/phase-23.md`) |
| 24 | plans/phase-24.md | grim-rig unit follows house convention — `%h/.grimoire/bin/node` pinned v21.7.1 + `~/.grimoire` symlink; setup-client.sh ensures it; kills fleet node-drift | ✅ accepted (`plans/reviews/phase-24.md`) |
| 28 | plans/phase-28.md | agent picks the real compute GPU — filter BMC/integrated (chonko's Matrox G200 → 16MB/270463% bug); smi wins over si.graphics for VRAM total; guard percent math. Multi-GPU reporting deferred to phase 30 | ✅ accepted (#0149 in thread) |
| 29 | plans/phase-29.md | client boxes self-report `services[]` — ungate `discoverLocalServices()` from the rig.json box-match (line ~600); the other half of phase 23's graceful degradation | ✅ accepted (#0152 in thread) |
| 30 | plans/phase-30.md | multi-GPU reporting — snapshot carries all real compute GPUs (chonko's two P40s), per-GPU Prometheus labels + dashboard repeat (deferred from 28) | ✅ accepted (#0158 in thread) |
| 31 | plans/phase-31.md | telemetry off docker → pinned user-space systemd units (grim-prometheus/grim-grafana); kills the lab's lone container + the split-brain networking special-case | ✅ accepted (#0155 in thread) — Track F complete |

## Track G — the research brain (phases 14–15)

**Goal:** turn a dropped link/term/note into an understood, filed, project-routed KB
entity. The acquisition front half that `grim ingest`/`grim crawl` never had. Design
dialogue: 2026-07-23; backlog fixture: `tmp/hi/idk.md`.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 14 | plans/phase-14.md | `grim research <drop>` — classify url\|reddit\|term, oracle-dedup, acquire (fetch / `.json` / Google CSE→DDG fallback), ARCHIVIST judge, file KB entity routed to project, `--json` digest | ✅ accepted (`plans/reviews/phase-14.md`) |
| 15 | plans/phase-15.md | feature-request classification + entity type (`needs-triage`, capture-only) + `grim features <project>\|--all` view | ✅ accepted (#0120 in thread) — Track G complete |

## Session orientation (phase 38)

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 38 | plans/phase-38.md | orientation block at the top of `grim load` briefing — client-side time · hostname · pwd (+ `--json orientation`); grounds every session in where/when it is (Rule-13 companion to Rule 15, kills ssh-to-self) | ✅ accepted (#0186 area in thread) — shipped `ba91f9d`, orientation in `bin/grim-session.js` + `--json` |

## Track F cont. — dashboard (phase 37)

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 37 | plans/phase-37.md | per-host **full-width "VRAM / GPU Compute (last 10m)"** row added to the `generate-dashboard.js` template (same targets as the 2m panel, `timeFrom:'10m'`, w:24) + **kill the dual dashboard JSON** (top-level + provisioning mirror drift → one canonical file, generator writes once) | ✅ accepted (thread archived) — shipped `f39d68e`; provisioning JSON → symlink, generator writes one file |
| 39 | plans/phase-39.md | **`grim rig status` from any node** — client boxes (no rig.json) render the fleet via the hub's `/fleet` agent (`aid:18081`, already live); location-transparent (hub = local fan-out, client = remote fetch); `endpoints.rig_hub` registry entry (no DNS — mesh ruling); client-aware error text | ✅ accepted (#0190 area in thread) — shipped `79f6ba7`; 30/30 rig tests green |
| 40 | plans/phase-40.md | **`grim load` 500 fix** — `loadBriefing`/`saveSession` in `bin/grim-session.js` check `isRemote` before `isLocal`, so on aid (both true) the briefing endpoint proxies to itself → recursion → 500. Prefer local (`isRemote && !isLocal`). Regressed with `e3a1122` (added own address to lbl-config) | ✅ accepted (#0199 in thread) — shipped `1d6fdc2`; 35/35 tests green; `grim load` restored on aid |
| 41 | fLimfLaMs `plans/swandive.md` (Phase 1) | **Swandive → full grim-npc character** — re-parent `SwandiveDiscordBot` onto `CharacterDiscordBot` (durable memory, interests, avatar, persona); conversational with follow-ups; research stays a first-class in-conversation action. fLimfLaMs repo; consumes grimoire via `ext/grimoire` only | ✅ accepted (#0202 in thread) — shipped `2e10d17` (fLimfLaMs); CharacterDiscordBot re-parent, IVE persona, DM-only, durable history |
| 42 | fLimfLaMs `plans/swandive.md` (Phase 2) | **Swandive KB tools (agentic, guarded)** — grimoire MCP/CLI tools in her loop: READ (`oracle_search`/`tome_recall`) free; CREATE (`tome_remember`) auto + `swandive`-tag + provenance; UPDATE/RELATE to existing gated by DM 👍; never delete; never auto-commit/push (KB is manual-commit private repo). Propose→approve UX | ✅ accepted (#0205 in thread) — shipped `950a656` (fLimfLaMs); MCP + shell fallback, guarded write, auto-remember with provenance |
| 43 | plans/phase-43.md | **hostname resolution operational** — `grim host gen-hosts` emits one canonical LAN IP per host (dedupe, drop link-local like chonko's `169.254.x`, kill stale `blip .141`) + `--apply` writes an idempotent `# BEGIN/END grimoire-hosts` managed block to `/etc/hosts`; `setup-client.sh`/catch-up applies it so the fleet self-resolves without DNS (mesh ruling) | ✅ accepted (hierophant, 2026-08-02) — Track K |
| 44 | plans/phase-44.md | **finish grimoire.local retirement** — scrub it from user-facing output (`grim-server.js` banner + MCP endpoint URL, `graph.js` errors, ritual/crawl/ner strings) + retire the orphaned `.grim` `config gen hosts` scheme so bare KB-sourced names are the one source of truth | ✅ accepted (hierophant, 2026-08-02) — Track K; runs alongside 43 |
| 45 | plans/phase-45.md | **config cache invalidation** — `grim config invalidate` (force-bust the local last-good cache; next resolve re-fetches or falls back) to pair with existing `grim config sync` (refresh) + freshness visibility (`get`/`status` shows last-fetched + source). Per-box CLI verb; fleet-wide signal is Track L | ✅ accepted (hierophant, 2026-08-02) — Track K; user-requested |
| 46 | plans/phase-46.md | **oracle search relevance** — floor the semantic merge (`grim-oracle.js` merges every vector hit with no threshold → `grim oracle sesame-robot` returns 20, mostly "mentions robot"). Add a cosine floor (~0.4 default) + tunable `--min-score`; keyword/exact matches stay unconditional | ✅ accepted (hierophant, 2026-08-02) — search quality; user-reported |
| 47 | fLimfLaMs `plans/swandive.md` (Phase 3) | **Swandive goal-scout** — she proposes feature-requests from her dives into the `grim features` queue (gated by DM 👍, routed to a project, tagged `swandive`) + routes knowledge nodes to a project instead of orphaning them. Closes research → goals; she feeds the front of the pipeline, doesn't write ROADMAP | ✅ accepted (#0222 in thread) — shipped `21de52a` (fLimfLaMs) + `5c568ce` (grimoire grim_features MCP); goal-scout tool, grim_features MCP, system prompt updated |
| 48 | plans/phase-48.md | **`grim config invalidate` regression** — invalidate deleted aid's cache and stranded it (no `GRIMOIRE_HOST` bootstrap → `sync` fails → all endpoints null → model calls hang; bricked research live). Fix: local-mode falls back to the authoritative repo `config/lbl-config.json`; `invalidate` never strands a box | ✅ accepted (#0231 in thread) — shipped `13001fc`; repo fallback + three-tier bootstrap safety |
| 49 | plans/phase-49.md | **`grim rig history <host>`** — query a host's cpu/ram/gpu/vram over a range (`--last 10m` or `--from/--to`) via Prometheus `query_range`; per-GPU, min/max/avg summary + `--json`; endpoint + metric names from config/emitter, not hardcoded | ✅ accepted (#0234 in thread) — shipped `ecb1fd1`; query_range CLI, Prometheus endpoint from config |
| 50 | fLimfLaMs `plans/swandive.md` (Phase 4) | **Swandive conversational routing** — she routes every message through `grim research`; a follow-up question got web-searched into a hallucination. Add a router: URL/reddit → dive; natural-language question/instruction → converse from history + KB (`oracle_search`), **never** research a question. Honor the LLM's decision to converse | ✅ accepted (#0237 in thread) — shipped `d434e14` (fLimfLaMs); URL/prose router, `buildContext` replaces `getTranscript` |
| 51 | fLimfLaMs `plans/swandive.md` (Phase 5) | **Swandive KB-grounded conversation + ask-when-unsure** — recall ANY topic from the graph (`oracle_search`/`tome_recall`, cite the entity), not just this session's dives; when grounding is empty/ambiguous, **ask or admit** — never confabulate (the "Grimoire Systems SaaS" hallucination). Her IVE Verification | ✅ accepted (#0240 in thread) — shipped `d434e14`; `buildContext` surfaces memories + observations, ask-when-unsure in system prompt |
| 52 | fLimfLaMs `plans/swandive.md` (Phase 6) + `~/src/me/grim-npc` | **Swandive leverages full grim-npc (+ extend it)** — use `setMemory` (subject memory), `addObservation` (deduped evidence), assets — not just transcript; **extend the grim-npc repo** with the missing retrieval API (getMemory/getObservations/search) so memories aren't write-only. grim-npc = her personal memory; KB = the shared graph | ✅ accepted (#0241 in thread) — shipped `d434e14` + `0600741`; observations written, async dives with embed. Note: grim-npc retrieval API extension NOT done — `buildContext` suffices for now |
| 53 | plans/phase-53.md | **`gen-hosts --apply` don't-run-as-root guard** — help says "(needs sudo)" so users `sudo grim …`, running all of grim as root → config won't resolve (root has no lbl-config) + headless X probe dies ("failed to create display" on Pi Zero vier). Reword help (run as user, it sudo's the write) + uid-0 guard (resolve via `SUDO_USER` or refuse with guidance) | ✅ accepted (hierophant, 2026-08-03) — Track K; found onboarding vier |
| 54 | plans/phase-54.md | **`gen-hosts` client/remote mode** — `GrimHost` throws without `GRIMOIRE_ROOT` (grim-host.js:80) and no server endpoint serves the host list, so NO client can run `gen-hosts --apply` (phase 43's client story is impossible as built). Add `GET /api/hosts` + remote-fetch in gen-hosts when `config.host` set / `config.root` absent | ✅ done — hierophant implemented live 2026-08-03 (`a3e47c1`+test); GET /api/hosts + remote-mode gen-hosts, verified with a fake client; 21/21 grim-host tests |
| 55 | fLimfLaMs `plans/swandive.md` (Phase 7) | **Swandive async dives** — research takes >45s (discovery + slow q4), so the synchronous 120s cutoff just yields "Lost the signal." Ack immediately, run research in the background, then post a Discord **embed** (title/digest/sources) with a **"Discuss" button** that opens a grounded conversation about the topic. Supersedes the blocking timeout | queued (hierophant, 2026-08-03) — Track H cont.; depends on 50/51; user-designed |
| 56 | fLimfLaMs `plans/swandive.md` (Phase 8) | **Swandive idea intake** — drop a "new idea" → she asks 2-3 focused questions (embeds w/ project buttons/select) → drafts a routed feature-request → files to `grim features` on 👍. User-initiated goal creation (complements Phase 3 dive-scouting) | queued (hierophant, 2026-08-04) — Track H cont.; depends on 3/5/7; user-designed |
| 57 | plans/phase-57.md | **`grim librarian` — KB durability cadence** — the KB defaulted to *never* pushed (513 uncommitted found live 2026-08-04); aid is a SPOF. `grim librarian commit` (skip-if-clean, code-generated `N new / M updated` message, push, non-fatal on failure, never `--force`, **KB-only**) + nightly user timer on aid + best-effort `grim save` hook. v1 durability only; curation deferred to v2 | ✅ accepted (loop, `230a5c2`+`ea7154c`+`fa4c410`) — 6/6 tests; **follow-up:** `grim-librarian.js` CLI runs on `require()` (breaks `grim save`); fix: wrap in `if (require.main === module)` + save/restore `process.argv` in session hooks |
| 58 | plans/phase-58.md | **pact commit guard** — no pact verb commits phase *code*, so a local model improvised `git config T; git add -A; git commit -m init` and poisoned `.git/config` (3 commits re-authored + force-pushed to fix). Add `assertRealIdentity()` (refuse placeholder identities, never *set* one) + hardened `grim mm commit --phase N --files …` (explicit staging, structured message, never `git add -A`) + wire the gate into `archive`/`drive` + point skills at the verb | ✅ accepted (`d04ef18`) — 27/28 tests (1 pre-existing legacy-format failure); **follow-up:** circular dep `grim-mm.js`↔`grim-mm-drive.js` from reverse require; move `assertRealIdentity` to `lib/git.js` |
| 59 | plans/phase-59.md | **heterogeneous host inventory** — vier (Pi Zero 2 W) registered but inventory is x86-centric (`CPU: unknown`, `RAM: 0GB`, `DMI unavailable`); fleet also has laptops with no battery info. ARM device-tree fallbacks (CPU/board model, sub-1GB RAM in MB) + laptop battery/chassis via **sysfs only, no sudo** (`/sys/class/power_supply/BAT*`, `/sys/class/dmi/id`) + entity schema (`battery`, `total_mb`, `is_laptop`) + softer GPU/mobo labels. Graceful; x86 unchanged | ✅ accepted (loop, `f69a41f`+`7637f4e`) — 23/23 tests (librarian 6/6, session 5/5, platform-gather 12/12); x86 regression verified on aid; **follow-up:** on-hardware verification on vier (Pi Zero 2 W) + a laptop |

**Track L (future, not yet briefed):** manage the fleet's **user-level systemd units via API**
(replace the ad-hoc manual `systemctl --user` management) + **fleet-wide config invalidation**
(a version/etag on `/config/lbl` so clients cheaply detect staleness; a reload signal — SIGHUP
or version-bump — for long-running services like grim-server and the flimflams bots to reload
in-memory config). Recorded 2026-08-02 from the user's "future where we manage user-level
systemctl config via API." Needs a design pass before phases.

## Deploy hygiene (phase 36, aid-only)

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 36 | plans/phase-36.md | roll `grimoire.service` system unit → user-space (house convention: `%h/.grimoire/bin/node` pinned, `default.target`, log-append); drop the cross-scope ollama ordering; create the missing aid pin (closes phase-24 gap). **`requires: permission`** — sudo + brief KB outage, user-gated cutover | ✅ done — live cutover 2026-07-30 (`df2c28a`); now `/user.slice`, pinned node, KB read+write verified, system unit retired; closed the phase-24 aid pin gap. Last system-scope holdout gone (only ollama remains, third-party & being retired for llama.cpp) |

## Track G-v2 — research brain, agentic acquisition (phases 33–35)

**Goal:** the intention v1 never reached — *one drop in, the tool discovers what's worth
reading and digs into it itself.* If the human has to name the repo, the tool failed.
Design dialogue: 2026-07-29 (triggered by a thin `grim research` on hindsight.vectorize.io
— a SPA whose real substance was in a repo + arxiv paper it never noticed). Compositional:
reuses the existing search + `grim archaeologist`. Feeds the future memory track (Track J)
via provenance-at-write.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 33 | plans/phase-33.md | autonomous discovery — link-scan acquired text for repo/paper/doc links + thin-yield→CSE/DDG search fallback (finds the repo even when a SPA shell hides it); `discovered[]` in `--json`/`--dry-run`; bounded depth-1 | ✅ accepted (hierophant, 2026-07-29) |
| 34 | plans/phase-34.md | dig discovered repos via `grim archaeologist` (clone-then-catalog or URL); fold repo facts into the digest; bounded, graceful, temp-clone cleanup | ✅ accepted (blocked on 33) — shipped `583846b` + `7817bd3` (timeout fix); 34/34 green |
| 35 | plans/phase-35.md | paper reader (arxiv abs/ar5iv HTML) + multi-source synthesis with `sources` provenance (= Hindsight "Observations"); think-on for research drops; supersede thin stubs in place | ✅ accepted — Track G-v2 complete |

## Track H — grim-tavern: the capture doorbell (phase 16)

**Goal:** drop-to-Discord. **grim-tavern** — a thin `researcher` persona on flimflam
forwards drops to `grim research`; grimoire owns the brain, flimflam owns the mouth. The
tavern is where rumors/notes/links get dropped off and turned into filed KB entities.

| Phase | Brief | What lands | Status |
|-------|-------|-----------|--------|
| 16 | plans/phase-16.md | flimflam `researcher` persona + DM handler → `grim research --json` via `ext/grimoire`; fail-loud (fLimfLaMs repo) | ✅ accepted (#0123 in thread) — code-accepted, NOT deployed |
| 32 | plans/phase-32.md | **grim-tavern go-live** — cut `flimsflams` over to the researcher. NOT a cherry-pick: the bot rides the 78-file `config-reorg-2026-06-25` refactor (deletes old bots, rewires to grim-npc). Staged, reversible cutover; `requires: permission` (live-service restart, user-gated) | ✅ **CLOSED 2026-08-06** — superseded by Track G-v2 `researcher.service` (`fLimfLaMs 15b664a`); the cutover landed as part of the G-v2 refactor rather than as a standalone phase |

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
| 26 | plans/phase-26.md | `grim mm drive` + `/loop` wiring for mage+minion — self-driving, commit-local/no-push, budget guard, compaction-survival; terminal-only halt | ✅ accepted (#0141 in thread) |
| 27 | plans/phase-27.md | hierophant auto-authority within tracks — escalate-woken (no polling), rules architecture, HALTs to user on scope/product/external; `drive` guard against ruling on reserved decisions | ✅ accepted (#0146 in thread) — Track I complete |

## Track O — grimoire HA / no single point of failure (phase 57 + future)

**SPOF ruling (2026-08-04):** aid holds the grimoire (KB, config authority, routing, telemetry
hub). The whole fleet resolves through one bit of client config — *"who has the grimoire open?"* —
which is the right design, but it makes aid a hard single point of failure. Found live: the KB had
**513 uncommitted files** (months of knowledge, never pushed) because no push cadence was ever set
— it defaulted to *never*. Backlog committed + pushed by hand 2026-08-04.

The SPOF decomposes into three pieces, cheapest-highest-value first:

1. **Durability (phase 57)** — `grim librarian`: KB commit + push on a cadence (nightly timer on aid
   + best-effort `grim save` hook). Kills the *data-loss* mode. v1 durability only; curation (prune
   stale dreams, dedup, path-fix) is a deferred v2 pass under the same command.
2. **Failover locator (future)** — the single client config becomes an **ordered list** of grimoire
   candidates (`aid`, then a standby); the client health-checks `/health` and picks the live one.
   Preserves the "one config = the locator" model while killing the *availability* mode.
3. **Warm standby (future)** — a designated second box keeps a clone of repo + KB, pulls
   periodically, can `systemctl start grimoire` on demand. Cold/warm is enough at this scale; no
   live replication.

Sequence: durability now (protects against irreversible loss), then pieces 2–3 as a later arc.

## Track P — repo hygiene (phase 60)

Found live 2026-08-06: `node --test test/` **hangs** (leaky server test) and 5 files fail — the suite
is unrunnable as a whole. Cruft, not features. This restores a trustworthy `node --test test/`.

| Phase | Brief | What | Status |
|-------|-------|------|--------|
| 60 | plans/phase-60.md | **test-suite hygiene** — kill the `grim-rig-serve` hang (close listeners), de-couple the two roadmap-empty tests from the *live* `plans/ROADMAP.md` onto a fixture, `mkdir -p` the dashboard writer's dir, prune the stale mm brief-format test, mock/tag the live-hub `rig` test. Rides along: reconcile dup 53/54 rows, close superseded phase 32. | ✅ accepted (hierophant-verified 2026-08-06) — Track P; `node --test` 373/373 green + self-terminating, hang killed, dups + phase 32 reconciled |
| 66 | plans/phase-66.md | **make the suite genuinely, deterministically green** — two phase-60 residues: (a) `platform-gather.test.js` "aid registers cleanly" `execSync`s the register script which POSTs to the live server → fails with `grimoire.service` down; (b) `grim-rig-serve.test.js` binds **hardcoded ports** → intermittent `EADDRINUSE` **hang** (~1/3 runs). Fix (a) hermetic (dry-run/stub the POST), (b) bind **ephemeral port 0** + read back. Suite must pass N× with the service **down** and never hang. | queued (hierophant, 2026-08-06) — Track P; found via phase 64/65 |

## Track Q — HMM Tracking ("The Guild Hall") (phases 61–63)

Design: `plans/track-hmm-tracking.md`. Live visibility into the h/m/m pact loops across the fleet —
who's working/waiting/done — as a cute 3D-meeple viewer. Beside Track F: telemetry watches *GPUs*,
this watches *sessions*. User-designed (`/tmp/hmm.md`). Decisions (user, 2026-08-06): grimoire REST+WS
primary (Prometheus for history) · inlined Three.js meeples · **thin vertical slice first**.

| Phase | Brief | What | Status |
|-------|-------|------|--------|
| 61 | plans/phase-61.md | **thin vertical slice, aid only** — `lib/hmm.js` status state machine (parse `.mm` + `grim roadmap`), `grim rig` `GET /hmm`, grimoire `GET /api/hmm` (aid-only) + `/hall`, `grim hmm` CLI, rough Three.js Guild Hall. Proves the whole pipe end-to-end | queued (hierophant, 2026-08-06) — Track Q |
| 62 | plans/phase-62.md | **fleet fan-out + WS + Prometheus** — `/api/hmm` fans out to all `rig.json` boxes (mirror `/fleet`, down-box tolerant), WS push-on-change, `hmm_*` gauges, host/project switcher | queued (hierophant, 2026-08-06) — Track Q; depends on 61 |
| 63 | plans/phase-63.md | **Guild Hall polish** — full status→meeple animations, idle-cycle tour, gray-out on inactivity, `/api/hmm/:host/:project` info-panel, distinct per-role avatars | queued (hierophant, 2026-08-06) — Track Q; depends on 62 |

## Track K cont. — fresh-client robustness (phases 64–65)

Found live on the **new box joining the fleet** (same way vier gave us 53/54/59): first-run CLI commands
die with cryptic errors instead of resolving aid via lbl-config. Both are onboarding blockers.

| Phase | Brief | What | Status |
|-------|-------|------|--------|
| 64 | plans/phase-64.md | **`grim host list` remote mode** — clients (no `GRIMOIRE_ROOT`) throw `local KB required` instead of fetching from aid. Add `GET /api/hosts/inventory` + a `list()` remote fallback mirroring `gen-hosts` (phase 54). Byte-identical local vs remote | ✅ accepted (hierophant-verified 2026-08-06) — Track K; endpoint + remote fallback + byte-identical confirmed, tests made hermetic after a revise (0267) |
| 65 | plans/phase-65.md | **`grim rig` `Invalid URL` fix** — `resolveRigHub` destructures `URL.host` (hostname:port) and appends `:18081` → double-port `http://aid:3663:18081`. Use `.hostname`. Real bug (masked on aid by local path); also the true cause of phase 60's rig-test failure | ✅ accepted (hierophant-verified 2026-08-06) — Track K; **code fix landed early in phase 60 (`ac3b501`)**, phase 65 added the URL-shape guard test (`75586d3`). Track K complete — new box unblocked |

## Acceptance bar (mage enforces per phase)

- Success checks in the brief actually run and pass — verify, don't trust the report.
- **A test existing (or a module loading) is not acceptance — the behavior must be
  observed in its real invocation path.** For a guard/safety feature, demonstrate it
  *triggers* (e.g. the drive preflight refuses a placeholder identity), not just that its
  function is defined. (Phase 58's guard passed review while dead via a circular-dep —
  never again.)
- **Warnings in your own run are findings, not noise** — a circular-dependency /
  deprecation warning is chased before you report green.
- `git diff --stat` in **both** repos matches the brief's declared footprint exactly.
  Out-of-scope finds are **escalated, not silently committed** (no unbriefed commits).
- Moved code matches grimoire lib style (`'use strict'`, doc-block header — see
  `lib/a1111-client.js`); shims stay under ~20 lines each.
- Briefs may declare `requires: permission` in a header line; `grim mm next` will
  halt with `HALT permission` for such phases (commit locally, never push).
