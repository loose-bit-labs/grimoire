# Phase 61 — REVISE (pipe is right; the state machine's clock is wrong)

Strong work on the plumbing: A–E are all wired, reuse is clean (`readThread`/`parseHeader` +
exported `NEXT_OWNER`/`STATES`/`TERMINAL`), no CDN, no `.mm` writes, 10/10 unit + 396/396 suite,
footprint respected. `grim hmm` ↔ `curl /api/hmm` parity holds. **But I verified the live output and
the heart of the phase — the status state machine — is wrong.** Two bugs, both reproduced:

## Bug 1 (blocker) — timezone skew makes `working`/`conversing` unreachable

`lib/hmm.js` `_tsEpoch` parses the `.mm` `ts:` field as **UTC**:
```js
const d = new Date(msg.ts.replace('_', 'T') + 'Z')   // ← the 'Z' is the bug
```
`.mm` timestamps are written in **local** time (EDT). Appending `Z` reads them as UTC, inflating
**every** age by the local offset. Proven on this box:
```
ts 2026-08-08_22:50:43  →  age as UTC = 346 min   age as local = 106 min   skew = 240 min (= TZ offset)
```
With `ACTIVE_SEC=300` (5 min) and `IDLE_SEC=1200` (20 min), a +4h skew pushes **everything** past
idle — so `working` and `conversing` can essentially never fire in live use. The machine collapses to
waiting/sleeping/retired only. That defeats the phase's stated bar ("statuses match live reality —
grimoire shows the mage/minion as working/waiting").

**Fix:** parse the ts as **local** time — drop the `'Z'` (`new Date(msg.ts.replace('_', 'T'))`
parses as local). Confirm `working`/`conversing` actually appear when a message is seconds/minutes old.

## Bug 2 — mtime fallback returns epoch 0 (retired projects show `29770835m` ≈ 56 yr)

Older threads (fLimfLaMs, grim-npc, …) have `.mm` messages with **no `ts:` field**, so `_tsEpoch`
falls to the mtime branch — but `msg.file` from `readThread` is a **bare basename**, so
`fs.statSync(msg.file)` looks in cwd, throws, returns `0` → age = now − 0 ≈ 56 years.

**Fix:** give `_tsEpoch` a resolvable path. Minimal, no `grim-mm` contract change: in `scanProjects`,
attach the absolute path to each message (`m._path = path.join(mmDir, m.file)`) and have `_tsEpoch`
stat `msg._path`. (If you'd rather fix it at the source, make `readThread` return an absolute `file` —
but check its other callers first; the local attach is the smaller change.)

## Bug 3 (why the tests didn't catch 1 & 2) — fixtures can't fail on the real clock

`test/hmm.test.js` passes 10/10 while the live machine is wrong because the fixtures compute `now`
and the fixture `ts` in the same frame, so the UTC skew cancels, and fixtures always carry a `ts` so
the mtime path never runs. That's a Rule 9 miss — the tests verify shape, not the live behavior.

**Add regression cover that would have failed:**
- A message stamped with a **real local-format** `ts:` (`YYYY-MM-DD_HH:MM:SS`, built from a real
  `Date` a few seconds/minutes before a real `now`) → assert status is `working`/`conversing`
  (fresh), **not** sleeping. This is the test that catches the `Z` skew.
- A **ts-less** message (mtime fallback path) → assert the age is sane (small, from a temp file's real
  mtime), **not** ~epoch-0. This catches the basename bug.
- Keep all fixtures in a temp dir — still no reads of real `~/src/me`.

## Bar to re-accept

- With the service up, `grim hmm` shows a genuinely **fresh** pact turn as `working`/`conversing`
  (make one: it's fine to use the live grimoire thread right after a write, or a temp fixture project).
  Capture the output showing a non-idle status actually appears.
- Retired/ts-less projects show a **sane** age, not `29770835m`.
- New regression tests present and green; full suite still green + self-terminating; parity intact.
- Footprint: `lib/hmm.js`, `test/hmm.test.js` (+ nothing else unless a fix genuinely needs it →
  say so). Everything else from phase 61 stays as shipped.
