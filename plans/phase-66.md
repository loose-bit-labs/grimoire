# Phase 66 — finish phase 60's bar: make `platform-gather` hermetic (green with the service down)

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track P (repo hygiene).**
Surfaced by phase 64's hermeticity run: phase 60 claimed *"the default suite passes with no live
services,"* but it was never actually run with `grimoire.service` stopped — and one test isn't hermetic.

## Root cause (verified)

`test/platform-gather.test.js` → `it('aid (x86) registers cleanly — regression check')` (line ~98) runs:
```js
const out = execSync('bash deploy/grim-register-host.sh 2>&1', { timeout: 30000 })
assert.ok(out.includes('Registered'), 'register should succeed')
```
`deploy/grim-register-host.sh` **POSTs the host entity to the live grimoire server**, so with
`grimoire.service` stopped the register fails → no `Registered` → the assertion fails. Suite is 379/379
with the service up, 378/379 with it down. The network dependency is one `exec` layer below the test, so
it's easy to miss (grepping the test file for `http`/`axios` finds nothing).

## What lands

Make this test hermetic so the whole suite is green **with the service down** (phase 60's real bar):
- Split the intent. The test wants two things: (a) the x86 gather produces the right **inventory**
  (CPU/RAM/no-warning/no-battery) and (b) the register **flow** completes. Only (b) needs a server.
- **For (a)** — assert against the **gather output** without the server write: run the gather portion
  (source `deploy/platform.d/linux.sh` and check the exported vars / the pre-POST payload the script
  builds), OR run `grim-register-host.sh` in a **dry-run / no-post mode** if one exists (add a tiny
  `--dry-run` that gathers + prints the payload but skips the HTTP POST — smallest honest change), and
  assert the x86 inventory on that.
- **For (b)** — if a real register round-trip is still wanted, **tag it integration** (skip in the
  default `node --test` run) or **stub the POST**. The default suite must not need a live server.

## Out of scope / do NOT

- Don't weaken the x86 regression coverage — CPU model, RAM-in-GB, no-⚠, `battery:null`, `is_laptop:false`
  must still be asserted (just against gather output, not a live register). Phase 59's guarantees stand.
- Don't touch `deploy/grim-register-host.sh`'s real behavior beyond (optionally) adding a `--dry-run` that
  only *skips the POST* — no change to the normal register path.
- `platform-gather.test.js` (+ maybe a `--dry-run` flag) only. Out-of-footprint finds → escalate.

## Success checks

- **`sudo systemctl stop grimoire` (user-gated) → `node --test 'test/*.test.js'` → 380/380 (or current
  count), exit 0** — then restart the service. The point is the suite proves itself with the server down.
  *(Coordinate the stop/start with the user — don't leave the KB offline.)*
- x86 inventory still asserted (CPU/RAM/no-warning/no-battery/not-laptop) against gather output.
- `grep` shows no test path reaches the network with the service down.
- Footprint: `test/platform-gather.test.js` (+ optional `deploy/grim-register-host.sh` `--dry-run`).
