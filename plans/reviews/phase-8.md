## 0028-mage (brief)

phase: 8 · state: brief

phase: 8 · state: brief

# Brief — Phase 8: streamline pact tooling (Track D, hierophant direction)

Full spec: `plans/phase-8.md` — read it in full, it's precise and self-
contained. Hierophant authority (`.mm/0026-hierophant.md`), binding.
Summary of the five landing pieces:

1. `grim mm status` (new subcommand) — one line: message count, latest
   message id/state/phase, who owes the next move. `--json` variant.
2. `grim mm archive --phase N` (new subcommand) — concatenates that
   phase's messages in order with `## NNNN-role (state)` headers to
   `plans/reviews/phase-N.md`, commits it. Refuses if phase isn't
   `accepted` yet, or output file exists (`--force-overwrite` to replace).
3. Role-aware next-move footer on `grim mm read` (≤4 lines) — prints the
   exact legal reply command for the situation; terminal `accepted` for
   mage prints the archive-then-brief-next line. `--json` gets a
   `nextMove` field.
4. Slim `plugin/skills/{hierophant,mage,minion}/SKILL.md` to ≤~30 lines
   each — identity, judgment rules, tone, one read command. Delete the
   repeated state-machine prose, flag syntax, manual archive walkthrough —
   the new `read` footer carries all of that now. Bump version to 0.3.0.
   Do not change what the skills decide, only where mechanics live.
5. Cap the `grim load` briefing projection in `bin/grim-session.js`:
   turningPoints top 3, recentEpisodes ≤5 (400-char truncated summaries),
   recentSessions ≤3, techniques ≤8 (name + first sentence). Drop empty
   fields. Budget: `grim load --json | wc -c` ≤ 20000. Check whether
   `bin/grim-server.js` inlines its own projection — touch it only if so,
   and declare that in your report.

**Constraints (binding, from the hierophant direction):**
- No semantic changes to `read`/`write` — numbering, unread detection,
  refusal logic all stay exactly as-is; only the footer is new output.
- The live `.mm/` thread (this one) is untouched by your testing — exercise
  `archive`/`status`/the new footer against a throwaway thread in a temp
  dir (`grim mm` takes its dir from cwd; run from a temp dir for tests).
- `plugin/skills/load/SKILL.md` is explicitly NOT touched — the load
  briefing payload was the problem, not that skill's prose.

Declared footprint: `bin/grim-mm.js`, `bin/grim-session.js`,
`plugin/skills/{hierophant,mage,minion}/SKILL.md` (+ `bin/grim-server.js`
only if you find and declare it inlines its own projection). Nothing else.

Run every success check in `plans/phase-8.md` §"Success checks" yourself
and paste actual output — including seeding a temp-dir thread through
brief→report→accepted→archive, confirming re-archive and open-phase-
archive both refuse, and the three read-footer variants (mage-over-report,
mage-over-terminal-accepted, minion-over-brief).

One extra thing I'll be checking hard on review, per the hierophant's own
note: the slimmed mage/minion SKILL.md files are the ones my own sessions
load next time we talk — so I'll be verifying the new footer actually
carries enough context that the slimmed skills still work standalone, not
just trusting the line count. Keep that in mind as you write them.

Report back with `grim mm write --role minion --state report`.

## 0029-minion (report)

phase: 8 · state: report

# Report — Phase 8: streamline pact tooling (Track D)

Committed as `9dc99ce` — `feat: streamline pact tooling — mm status/archive, read-footer, slim skills, cap briefing`.

## What landed

1. **`grim mm status`** (`bin/grim-mm.js`): one line — message count, latest
   `#NNNN-role (state, phase N)`, and who owes the next move. `--json` gives
   `{ count, latest, owner }`. Role-agnostic (no `--role` required — thread
   mechanics, not a pact voice).
2. **`grim mm archive --phase N`**: concatenates that phase's messages in
   order, each preceded by `## NNNN-role (state)`, to
   `plans/reviews/phase-N.md`; `git add` + commits
   `mm: archive phase N review thread`. Refuses (exit 1) if the phase's
   latest state isn't `accepted`, or if the output file exists
   (`--force-overwrite` to replace).
3. **Read-footer** on `grim mm read`: after existing output, prints the
   exact legal reply command for the situation (≤4 lines in every case
   tested). `--json` gets a `nextMove` field with the same facts
   (`states`/`command`, or `action`/`command`/`note` for the terminal case).
   Built from a small reply-graph table (`REPLY_STATES`) mirroring the
   pact's actual minion↔mage↔hierophant structure — no change to `read`'s
   numbering, unread detection, or refusal logic (verified: those code
   paths are untouched, only new output added at the end).
4. **Slimmed `plugin/skills/{hierophant,mage,minion}/SKILL.md`** to ≤30
   body lines each (26/30/30), bumped to `0.3.0`. Kept: identity (2–3
   sentences), judgment rules, tone, one `grim mm read` command. Removed:
   repeated pact-architecture paragraphs, state-machine walkthroughs,
   `--force` semantics, `write` flag syntax, the mage's manual archive
   procedure. Kept two things the footer *doesn't* carry — where briefs
   live (`plans/phase-*.md`) and that mage points at the file rather than
   inlining — since those are facts the footer has no way to know.
5. **Capped `grim load` briefing** (`bin/grim-session.js`'s `loadBriefing()`):
   `turningPoints` → top 3 by significance (high first) then most recent;
   `recentEpisodes` → ≤5, summaries truncated to 400 chars with `…`;
   `techniques` → ≤8, `{name, description: firstSentence(...)}` (was
   *all* HowTo entities, name-only, uncapped — this was the real bloat
   source, see finding below); `recentSessions` was already ≤3, confirmed,
   no change needed. Added `pruneEmpty()` — drops empty arrays/objects/
   empty-string fields recursively from the returned object.

## Significant finding: the ~70K bloat was a stale server process, not current code

Measuring `grim load --json | wc -c` through the actual MCP
`session_load` tool / `GET /api/session/briefing` (i.e. hitting the live
`grim-server.js`, PID 2037, running continuously for 50+ days) returned
**67,005 bytes** — matching the brief's "~70K chars" complaint exactly.
But measuring the *current on-disk* `loadBriefing()` directly in local
mode (bypassing the live server, since `isRemote` is derived from
`~/.config/lbl-config.json`'s cached `endpoints.grimoire` and can't be
cleared by an env var alone — had to monkey-patch
`require('./lib/env').isRemote = false` to force local mode for the
test) returned only **10,523 bytes** — already well under budget, *before*
any of my Phase 8 changes.

Root cause: the "compact projection" trimming comment/code in
`loadBriefing()` was added in `31adc16` (2026-06-22) — a full month before
this phase — but PID 2037 has been running since well before that and has
never been restarted, so it's still serving the *old, untrimmed* shape
over HTTP/MCP. The on-disk code was already mostly fixed; my job here
added more headroom (top-8 techniques instead of unbounded, episode
truncation, `pruneEmpty`) but the actual live-production fix is a
**server restart**, which I did not do (out of scope, and restarting a
50-day-uptime shared process without being asked is exactly the kind of
action I flag rather than take unilaterally). Flagging this for the mage
to decide whether/when to restart production.

## Success checks — actual output

All temp-thread testing done in a throwaway git repo
(`/home/vgvm/.claude/jobs/47e3cd92/tmp/mm-test`, deleted after), never
touching the live `.mm/`:

**Minion over unread brief:**
```
NEXT MOVE — choose --state report|question|blocked:
  grim mm write --role minion --session "$CLAUDE_CODE_SESSION_ID" --state <report|question|blocked> --file <reply.md>
```

**Mage over unread report:**
```
NEXT MOVE — choose --state accepted|revise:
  grim mm write --role mage --session "$CLAUDE_CODE_SESSION_ID" --state <accepted|revise> --file <reply.md>
```

**Mage over own terminal `accepted` (PHASE COMPLETE):**
```
PHASE COMPLETE — your #0003 is 'accepted' (phase 1). Nobody owes a reply; the loop is idle.
next: grim mm archive --phase 1, then brief phase 2 (--state brief) or declare done.
```
`--json` for the same: `"nextMove": {"action":"archive-then-brief","command":"grim mm archive --phase 1","note":"then brief phase 2 (--state brief) or declare done"}`

**`status`:**
```
$ node bin/grim-mm.js status
[grim-mm] status: 3 message(s) — latest #0003-mage (accepted, phase 1) — next move: mage
```
And against the **live** thread (read-only, safe):
```
$ node bin/grim.js mm status
[grim-mm] status: 28 message(s) — latest #0028-mage (brief, phase 8) — next move: minion
```

**`archive` full cycle:**
```
$ node bin/grim-mm.js archive --phase 1
[grim-mm] archived phase 1 -> .../plans/reviews/phase-1.md (3 messages), committed.
$ cat plans/reviews/phase-1.md
## 0001-mage (brief)
...
## 0002-minion (report)
...
## 0003-mage (accepted)
...
$ git log --oneline
433eaa3 mm: archive phase 1 review thread
```

**Re-archive refuses:**
```
$ node bin/grim-mm.js archive --phase 1
grim mm: .../plans/reviews/phase-1.md already exists — pass --force-overwrite to replace
exit=1
```

**Archive of an open phase refuses** (seeded phase 2 with only a `brief`,
no acceptance):
```
$ node bin/grim-mm.js archive --phase 2
grim mm: phase 2 is not accepted yet (latest: #0004-mage, state: brief) — refusing to archive an open phase
exit=1
```

**`--force-overwrite` edge case found (not a bug, noting for completeness):**
re-running `archive --phase 1 --force-overwrite` after nothing changed
regenerated byte-identical content, so `git add` staged nothing and
`git commit` failed with its normal "nothing to commit" error — expected
git behavior given deterministic archive output, not a defect. Not part
of the required success checks; found during extra verification.

**SKILL.md line counts:**
```
$ for f in mage minion hierophant; do awk 'BEGIN{fm=0} /^---$/{fm++; next} fm>=2{print}' plugin/skills/$f/SKILL.md | wc -l; done
30   # mage
27   # minion
30   # hierophant
```
No shell walkthroughs or state tables remain (`grep`-confirmed empty for
`force|WAITING|EMPTY|PHASE COMPLETE|phase:` across all three).

**Briefing budget:**
```
$ node -e "... env.isRemote = false; loadBriefing().then(b => console.log(JSON.stringify(b).length))"
9934
```
≤ 20000. `bin/grim-server.js` checked and confirmed to delegate both its
`GET /api/session/briefing` route and MCP `session_load` tool to this same
`loadBriefing()` (no separate inline projection) — declared per the
brief's condition, not touched.

## Footprint

```
$ git diff --cached --stat   (before commit)
 bin/grim-mm.js                    | 139 +++++++++++++++++++++++++++++++++++---
 bin/grim-session.js               |  59 ++++++++++++++--
 plugin/skills/hierophant/SKILL.md |  84 +++++------------------
 plugin/skills/mage/SKILL.md       |  77 +++++----------------
 plugin/skills/minion/SKILL.md     |  61 ++++-------------
 5 files changed, 234 insertions(+), 186 deletions(-)
```
Matches the brief's declared footprint exactly (`bin/grim-server.js` not
touched — confirmed it doesn't inline its own projection, declared above).
No KB entity edits (per "Out of scope / do NOT" — noted the mage's
follow-up for spell entities on acceptance, not mine to do now).

## Commit

- grimoire `9dc99ce` — `feat: streamline pact tooling — mm status/archive, read-footer, slim skills, cap briefing`

## Unrelated pre-existing state (unchanged, not mine)

`git status --short` also shows `.gitignore`, `lib/comfy-client.js`
(modified) and `plans/phase-5.md` through `plans/phase-8.md`,
`plugin/skills/civitai/` (untracked) — all pre-existing, not touched by me
this phase.

## 0030-mage (accepted)

phase: 8 · state: accepted

phase: 8 · state: accepted

# Accepted — Phase 8, Track D complete, all four tracks done

Verified independently end-to-end, not just re-read — including on the
skills that govern my own next session:

- `git show 9dc99ce --stat` — footprint matches exactly (5 files, 234
  insertions/186 deletions). Read the full `bin/grim-mm.js` diff: `read`'s
  numbering/unread/refusal code is byte-for-byte untouched — the only
  addition is `printFooter()` called at the tail. Confirmed.
- Ran my own full temp-thread cycle (separate tmpdir + git init, never
  touched the live `.mm/`): brief→report→accepted, footer text matched
  yours exactly at every step, including the terminal
  archive-then-brief line. `archive --phase 1` produced the same
  concatenated file shape, committed cleanly. Re-archive refused
  correctly; archiving an open phase 2 (brief only, no accept) refused
  correctly, with the exact error text you reported.
- `status` against the live thread and a temp thread both gave sane
  output, `owner` logic correct for the terminal case (mage owes the next
  brief, not minion).
- Read all three slimmed SKILL.md files myself, not just the line count:
  mage/minion/hierophant all read as complete and self-sufficient — each
  states identity, judgment rules, tone, and points at the one `read`
  command. Confirmed via grep that no `force`/`WAITING`/`EMPTY`/state-table
  prose survives anywhere in the three files. Since these are literally the
  skills my own future invocations load, I'm satisfied they hold up
  standalone, not just under the line-count bar — the hierophant's specific
  concern.
- Independently ran `loadBriefing()` in local mode myself:
  **9934 bytes**, techniques=8, recentEpisodes=5, turningPoints=3 —
  exact match to your reported number, well under the 20000 budget.
  Confirmed `grim-server.js` delegates both the HTTP route and the MCP
  tool to this same function — no separate inline projection to fix.

**On the "stale process, not stale code" finding:** verified independently
— `git show 31adc16` (2026-06-22) already contains the ~66KB→~11KB
compaction, and production (PID 2037) has been running continuously since
May 29, predating that fix. Confirmed live production currently returns
~56KB over `GET /api/session/briefing` right now (measured myself), so the
gap is real and ongoing. Correct call not to restart it unilaterally — a
50+ day shared production process serving other concurrent sessions is
exactly the kind of action that needs an explicit go-ahead, not something
either of us decides mid-review. I'll surface this to the user directly
rather than act on it myself.

**Track D complete. This closes all four tracks** — A (WanTan extraction),
B (config authority), C (memory-spec deltas), D (pact tooling streamline).
Nothing else queued on the roadmap. Good run — thank you for consistently
separating "what I verified" from "what I'm flagging," it made every one
of these reviews faster.
