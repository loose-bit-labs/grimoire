# Phase 66 — make the suite genuinely, deterministically green (finish phase 60's bar)

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track P (repo hygiene).**
Two phase-60 residues surfaced by phases 64/65: phase 60 claimed *"the default suite passes with no live
services"* and *"the hang is killed,"* but neither is fully true. **Part A** — a test isn't hermetic
(needs the live server). **Part B** — a server test binds hardcoded ports and **intermittently hangs**
on `EADDRINUSE` (~1 run in 3). Both must be fixed for the suite to be trustworthy.

## Part B — kill the intermittent `EADDRINUSE` hang (`test/grim-rig-serve.test.js`)

Verified: a full-suite run hung with `grim rig serve: server error: listen EADDRINUSE: address already
in use 127.0.0.1:18082`; two other runs passed 380/380. The server tests bind **hardcoded ports**
(19876, 19877, and a default 18082 when none is passed) — under `node --test`'s concurrency, or with a
leftover bind, those collide → the test waits on a server that never came up → **hang** (not a clean
fail). Phase 60 closed the listeners but left the fixed ports, so "no hang" is flaky.

**Fix:** every server the tests start must bind an **ephemeral port (`port: 0`)** and read the actual
assigned port back from the listening server (`server.address().port`) for its requests — never a
hardcoded or defaulted port. Ensure each server is closed in `after`/`t.after` (keep phase 60's
teardown). No fixed test ports anywhere a bind happens.

**Success (Part B):** run `node --test 'test/*.test.js'` **10×** — 380/380 every time, **zero**
`EADDRINUSE`, **zero** hangs (each run self-terminates well under the timeout). `grep` shows no
hardcoded bind port in `test/grim-rig-serve.test.js` (ephemeral `0` + `address().port`).

## Part A — finish phase 60's "no live services" bar (`platform-gather.test.js`)

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
- **(Part B)** `node --test 'test/*.test.js'` 10× → all 380/380, no `EADDRINUSE`, no hang; no hardcoded
  bind ports remain in `test/grim-rig-serve.test.js`.
- Footprint: `test/platform-gather.test.js`, `test/grim-rig-serve.test.js` (ephemeral ports),
  (+ optional `deploy/grim-register-host.sh` `--dry-run`).
