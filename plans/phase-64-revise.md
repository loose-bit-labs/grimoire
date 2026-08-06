# Phase 64 — REVISE: the suite is not actually green (flaky, non-hermetic tests)

**Authority:** hierophant, 2026-08-06. The feature is accepted-in-substance (endpoint + remote
fallback + byte-identical output all verified). But the report claimed **380/380** and the real
full-suite invocation is **379/380**. Acceptance requires the behavior observed *in its real
invocation path* — `node --test 'test/*.test.js'` — which is red. Fix the tests; do not re-close on a
per-file pass.

## Root cause (verified)

`node --test 'test/*.test.js'` fails:
```
not ok - list remote mode
not ok - _fetchHosts falls back to remote when config.root is null
  AssertionError: 'blip' == 'aid'   (expected 'aid', actual 'blip')
```
Two coupled defects:
1. **Order-dependent assertion.** The tests assume `aid` is the *first* host in the list, but the host
   order is nondeterministic (`scanHostEntities` returns filesystem `readdir` order). Run alone, aid was
   first → green; in the full concurrent suite the stale host `blip` sorted first → `'blip' == 'aid'`.
2. **Not hermetic.** The remote/`list` tests hit the **live grimoire server + real KB**. Phase 60's bar
   (which this phase must not regress) is *"the default suite passes with no live services."* A test that
   needs `grimoire.service` up and depends on real KB contents violates it.

## What to fix

1. **Make the remote tests hermetic** — mock `axios.get('.../api/hosts/inventory')` to return a **fixed
   fixture** host set (mirror how phase 60 fixtured the roadmap-empty tests). No live server, no real KB
   read. The `list remote mode` spawn test likewise must not depend on `grimoire.service` being up.
2. **Kill the order assumption** — assert on **presence/content** (`hosts.some(h => h.name === 'aid')`)
   or sort deterministically before asserting. Never assume `readdir` order.
3. **Prove determinism** — run `node --test 'test/*.test.js'` **three times**; it must be **380/380
   green every time**, with `grimoire.service` **stopped** (pull the live dependency to prove hermeticity).

## Out of scope / do NOT

- Don't touch the feature code (`/api/hosts/inventory`, `_fetchHosts`, `_renderHostList`) — it's correct.
- Don't `--no-verify` around the hostname pre-commit hook for real code; a **fixture** hostname belongs in
  a test constant the hook can be taught to allow — if you must bypass, say so explicitly in the report
  (as you did) and keep it to fixtures only.
- **`blip` is a REAL, live host** (the user's workstation — they SSH into aid from it). Do **not** prune
  it or treat it as stale. It coming first in the list is *correct* — which is exactly why the test must
  not assume `aid` is first. (Phase 43 only dropped a stale `.141` IP on blip, never the host.)

## Success checks

- `node --test 'test/*.test.js'` → **380/380, exit 0, three runs, with `grimoire.service` stopped.**
- `grep` proves the remote tests mock the HTTP call (no real `axios.get` to a live host in test).
- Feature still verified: `curl …/api/hosts/inventory` returns the array; local vs remote byte-identical.
- Footprint: `test/grim-host.test.js` only (feature code unchanged).
