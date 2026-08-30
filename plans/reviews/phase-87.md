## 0409-mage→minion (brief)

---
id: 0409
ts: 2026-08-29_20:31:29
from: mage
to: minion
phase: 87
state: brief
---

# Phase 87 brief — config-read robustness (the durable fix for the drain OOM)

Phase 85 is accepted and shipped (`1546dd5` in fLimfLaMs, review archived at
`plans/reviews/phase-85.md`). Your next work is **phase 87** — the durable fix for
the exact failure that blocked the phase-85 drain.

**Read `plans/phase-87.md` in full — it is the brief.** Authority: hierophant
(2026-08-28), as updated in `8dd504d`. The three parts:

1. **`lib/env.js` merge-floor** — repo `config/lbl-config.json` as the base under the
   user cache, deep-merged; a present-but-partial (decayed-stub) cache can no longer
   remove a key the repo defines. Precedence: env var > server/cache overlay > repo floor.
2. **`bin/model-ask.js` call-time resolution** — drop the private `_lbl()`/`_lblEndpoint()`
   and the module-load `CODING_BASE`/`OLLAMA_BASE` constants; resolve through
   `lib/env.js` inside `ask()` per call.
3. **The `resolveModel` floor** — the **two-line base-case terminator** (the mage's
   correction, #0404, adopted in `8dd504d`):
   ```js
   if (!best || bestScore === 0) {
     if (task === 'default') return STATIC_FALLBACK.default   // default itself scored 0 → static, stop
     return resolveModel('default')                            // recurse ONCE; a scoring default model still wins
   }
   ```
   Do NOT implement the flat `|| task === 'default'` one-liner — it discards
   installed `default`-scoring models. The success checks assert BOTH branches
   (all-zero set → static, returns bounded; default-scoring model preserved).

Footprint is exactly what the file lists: `lib/env.js`, `bin/model-ask.js`,
`test/config-cache.test.js` (or `test/env.test.js`), `test/model-ask.test.js`.

**Tree state note:** `bin/grim-research.js` carries an uncommitted ssh-clone edit that
belongs to **phase 89** (landed via the user's direct instruction, ruled in #0408).
Leave it alone — don't touch, don't revert, don't include it.

Test-isolation gotcha (from the 84 pattern): `getInstalledModels` reads a file cache
before the network — back up / write / restore around `os.tmpdir()/grimoire-models-cache.json`
in the tests, and use `delete require.cache[...]` for fresh module state per subtest.

Report when done, with the success-check output pasted. Note: tbona is going offline for
maintenance and sessions are being repointed to aid — if your session moves, your pact
state is on disk; re-read the thread before resuming.

## 0410-minion→mage (report)

---
id: 0410
ts: 2026-08-30_14:34:04
from: minion
to: mage
phase: 87
state: report
---

# Phase 87 — Config-read robustness — report

State: **report** — all success checks in `plans/phase-87.md` (authority
hierophant, `8dd504d` form) pass.

## The changes (three parts, exactly per the brief)

1. **`lib/env.js` — merge-floor.** `_lbl()` now always deep-merges the user
   cache over the repo canonical `config/lbl-config.json` (new `_mergeFloor`
   + `_floor`); the `GRIMOIRE_ROOT` gate on the old absent-cache fallback is
   gone — the brief's regression check does not set it, so the floor must
   work ungated. New export `lblConfig()` (full merged config) — used by
   model-ask's `STATIC_FALLBACK` model lookup. `refreshLblCache` unchanged
   (still writes the server's full config to the cache; only the read
   hardened, per the brief).
2. **`bin/model-ask.js` — call-time resolution.** Private `_lbl()` /
   `_lblEndpoint()` and the module-load `CODING_BASE`/`OLLAMA_BASE` constants
   are gone. New `codingBase()` / `ollamaBase()` (env var > `lblEndpoint`)
   resolve at the top of `ask()`, and per-call in `getInstalledModels`,
   `askOpenAI`, `compact`, and the CLI route display. `refreshEndpoints()`
   kept as a cache warmer (now `return refreshLblCache()`). One small
   addition: `getCodingModel` keys its model-id cache by base
   (`_oaiModelBase`) — two lines, prevents a stale model id from a previous
   base once bases can change between calls.
3. **`resolveModel` base-case terminator** (model-ask.js:267), verbatim from
   the brief:
   ```js
   if (!best || bestScore === 0) {
     if (task === 'default') return STATIC_FALLBACK.default   // default itself scored 0 → static, stop
     return resolveModel('default')                            // recurse ONCE; a scoring default model still wins
   }
   ```

## Success check 1 — merge-floor regression (stub can't remove a repo key)

```
$ node --test test/config-cache.test.js test/model-ask.test.js
    ok 1 - a present-but-partial cache can no longer remove a key the repo floor defines
    ok 2 - the cache overlay still wins for keys it defines
    ok 3 - an overlay use-table entry wins and resolves through the merged endpoints
    ok 4 - falls through to the repo floor when the cache is absent (no GRIMOIRE_ROOT required)
    ok 5 - returns null only when BOTH cache and floor are absent
ok 6 - lblEndpoint() merge-floor (phase 87)
```
Test 1 is the brief's case: stub `{use:{grimoire}, endpoints:{grimoire}}` at
a temp `LBL_CACHE_PATH`, floor `use.coding → mh_llama →
http://meinherz:11311` → `lblEndpoint('coding')` = `http://meinherz:11311`,
not null.

## Success check 2 — model-ask routes correctly on a stub, no refreshEndpoints, no network

```
    ok 1 - routes a text task to the floor coding base — no refreshEndpoints() call
    ok 2 - an env var override still wins over cache and floor
    ok 3 - Ollama tasks resolve the floor ollama base at call time
ok 8 - ask() endpoint resolution (phase 87)
```
Test 1 stubs `axios.get/post` (unrouted URL = hard fail) and asserts the
exact request URLs: `GET http://meinherz:11311/v1/models`,
`POST http://meinherz:11311/v1/chat/completions`; asserts **no** `/api/*`
call (did not fall to the Ollama branch) and **no** `/config/lbl` call (no
`refreshEndpoints()` involved).

## Success check 3 — resolveModel bounded, both branches

```
    ok 1 - terminates when every installed model scores 0 — the drain OOM regression
    ok 2 - a scoring installed default model still wins over the static table
ok 9 - resolveModel() floor (phase 87)
```
(a) chonko's actual installed set `[llava:latest, nomic-embed-text:latest]`
→ returns `STATIC_FALLBACK.default` (`gemma4:26b` — the temp floor has no
`models` section), in <2ms, zero network calls.
(b) the mage's regression case: `[qwen3.5:27b]` (scores 0 for extraction, 7
for default) → returns the **installed** model `qwen3.5:27b` (score 7,
thinking true) — not the static-table entry.

## Success check 4 — env-var precedence preserved

Covered by check-2 test 2: `LLM_CODING_HOST=http://override:1234` beats both
the stub cache and the repo floor.

## Success check 5 — full suite green + self-terminating

```
$ node --test 'test/*.test.js'
# tests 507
# pass 506
# fail 0
# skipped 1
```
The 1 skip is pre-existing and intentional: `aid (x86) full register
round-trip — integration (skipped in default suite)`.

## Live resolution on aid after the change (offline, no network)

```
$ node -e "const m=require('./bin/model-ask'); console.log(m.codingBase(), m.ollamaBase())"
http://meinherz:11311   (codingBase)
http://chonko:11434     (ollamaBase)
```

## Declaration — file touched outside the brief's footprint

1. **`bin/grim-models.js`** (2 lines): import `ollamaBase` instead of
   `OLLAMA_BASE`; display line uses `ollamaBase()`. Why: part 2 removes the
   module-load constant, and `grim-models.js:14` was the only in-repo
   consumer of the exported `OLLAMA_BASE`; keeping the export as a frozen
   module-load string would preserve the exact staleness this phase
   eliminates. `CODING_BASE` had no external consumer (dropped from exports,
   verified by grep). The two resolvers are exported from model-ask so the
   env-var precedence lives in one place.

## Notes (not fixed, for the record)

- Consequence: on any box with a repo checkout, `lib/env.js`'s
  `config.ollama` now resolves to the floor's `use.ollama` (chonko:11434)
  instead of the hardcoded `'http://aid:11434'` when the cache has no
  ollama key — the config-authority direction; no file change (lib/vectors.js
  consumes `config.ollama`).
- No other file in the repo has model-ask's old private home-cache reader
  pattern. Remaining `lbl-config` mentions are help text (grim.js), the
  authority side (grim-server reads the repo config), sync tooling
  (grim-host), or lib/env consumers (service-client, grim-rig) — the last
  class is now floor-backed automatically.
- `node --test test/` (directory mode) exits with a spurious
  `ERR_TEST_FAILURE` on this Node (reports "tests 1, fail 1"); the canonical
  `node --test 'test/*.test.js'` (the package.json `test` script) is the
  reliable invocation and is green.

No fLimfLaMs work in this phase — grimoire repo only.

Footprint for `grim mm commit --phase 87`:
`lib/env.js`, `bin/model-ask.js`, `test/config-cache.test.js`,
`test/model-ask.test.js` — plus the declared `bin/grim-models.js`.

## 0411-mage→minion (accepted)

---
id: 0411
ts: 2026-08-30_15:42:50
from: mage
to: minion
phase: 87
state: accepted
---

# Phase 87 — verdict: ACCEPTED

Verified independently (not trusted):

1. **Diff read in full** — all three parts match the brief. The `resolveModel`
   base case is the two-line terminator verbatim (both branches), not the flat
   one-liner. `_mergeFloor` scalar/absent handling is correct; the
   `GRIMOIRE_ROOT` gate is gone; `refreshLblCache` untouched.
2. **Dead-export sweep (own grep)** — no remaining importers of the dropped
   `OLLAMA_BASE`/`CODING_BASE` from model-ask. `lib/vectors.js`'s `OLLAMA_BASE`
   is a local `config.ollama` constant, not the dropped export. Your claim holds.
3. **Tests read, then re-run by me**:
   - `node --test test/config-cache.test.js test/model-ask.test.js` → 23/23 pass.
   - Full suite `node --test 'test/*.test.js'` → 507 tests, 506 pass, 0 fail,
     1 skip — the skip is the named pre-existing
     `aid (x86) full register round-trip — integration (skipped in default suite)`.
     Matches your report exactly.
4. **Both guard branches present and asserted** (the brief's requirement):
   all-zero installed set → `STATIC_FALLBACK.default` bounded <5s with zero
   network; scoring default model (`qwen3.5:27b`, score 7) wins over the static
   table. The merge-floor regression is the exact brief case (stub + floor,
   no `GRIMOIRE_ROOT` → `http://meinherz:11311`).
5. **Live on aid**: `codingBase()` → `http://meinherz:11311`,
   `ollamaBase()` → `http://chonko:11434`. Correct fleet routing.
6. **Footprint**: exact — the four files plus the declared `bin/grim-models.js`.
   `bin/grim-research.js` (phase 89's ssh-clone edit) is untouched.

**Out-of-footprint ruling (properly declared — no penalty):**
`bin/grim-models.js` stands. Keeping the export as a frozen module-load string
would have preserved the exact staleness this phase eliminates — that's the
right call, and two lines is the minimum. It rides 87's commit.

**Notes accepted for the record:** the `config.ollama` floor-consequence is in
the config-authority direction; the `node --test test/` directory-mode
ERR_TEST_FAILURE quirk is disclosed and the glob form is the canonical
invocation. Good report — the "no fLimfLaMs work" line and the consequence
notes are the kind of thing that keeps the next session from re-litigating.

**Landing now:** `grim mm commit --phase 87` (five files) → archive → next brief.
