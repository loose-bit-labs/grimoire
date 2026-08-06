# Phase 60 — test-suite hygiene: make `node --test test/` run green to completion

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track P (repo hygiene).**
Found live: `node --test test/` **hangs forever** (one leaky server test) and 5 files fail. A repo
whose own test command never exits is cruft-laden by definition. This makes the suite trustworthy
again. Deterministic mechanics — fix the tests/teardown, don't paper over with blanket flags.

## What happened (the live scan)

`node --test test/` never terminates. Per-file scan (12s timeout each) found:

| File | Symptom | Root cause (confirm, don't assume) |
|------|---------|-----------------------------------|
| `test/grim-rig-serve.test.js` | **HANGS** — suite never exits | server/listener started, never closed → open handle keeps the runner alive |
| `test/grim-mm-next.test.js` · `test/grim-mm-drive.test.js` | "HALT roadmap-empty" fails (exit ≠ 4) | test **mutates the live `plans/ROADMAP.md`** with a regex that no longer matches the drifted table (external `[fLimfLaMs]` rows, blocked 32, dup 53/54) → real roadmap never fully "empties" |
| `test/generate-dashboard.test.js` | `ENOENT …/provisioning/dashboard-hotspots.json` | writer doesn't `mkdir -p` its output dir (or the test doesn't create it) |
| `test/grim-mm.test.js` | "write --state brief requires --phase" fails | stale assertion — predates the YAML-frontmatter header change |
| `test/rig.test.js` | `fetchFleetRemote` "Invalid URL" | environment-coupled — needs a **live hub**; has no business in the default suite |

## What lands

1. **Kill the hang (`grim-rig-serve.test.js`).** Every server/listener the test opens must be closed
   in an `after`/`afterEach` (or `t.after(...)`) so the runner exits on its own. **Do not** reach for
   a blanket `--test-force-exit` as the fix — that masks *other* leaks. Find the open handle and close
   it. Acceptance is the suite exiting on its own, fast.
2. **De-couple the roadmap-empty tests from the live ROADMAP** (`grim-mm-next`, `grim-mm-drive`). They
   must build a **fixture ROADMAP in a temp dir** and point `next`/`drive` at it (the verb already
   accepts a resolvable roadmap path via cwd/`--dir` — use that), and assert HALT against the fixture.
   **No test may read, patch, or write `plans/ROADMAP.md`.** This is both the bug *and* a landmine
   (a crashed test could leave the real roadmap corrupted). Verify `next`/`drive` themselves are
   correct against the fixture — if the HALT logic is genuinely broken (not just the fixture), that's
   a real finding: fix it and say so.
3. **Dashboard writer creates its dir** (`generate-dashboard`). If the real invocation path expects
   `provisioning/` to exist, the **writer** should `mkdir -p` it (fix at the root, not by pre-creating
   in the test). Confirm which side is wrong by reading the generator; fix the actual defect.
4. **Prune the stale mm test** (`grim-mm.test.js` "write --state brief requires --phase") — update it
   to the current YAML-frontmatter output, or delete it if another test already covers the behavior.
   A test that asserts a format the code no longer emits is worse than no test.
5. **Un-couple the live-hub rig test** (`rig.test.js` `fetchFleetRemote`) — mock the fetch (feed it a
   canned hub response) so it tests the parse/shape deterministically, **or** tag it as
   integration/network-only and exclude it from the default `node --test test/` run. The default suite
   must pass with **no live services**.
6. **Ledger reconcile (docs, rides along).** In `plans/ROADMAP.md`: (a) de-duplicate the **53/54** rows
   so `grim roadmap` stops flagging drift — merge/renumber the *ROADMAP rows only*, do **not** rename
   phase briefs on disk; (b) close **phase 32** (grim-tavern) — it's superseded by Track G-v2 /
   `researcher.service`, not blocked. Mark it `✅ CLOSED 2026-08-06 — superseded by …` so it leaves the
   blocked list. Bump "Last updated".

## Out of scope / do NOT

- No blanket `--test-force-exit`, no `--test-timeout` band-aids, no `.skip()` to make red go green — fix
  the cause. A skipped test is a finding, not a pass.
- Don't rewrite unrelated tests, don't touch non-test source except the two genuine code fixes (#3
  dashboard `mkdir`, and #2 *only if* `next`/`drive` prove actually broken). Match existing test style
  (`node:test`, not mocha).
- Don't renumber phase briefs on disk (breaks `.mm` cross-refs) — only reconcile ROADMAP *rows*.
- Any defect you find outside this footprint → **escalate, don't silently commit** (acceptance bar).

## Success checks

- **`node --test test/` exits 0 on its own** (no hang, no external timeout) in a bounded time — capture
  the real run showing it terminating with `# fail 0`. *"A test exists" / "runs individually" is not
  acceptance — the whole-suite invocation path must be observed green and self-terminating.*
- `grep` proves **no test writes `plans/ROADMAP.md`** (the roadmap-empty tests use a fixture).
- The default suite passes with **no live hub / no server** reachable (pull the network if unsure).
- `grim roadmap` shows **no `⚠ duplicate phase numbers`** and phase 32 no longer in Blocked.
- Warnings in your own run (e.g. Node open-handle or circular-dep notices) are findings to resolve,
  not noise to dismiss.
- Footprint: `test/grim-rig-serve.test.js`, `test/grim-mm-next.test.js`, `test/grim-mm-drive.test.js`,
  `test/generate-dashboard.test.js` (+ maybe `bin/generate-dashboard*.js` for the `mkdir`),
  `test/grim-mm.test.js`, `test/rig.test.js`, `plans/ROADMAP.md`.
