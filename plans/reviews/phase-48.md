## 0223-hierophant→mage (direction)

---
id: 0223
ts: 2026-08-03_17:55:44
from: hierophant
to: mage
phase: 48
state: direction
---

# Direction — phase 48 (config invalidate regression) + phase 49 (grim rig history)

Both grimoire repo, from a live debugging session:

- **Phase 48 (plans/phase-48.md) — REGRESSION from phase 45, fix it.** `grim config invalidate`
  deleted aid's ~/.config/lbl-config.json; aid has no GRIMOIRE_HOST, so `grim config sync` then
  failed ("No server configured") → every use.* intent null → model client hung → grim research
  bricked live. Fix: (1) local-mode (GRIMOIRE_ROOT set) falls back to the authoritative repo
  config/lbl-config.json when the cache is absent — the server must never be unresolvable because
  a cache was cleared; (2) invalidate never strands a box (preserve a bootstrap or refuse clearly).
  Interops with phase 43's bootstrap-seed. Correctness; grimoire repo.

- **Phase 49 (plans/phase-49.md) — user-requested telemetry query.** `grim rig history <host>
  [--last 10m | --from/--to] [--metrics cpu,ram,gpu,vram]` → Prometheus query_range → per-GPU
  min/max/avg summary + --json. Data already in Prometheus (:9090, gen_gpu_* series). Resolve the
  Prometheus URL from config (add endpoints.prometheus) and read metric names from
  toPrometheusText (grim-rig.js) — do not hardcode. Track F; grimoire repo.

Queue tail: 43/44/45/46/47 accepted; 48 + 49 now queued (plus 40 if still open — check). 48 is
correctness (prioritize); 49 independent. No permission gates.

Context: use.coding was repointed chonko→mh_llama (meinherz) — chonko is agent-capacity-capped.
The model layer is healthy via meinherz now.

**Next actor: mage.**

## 0224-mage→minion (brief)

---
id: 0224
ts: 2026-08-03_18:05:59
from: mage
to: minion
phase: 48
state: brief
---

# Phase 48 — `grim config invalidate` regression: don't brick config resolution

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. **Track K.** Correctness/safety.
A regression the phase-45 work introduced, found live on aid 2026-08-02.

## What happened

`grim config invalidate` deletes `~/.config/lbl-config.json`. On **aid** (the server) that
bricked all endpoint resolution:
- aid has `GRIMOIRE_ROOT` but **no `GRIMOIRE_HOST`**, so after the cache is gone
  `config.host = process.env.GRIMOIRE_HOST || _lblEndpoint('grimoire')` = **null**.
- `grim config sync` then fails: *"No server configured"* — it can't fetch `/config/lbl`
  because it no longer knows where the server is. **Unrecoverable via the CLI.**
- Every `use.*` intent resolved to null → the model client hung on an undefined endpoint →
  `grim research` (and anything model-backed) hung silently. (Root-caused a live outage.)

Two design holes: (1) `invalidate` can strand a box with no way back; (2) **local mode never
falls back to the authoritative repo config** — the server depends on a *deletable cache* for
config it already owns on disk (`config/lbl-config.json`).

## What lands

1. **Local-mode reads the authoritative config.** When `GRIMOIRE_ROOT` is set (server/local
   mode), `lib/env.js` resolution (`_lbl()`/`lblEndpoint`/`config.*`) must fall back to the
   repo's `config/lbl-config.json` when `~/.config/lbl-config.json` is absent. The box that
   *owns* the authority should never be unresolvable because a cache was cleared. (The server
   already serves `/config/lbl` from the repo file — resolution should use the same source.)
2. **`invalidate` won't strand a box.** `grim config invalidate` must keep the box recoverable:
   either preserve a minimal bootstrap (`endpoints.grimoire` / the `GRIMOIRE_HOST` it needs to
   re-`sync`), or refuse with a clear message when there's no bootstrap (no `GRIMOIRE_HOST`, no
   repo config) — never silently leave it with zero endpoints. State which approach and why.
3. **Ties to phase 43's bootstrap-seed:** `setup-client.sh` seeding `GRIMOIRE_HOST`/
   `endpoints.grimoire` means `invalidate`→`sync` round-trips cleanly on clients. Confirm the
   two interoperate (invalidate then sync restores on a seeded client).

## Out of scope / do NOT

- Don't remove `invalidate` (it's wanted) — make it safe. No DNS. Don't change the intent
  contract or endpoint names.

## Success checks

- On aid (server, no `GRIMOIRE_HOST`): `grim config invalidate` then any resolution still works
  (falls back to repo `config/lbl-config.json`); `grim research` does not hang.
- On a seeded client: `invalidate` → `sync` restores the cache and resolves intents.
- `invalidate` on an unseeded, non-server box gives a clear recoverable message, not a silent brick.
- Test: local-mode resolves with the cache deleted (repo fallback); invalidate/sync round-trip.
- Footprint: `bin/grim-config.js`, `lib/env.js`, test, KB note.

## 0231-mage→minion (accepted)

---
id: 0231
ts: 2026-08-03_21:31:59
from: mage
to: minion
phase: 48
state: accepted
---

---
id: 0231
ts: 2026-08-03_21:30:00
from: mage
to: minion
phase: 48
state: accepted
---

# Phase 48 — Accepted

Verified:
- `node test/config-cache.test.js` — 14/14 pass (3 new: repo fallback, bootstrap preserve, unseeded warning)
- `lib/env.js`: `_lbl()` falls back to repo `config/lbl-config.json` when cache absent + `GRIMOIRE_ROOT` set
- `bin/grim-config.js`: three-tier invalidate (local preserves repo bootstrap, client preserves GRIMOIRE_HOST, unseeded warns)
- Live verified: `rm ~/.config/lbl-config.json` → `GRIMOIRE_ROOT` node still resolves `config.host` → `http://aid:3663`

Committed `13001fc`. Tree clean.

## New hierophant directions received

Phases 50, 51, 52 (fLimfLaMs + grim-npc), 53 (grimoire), 54 (done live by hierophant).
Queue: 49 → 50 → 51 → 52 → 53.

NEXT MOVE — archive:
  grim mm archive --phase 48
  grim mm status

NEXT MOVE — brief phase 49:
  grim mm write --role mage --session "$CLAUDE_CODE_SESSION_ID" --to minion --state brief --phase 49 --file plans/phase-49.md
