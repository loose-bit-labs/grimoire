# Phase 87 — Config-read robustness: a decayed lbl-config cache can never mis-route

**Authority:** hierophant, 2026-08-28. **Repo:** grimoire. **Track: B cont. (config authority).**
**Depends on:** nothing. Closes a documented-incomplete edge of the lbl-config→dynamic-endpoint
migration (`concept_lbl_config_dynamic_service_endpoint_migration_retire_the_sta`).

## Why

2026-08-28: the research-queue drain OOM-looped because text tasks routed to **Ollama** (chonko, no
text model) instead of the configured **meinherz:11311** (llama.cpp, qwen3.8-27B). Root cause was
**not** a routing decision — the authoritative config (server + repo `config/lbl-config.json`) has
`use.coding → mh_llama → http://meinherz:11311`. The **local `~/.config/lbl-config.json` on aid had
decayed to a 2-key stub** (`{use:{grimoire}, endpoints:{grimoire}}`), and two gaps let it mis-route
silently:

1. **`model-ask.js` rolls its own config reader** — `_lbl()` (bin/model-ask.js:47) does a raw
   `readFileSync` of the home cache with **no fallback**, then caches `CODING_BASE`/`OLLAMA_BASE` at
   **module load**. Stub → `CODING_BASE = null` → the `askOpenAI` path is skipped → Ollama branch.
2. **The freshness hook isn't wired to library consumers** — `refreshEndpoints()` is called only from
   `model-ask.js:436` (its own CLI). `grim research` imports `askJSON` as a **library** and never
   refreshes, so it runs on the stale module-load value.
3. **`lib/env.js`'s repo fallback only fires on an *absent* cache** (env.js:37–48, the `catch`). A
   *present-but-partial* stub reads fine, so `lblEndpoint('coding')` returns null even via env.js —
   the safety net has a hole for the exact failure we hit.

This is the second time a decayed stub has caused an outage (2026-08-11 was the first, fLimfLaMs
`Handy`). Syncing is a band-aid; the fix is to make a bad cache *harmless*.

## What lands

- **`lib/env.js` — repo config as a merge-floor.** `_lbl()` loads the repo canonical
  `config/lbl-config.json` as a base and **deep-merges the user cache (and server-fetched config) over
  it**, so any key the cache is missing falls through to the repo default — not just when the cache is
  wholly absent. Precedence stays: env var > server/cache overlay > repo floor. A decayed stub can no
  longer *remove* a key the repo defines. (Keep `refreshLblCache` writing the server's full config to
  the cache; this change only hardens the read.)
- **`bin/model-ask.js` — resolve endpoints through `lib/env.js`, at call time.** Drop the private
  `_lbl()`/`_lblEndpoint()`; import `lblEndpoint` from `../lib/env` and resolve `CODING_BASE`/
  `OLLAMA_BASE` **inside `ask()` per call** (env var > `lblEndpoint('coding'|'ollama')`), not as
  module-load constants. Correctness no longer depends on any consumer remembering to call
  `refreshEndpoints()` (keep it for server-freshness, but it's an optimization, not a dependency).
- **`bin/model-ask.js:267` — resolveModel floor (defense-in-depth).** Replace the unguarded
  `if (!best || bestScore === 0) return resolveModel('default')` with
  `if (!best || bestScore === 0 || task === 'default') return STATIC_FALLBACK[task] || STATIC_FALLBACK.default`
  so an all-zero-score installed set **degrades** instead of infinite-recursing into OOM.

## Footprint

`lib/env.js`, `bin/model-ask.js`, `test/config-cache.test.js` (or `test/env.test.js`),
`test/model-ask.test.js`.

## Success checks

- **The regression that would have caught this:** with a **present-but-partial** cache written to a
  temp `LBL_CACHE_PATH` (only `{use:{grimoire:'grimoire'}, endpoints:{grimoire:'…'}}`),
  `env.lblEndpoint('coding')` still resolves to the repo floor's `http://meinherz:11311` (merge-floor),
  **not** null.
- **model-ask routes correctly on a stub:** with that same stub cache and no `refreshEndpoints()` call,
  an `OPENAI_TASKS` task (e.g. `extraction`) resolves `CODING_BASE` to meinherz and takes the
  `askOpenAI` path — asserted without hitting the network (stub the HTTP call / assert the chosen
  base), proving it does **not** fall to the Ollama branch.
- **resolveModel bounded:** with an installed set where every model scores 0 for a text task,
  `resolveModel('extraction')` returns a `STATIC_FALLBACK` entry and **returns** (no recursion) — a
  timing/heap-bounded assertion, not a hang.
- Env-var override still wins over both cache and repo floor (precedence preserved).
- `node --test test/config-cache.test.js test/model-ask.test.js` green; full suite green +
  self-terminating.

## Out of scope

- The fLimfLaMs `Handy` straggler (same class, different repo) — note it, don't fix it here.
- Deleting the static `~/.config/lbl-config.json` (the migration's final step) — still premature; this
  phase makes the read *safe*, it does not retire the file.
- Wiring `use.coding`/model routing values — already correct in the authority; this is purely about a
  consumer reading them reliably.
