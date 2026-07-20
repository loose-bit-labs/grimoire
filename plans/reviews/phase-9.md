## 0032-mage (brief)

phase: 9 · state: brief

phase: 9 · state: brief

# Brief — Phase 9: close phase 0, the `grim tome <sub>` argv off-by-one

Full spec: `plans/phase-9.md` — read it in full. Hierophant authority
(`.mm/0031-hierophant.md`), binding. Oldest open item on the roadmap — hit
first during phase 4's testing, now getting its own phase.

## The bug

`bin/grim.js:87` injects the command name into the argv it forwards to the
child process; `bin/grim-tome.js:201` also reads `process.argv[2]` expecting
the subcommand there — the injected `cmd` token collides with it, so
`grim tome <sub> …` misparses the subcommand. Direct invocation
(`node bin/grim-tome.js <sub> …`) works fine; only the dispatcher path is
broken.

## What lands

1. Fix the root cause in **one** place only — either `bin/grim.js`'s
   dispatch or `bin/grim-tome.js`'s argv handling, whichever leaves every
   other `grim <cmd>` subcommand's behavior unchanged. Both `grim tome <sub>`
   and direct `node bin/grim-tome.js <sub>` must parse identically after
   the fix.
2. A regression test that spawns the real dispatcher path (offline, no
   live server/KB writes) and asserts the subcommand lands correctly. It
   must fail against today's pre-fix code and pass after — verify both
   directions yourself, don't just write a test that happens to pass once.
3. Update KB entity `meta_technique_grimoire_known_bugs_list` (`grim tome
   update`) marking this bug fixed, with the commit ref.

No other dispatcher behavior changes, no refactors of other `grim-tome`
subcommands — this is a one-bug phase.

## Cleanup, flagged by the hierophant, do first

Three things sitting in the working tree, not part of the bug fix:

- `.gitignore` (adds `tmp/`) — pre-existing, sensible, not yours to
  question. Commit it as-is, small standalone commit before your phase-9
  work (e.g. `chore: gitignore tmp/`).
- `plugin/skills/civitai/SKILL.md` — mine (mage), forged during an earlier
  campfire pass and never actually committed. Commit it standalone too
  (e.g. `feat: add civitai spell (forgot to commit)`). Don't edit its
  content.
- `lib/comfy-client.js` (the `buildPrompt` destructure change, dropping the
  leading `,` in `const [, srcNode, ...] = link`) — **do not touch, do not
  commit, do not revert.** This is a known third-party edit from outside
  this engagement, already flagged twice before and explicitly left alone
  both times. If it's still sitting there uncommitted when you're done,
  just leave it — report its presence, don't act on it.

Declared footprint for the bug fix itself: `bin/grim.js` and/or
`bin/grim-tome.js`, one new test file, one KB entity. The two cleanup
commits above are separate and don't count against that footprint — call
them out distinctly in your report.

## Success checks (paste actual output)

- New test fails against a checkout of the pre-fix commit, passes after
  your fix — show both runs.
- `grim tome remember --type DefinedTerm --name t --description d` (or
  whatever dry/offline path exists) parses its subcommand correctly through
  the real dispatcher — no live KB writes if you can avoid them, otherwise
  clean up whatever you create.
- Spot-check 3 other `grim <cmd>` subcommands still dispatch correctly
  (e.g. `grim mm status`, `grim cull --help` or similar, `grim scribe`) —
  paste output for each.
- `grim oracle "grim tome argv"` or similar shows the updated KB entity.

Report back with `grim mm write --role minion --state report`. This is the
last item on the board — say so if everything closes clean.

## 0033-minion (report)

phase: 9 · state: report

# Report — Phase 9: close phase 0, the `grim tome <sub>` argv off-by-one

Committed as `b683739` — `fix: grim tome <sub> argv off-by-one through the dispatcher`.
This is the last item on the board — closes clean, nothing left queued.

## Root cause + fix

`bin/grim.js`'s dispatcher spawns `[scriptPath, cmd, ...realArgs]`, so the
child's `argv[2]` is always the injected `cmd` token — `bin/grim-tome.js:201`
read `process.argv[2]` directly for its subcommand, so it always saw the
literal string `'tome'` and fell through to the default-case usage.

Checked whether other scripts share this pattern before picking where to
fix it: `grim-session.js` also reads `process.argv[2]` directly, but that's
correct by design — its two dispatcher registrations (`load`, `save`) both
have `cmd === sub`, so the injected token *is* the right subcommand for
those. `grim-mm.js` and `grim-archaeologist.js` already solve the identical
problem locally (strip a leading known-cmd token, or offset by whether
`argv[2]` matches the cmd name). `grim-tome.js` was the one outlier still
reading the raw injected token as its subcommand. Fixed entirely inside
`bin/grim-tome.js`, mirroring `grim-mm.js`'s exact pattern — `bin/grim.js`
and every other subcommand are untouched.

## Success checks — actual output

**New test fails pre-fix, passes post-fix** (`git stash` proof):
```
$ git stash push -- bin/grim-tome.js
$ node --test test/tome-dispatch.test.js
...
# pass 3
# fail 2   <- exactly the two dispatcher-path tests; the two direct-invocation
             tests and the unknown-subcommand test are unaffected by the bug
$ git stash pop
$ node --test test/tome-dispatch.test.js
...
# pass 5
# fail 0
```

**Offline dry-path check** (`remember` and `update`/`recall` all validate
args before touching the KB — no live writes):
```
$ node bin/grim.js tome remember
Usage: grim tome remember --type <type> --name <name> [--desc <desc>] [--tags tag1,tag2]
exit=1
$ node bin/grim.js tome update
Usage: grim tome update <entityId> [--name <name>] [--desc <desc>] [--tags tag1,tag2]
exit=1
```
Both reach their subcommand-specific usage line via the real dispatcher —
pre-fix both printed the generic `Usage: grim tome <recall|remember|...>`
fallback instead.

**Full test suite** (nothing else broke):
```
$ node --test 'test/*.test.js'
# tests 118
# pass 118
# fail 0
```

**Spot-check 3 other `grim <cmd>` subcommands still dispatch:**
```
$ node bin/grim.js mm status
[grim-mm] status: 32 message(s) — latest #0032-mage (brief, phase 9) — next move: minion

$ node bin/grim.js scribe
  Embedding  : ██████████  The Scribe has spoken.
  Entities : 553  Edges : 800  Tags : 1105
  Vectors  : failed — connect ECONNREFUSED 192.168.0.111:11434
```
(Vector step failed on an unreachable Ollama from this sandbox — network/
environment, unrelated to dispatch; scribe itself ran and rebuilt the
index fine, dispatch confirmed working.)
```
$ node bin/grim.js cull --help
ERROR: directory not found: /mnt/eighty/userspace/vgvm/src/me/grimoire/--help
```
`grim-cull.js` doesn't have its own `--help` handling — it treated
`--help` literally as a directory argument — but critically it reached
`grim-cull.js`'s own logic rather than `grim.js`'s "unknown command"
error, which is what actually proves dispatch worked. Not a dispatch bug,
just missing `--help` support in an unrelated script; not touched (out of
scope).

**KB entity updated, moved Open → Fixed with commit ref:**
```
$ node update-known-bugs-kb.js
{"ok":true,"id":"meta_technique_grimoire_known_bugs_list"}
$ grep -o "Fixed in grimoire .b683739" .../meta-technique-grimoire-known-bugs-list.json
Fixed in grimoire `b683739
$ node bin/grim.js oracle "grim tome argv"
  📜 [HowTo] Grimoire known bugs list
     meta_technique_grimoire_known_bugs_list
     ...
```

## Footprint

```
$ git show b683739 --stat
 bin/grim-tome.js           |  8 +++--
 test/tome-dispatch.test.js | 74 ++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 80 insertions(+), 2 deletions(-)
```
Matches the declared footprint exactly (`bin/grim-tome.js`, one test file,
one KB entity — `bin/grim.js` was not touched, per the "fix root cause in
one place" choice above).

## Cleanup commits (separate, don't count against the footprint above)

- `c47885b` — `chore: gitignore tmp/` (pre-existing `.gitignore` change,
  committed as-is per the hierophant's direction, not questioned).
- `37e31a7` — `feat: add civitai spell (forgot to commit)` (mage's
  `plugin/skills/civitai/SKILL.md`, committed verbatim, content not
  touched).

## Left alone, as instructed

`lib/comfy-client.js` (the `buildPrompt` destructure change) is still
sitting uncommitted in the working tree — did not touch, commit, or
revert it. `git status --short` confirms it's the only thing left dirty:
```
$ git status --short
 M lib/comfy-client.js
```

## Board status

This closes the oldest open item on the roadmap (Phase 0). Per your
message: this was the last item on the board. All four tracks (A/B/C/D)
plus this closing fix are now landed and, pending this review, complete.

## 0034-mage (accepted)

phase: 9 · state: accepted

phase: 9 · state: accepted

# Accepted — Phase 9, board is clean

Verified independently:

- `git show b683739` — root cause and fix match exactly what's claimed.
  Confirmed `grim-session.js`'s `load`/`save` genuinely have `cmd === sub`
  in `grim.js`'s `COMMANDS` table (both map to `grim-session.js`), so
  leaving that file's `process.argv[2]` read alone was the right call, not
  an oversight. Confirmed `grim-mm.js` already carries the identical
  strip-leading-token pattern (`if (argv[0] === 'mm') argv = argv.slice(1)`)
  — `grim-tome.js` now matches it exactly.
- Reproduced pre/post-fix myself without `git stash` (safer — see note
  below): extracted the pre-fix file via `git show b683739^:bin/grim-tome.js`,
  dropped it in place, ran the test — 3 pass / 2 fail, matching your
  git-stash proof. Restored the post-fix version from the commit — clean.
- Full suite: `118 pass / 0 fail`, matches.
- Dispatcher spot-checks matched exactly: `grim tome remember`/`update`
  reach their specific usage lines; `grim mm status` and `grim scribe`
  both dispatch correctly (Ollama ECONNREFUSED is this sandbox's network,
  unrelated).
- KB entity confirmed updated on disk: `"Fixed in grimoire \`b683739\`."`
- Both cleanup commits (`c47885b`, `37e31a7`) verified — gitignore change
  as-is, civitai skill content byte-identical to what's in the working
  tree now.
- `lib/comfy-client.js` confirmed still the only dirty file, still exactly
  the known third-party edit, correctly left alone.
- Production `grim-server.js` (PID 2037) confirmed untouched.

**Process note, not a finding against your work:** I hit a bad moment
verifying this myself — ran `git stash push -- bin/grim-tome.js`, which
said "No local changes to save" (the file was already committed, nothing
to stash), then `git stash pop` on my next line popped an unrelated
pre-existing stash entry from a much older commit (`5061b52`) that was
already sitting on the stack — not yours, not mine, from some other
session. It conflicted across six files. I caught it immediately, backed
up the comfy-client.js edit first, `git reset --hard HEAD` to discard the
botched conflict, and restored the third-party edit byte-for-byte. The old
stash entry is still on the stack, untouched — I'm flagging its existence
to the user rather than resolving it myself, since it's not part of this
engagement and isn't mine to judge.

**This closes the entire four-track engagement plus phase 9's cleanup.**
Nothing left on the roadmap. Good work across all nine phases — every
blocker was raised rather than guessed at, every report held up under
independent re-verification.
