phase: 7 · state: brief

phase: 7 · state: brief

# Brief — Phase 7: memory-spec deltas (dedup stage + noise-floor footgun check)

Full spec: `plans/phase-7.md` + `tmp/other.md` §1.4 and §3.2 — read all
three. Grimoire only. Last phase — everything else in `tmp/other.md` is
already built or deferred by standing hierophant ruling (see ROADMAP.md,
"Ruling on tmp/other.md"); build only the two items below.

1. **Dedup stage in `bin/grim-ritual.js`** (between Divination and
   Pathfinder), report-only — never merges/edits/deletes anything:
   - Find near-duplicate entity pairs by (a) normalized-name match
     (case/punctuation/whitespace-insensitive) and (b) embedding cosine
     similarity > 0.92 via the existing vectra index (`lib/vectors.js`),
     only comparing pairs of the same `@type`.
   - Write candidates to the ritual's JSON stage log; post a one-line count
     + top-3-by-score to noise-floor.
   - Degrade gracefully: missing vector index or Ollama down → log and
     continue, name-match-only results still valid.
   - Flags: `--skip-dedup`, `--dedup-threshold 0.92`, matching the file's
     existing flag style exactly.
2. **Noise-floor addressed-message warning** in `bin/grim-server.js`'s
   `POST /noise-floor/think`: if payload text matches
   `/^\s*[\w-]+\s*(→|->)\s*[\w-]+\s*:/`, still accept the thought but add
   `"warning": "looks addressed — broadcast has no recipient; use grim mm
   for directed messages"` to the response. No rejection, no other behavior
   change.

Declared footprint: `bin/grim-ritual.js`, `bin/grim-server.js`. Nothing else.

Run every success check yourself and paste actual output:
- `node bin/grim-ritual.js --skip-rest --skip-pathfind` runs the dedup
  stage, logs a candidates array (possibly empty), completes all stages.
- Seed two entities with the same normalized name, rerun — pair appears in
  the log. Clean up the seeds afterward, confirm gone.
- `curl -X POST .../noise-floor/think` with `"mage -> minion: do X"` returns
  the warning; a normal thought returns none.
- `git -C $GRIMOIRE_ROOT status` clean apart from logs/index after a ritual
  run — no entity file modified.

Report back with `grim mm write --role minion --state report`. This closes
Track C and the full three-track engagement — say so explicitly in your
report if all checks pass.
phase: 7 · state: report

# Report — Phase 7: memory-spec deltas (dedup stage + noise-floor footgun check)

Committed as `7ea67c2` — `feat: ritual dedup stage + noise-floor addressed-message warning`.

## What landed

1. **Dedup stage** in `bin/grim-ritual.js`, inserted between Divination and
   Pathfinder (new Stage 4, renumbered Pathfinder→5, final Scribe→6):
   - `findDuplicateCandidates(graph, threshold)`: name-match candidates via
     `normalizeName()` (lowercase, strip punctuation, collapse whitespace),
     grouped by exact normalized-name + same `@type`. Embedding candidates
     via direct `vectra` `LocalIndex.listItems()` read (already-computed
     vectors, no new Ollama calls), grouped by `@type`, pairwise cosine
     similarity > threshold (default 0.92). Pairs found by both methods are
     merged (`matchType: "name+embedding"`, score = max).
   - Report-only: writes `{ candidateCount, candidates, embeddingError }`
     into the stage's log entry via the existing `runStage`/log-file
     mechanism. Never touches entity files (see check below).
   - Degrades gracefully: `indexReady()` false or any read error →
     `embeddingError` set, name-match results still returned.
   - Flags added: `--skip-dedup` (boolean, matches `--skip-rest` style),
     `--dedup-threshold` (default 0.92).
   - Noise-floor: the existing end-of-ritual summary post now includes a
     `Dedup: N candidate pair(s) — top: A~B (0.95), ...` line.
2. **Noise-floor addressed-message warning** in `bin/grim-server.js`'s
   `POST /noise-floor/think`: `ADDRESSED_PATTERN = /^\s*[\w-]+\s*(→|->)\s*[\w-]+\s*:/`.
   Matching text still gets accepted (`thoughts.push` unchanged) but the
   JSON response gains `"warning": "looks addressed — broadcast has no
   recipient; use grim mm for directed messages"`. No rejection, no other
   behavior change.

## Two pre-existing bugs discovered while testing (not fixed, out of scope)

Both in `bin/grim-ritual.js`, both predate this phase:

1. **`process.argv.slice(3)`** assumes invocation through `grim.js`'s
   dispatcher (which injects a `cmd` token), but `grim-ritual.js` is *not*
   registered in `grim.js`'s `COMMANDS` table — it's meant to be invoked
   directly (`bin/grim-ritual-cron.sh` does `exec node bin/grim-ritual.js
   "$@"`). Direct invocation with flags silently drops the first one
   (`--skip-rest` in my first test run — Long Rest ran anyway, in full,
   ~144s). Latent until now because the cron wrapper is normally called
   with zero flags (`slice(3)` on an empty tail is harmless). First
   surfaced by testing this brief's own success-check command literally as
   written. Workaround used for testing: a dummy leading positional arg
   (`node bin/grim-ritual.js x --skip-rest --skip-pathfind`) to absorb the
   off-by-one.
2. **Missing `require.main === module` guard**: `main().catch(...)` runs
   unconditionally at the bottom of the file, so simply `require()`-ing
   `grim-ritual.js` (e.g. to call the exported `runRitual()` programmatically)
   triggers a full, unskippable CLI ritual run as a side effect. I hit this
   testing via `node -e "require('./bin/grim-ritual').runRitual(...)"` —
   it ran a *second*, unskipped Long Rest concurrently with my explicit
   call, which generated and saved a real dream entity
   (`meta_dream_2026_07_19`) as an unintended side effect. I deleted that
   entity afterward (`grim tome forget`, confirmed clean — see below);
   there's KB precedent for removing stray dream entities
   (`1ad33e1 chore: remove stale failed dream entity from 2026-04-17`).
   Switched all further testing to subprocess invocation only.

Flagging both, matching the existing Phase-0 (`grim tome` argv bug) pattern
— fixing either was outside this phase's declared footprint
(`bin/grim-ritual.js`'s dedup logic + `bin/grim-server.js`'s noise-floor
route only).

## Success checks — actual output

```
$ node bin/grim-ritual.js x --skip-rest --skip-pathfind
  [--] Long Rest skipped
  [19:47:17] Scribe ... done (27ms)
  [19:47:17] Divination ... done (11ms)
  [19:47:17] Dedup ... done (159ms)
  [--] Pathfinder skipped
  [19:47:17] Scribe (final) ... done (22ms)
  Ritual complete 2026-07-19.
  Graph health: 91/100 (A). Orphans: 131.
  Dedup: 516 candidate pair(s) — top: Session — 2026-06-16~Session — 2026-06-16 (1.00), ...
  All stages passed.
$ jq '.stages[] | select(.stage=="Dedup") | {ok, candidateCount: .result.candidateCount, embeddingError: .result.embeddingError}' .../logs/ritual-2026-07-19.json
{ "ok": true, "candidateCount": 516, "embeddingError": null }
```
(`x` is the dummy positional arg absorbed by the pre-existing off-by-one —
see bug #1 above; not part of my footprint.)

Seed two same-normalized-name entities, rerun, pair appears, cleaned up after:
```
$ node -e "require('./bin/grim-tome.js').remember({'@type':'DefinedTerm', '@id':'concept_phase_7_dedup_test_seed_two', name:'phase 7   dedup test seed!!', ...})"
{"ok":true,"id":"concept_phase_7_dedup_test_seed_two", ...}
(first seed 'Phase 7 Dedup Test Seed' created via grim tome remember normally)

$ node bin/grim-ritual.js x --skip-rest --skip-pathfind
  Dedup: 517 candidate pair(s) ...   # 516 -> 517

$ jq '.stages[] | select(.stage=="Dedup") | .result.candidates[] | select(.a=="concept_phase_7_dedup_test_seed_two" or .b=="concept_phase_7_dedup_test_seed_two")' .../logs/ritual-2026-07-19.json
{
  "a": "concept_phase_7_dedup_test_seed_two", "b": "concept_phase_7_dedup_test_seed",
  "aName": "phase 7   dedup test seed!!", "bName": "Phase 7 Dedup Test Seed",
  "type": "DefinedTerm", "matchType": "name", "score": 1
}

$ node bin/grim-tome.js forget concept_phase_7_dedup_test_seed --json
{"ok":true, "removed": ".../concept-phase-7-dedup-test-seed.json"}
$ node bin/grim-tome.js forget concept_phase_7_dedup_test_seed_two --json
{"ok":true, "removed": ".../concept-phase-7-dedup-test-seed-two.json"}
$ find /home/vgvm/data/grimoire-kb -iname "*dedup-test-seed*"
(no output — confirmed gone)
```

Noise-floor addressed-message warning (test instance, `GRIMOIRE_PORT=13667`):
```
$ curl -s -X POST .../noise-floor/think -d '{"text":"mage -> minion: do X",...}'
{ "ok": true, "count": 291, "warning": "looks addressed — broadcast has no recipient; use grim mm for directed messages" }
$ curl -s -X POST .../noise-floor/think -d '{"text":"mage → minion: do Y",...}'   # unicode arrow
{ "ok": true, "count": 292, "warning": "looks addressed — ..." }
$ curl -s -X POST .../noise-floor/think -d '{"text":"just a normal observation about the graph",...}'
{ "ok": true, "count": 293 }   # no warning key
```

No entity file modified by the ritual run (compared full pre/post entity-file
dirty-set in the KB data repo, not just a spot check):
```
$ cd $GRIMOIRE_ROOT && git status --short --porcelain | awk '{print $2}' | grep '^entities/' > /tmp/pre-ritual-dirty.txt
$ wc -l /tmp/pre-ritual-dirty.txt
440 /tmp/pre-ritual-dirty.txt
$ node bin/grim-ritual.js x --skip-rest --skip-pathfind   # (in grimoire code repo)
  ... Ritual complete ...
$ cd $GRIMOIRE_ROOT && git status --short --porcelain | awk '{print $2}' | grep '^entities/' > /tmp/post-ritual-dirty.txt
$ diff /tmp/pre-ritual-dirty.txt /tmp/post-ritual-dirty.txt && echo "NO CHANGE"
NO CHANGE — entity files identical before/after ritual run
```
The 440 pre-existing dirty entity files in `$GRIMOIRE_ROOT` are unrelated
background state (other work in the shared KB data repo, not this code
repo) — same set before and after, confirming the ritual run itself
touched none of them. Ritual only writes `logs/ritual-*.json`,
`indexes/graph.json` (+vector index), and `noise-floor.json` — all
expected, all outside `entities/`.

## Testing note

Same shared-infra caution as phases 5–6: ran server-dependent checks
(noise-floor warning) against a throwaway `grim-server.js` instance
(`GRIMOIRE_PORT=13667`), killed only that instance (port-verified via
`ss -tlnp`) afterward. Production `grim-server.js` (PID 2037) confirmed
untouched throughout (same PID/uptime before and after). The Dedup stage
itself needs no server — it reads the local vectra index directly — so
those checks ran against the real KB, cleaned up as described above.

## Footprint

```
$ git diff --cached --stat   (before commit)
 bin/grim-ritual.js | 136 ++++++++++++++++++++++++++++++++++++++++++++++++-----
 bin/grim-server.js |  11 ++++-
 2 files changed, 133 insertions(+), 14 deletions(-)
```
Matches the brief's declared footprint exactly. No `--no-verify` needed —
hostname-ban hook passed clean.

## Commit

- grimoire `7ea67c2` — `feat: ritual dedup stage + noise-floor addressed-message warning`

## Track status

**Track C (phase 7) complete.** This also closes the full three-track
engagement: Track A (WanTan extraction, phases 1–4), Track B (config
authority, phases 5–6), Track C (memory-spec deltas, phase 7) — all landed
and (pending this review) all accepted.

## Unrelated pre-existing state (unchanged, not mine)

`git status --short` also shows `.gitignore`, `lib/comfy-client.js`
(modified) and `plans/phase-5.md`, `plans/phase-6.md`, `plans/phase-7.md`,
`plugin/skills/civitai/` (untracked) — all pre-existing, not touched by me
this phase.
phase: 7 · state: direction

# Direction — phase 8 added: pact tooling streamline (Track D)

Brief: `plans/phase-8.md`. ROADMAP updated. Sequence: after phase 7 closes.

**Decision.** The pact's mechanics move out of skill prose into `grim mm`:
`status` and `archive --phase N` subcommands, plus a role-aware next-move footer
on `read` that prints the legal reply command in context. The three pact
SKILL.md files then slim to judgment only (≤ ~30 lines each). Separately, the
`grim load` briefing projection gets capped — it has grown to ~70K chars and
overflows the MCP result limit.
**Reason:** Rule 13 — three skills restating one state machine is mechanics the
models re-pay every invocation; the archive procedure is a hand-walked shell flow
that belongs in code. The plugin lives at `plugin/` in this repo, so it is all
one footprint.

**Constraints (binding):** no semantic changes to read/write (numbering, unread,
refusal logic); the live `.mm/` thread is untouched — archive/status/footer are
exercised against a throwaway thread in a temp dir; `plugin/skills/load/SKILL.md`
is not edited.

**Next actor: mage.** Close phase 7 first, then brief phase 8 from the plans
file. Note: item 4 edits the skills your own sessions load — verify the slimmed
mage/minion skills against the new `read` footer before accepting.
phase: 7 · state: accepted

phase: 7 · state: accepted

# Accepted — Phase 7, Track C complete, three-track engagement done

Verified independently, not just re-read:

- `git show 7ea67c2 --stat` — footprint matches brief exactly (2 files, 133
  insertions/14 deletions). Read the full diff: `findDuplicateCandidates`
  correctly reads `item.metadata.{id,name,type}` from the vectra index —
  confirmed that shape against `lib/vectors.js`'s own indexing code, not
  just assumed it. Report-only confirmed by inspection: no write path
  touches `entities/`.
- Ran my own ritual invocation (`node bin/grim-ritual.js x --skip-rest
  --skip-pathfind`) — got 516 candidates, `embeddingError: null`, matching
  your numbers exactly.
- Seeded two same-normalized-name entities myself (distinct IDs, colliding
  norm-name), reran — count went 516→517, the exact pair showed up in the
  log with `matchType: "name"`, `score: 1`. Cleaned both up, confirmed gone.
- Hit your test server independently (port 13668, separate from yours and
  from production): ASCII arrow, unicode arrow, and a plain thought all
  produced exactly the response shapes in your report (warning key present
  only on the addressed-looking two).
- Confirmed production `grim-server.js` (PID 2037) untouched throughout.
- Confirmed both your own test artifacts are actually gone: no
  `*dedup-test-seed*` files, no stray `meta_dream_2026_07_19` — your cleanup
  held.

**On the two bugs you flagged:** verified both are real and both predate
this commit — `git show 7ea67c2^:bin/grim-ritual.js` shows the exact same
`process.argv.slice(3)` and unguarded `main().catch(...)` already there
before your diff touched the file. Correctly out of scope, correctly not
fixed. Logging these to the KB known-bugs list alongside the Phase 0 `grim
tome` argv issue — three instances of the same
dispatcher-registration-assumption bug now on record, which itself is
worth a future warm-up phase.

**Track C complete. This closes the full three-track engagement** — Track A
(WanTan extraction), Track B (config authority), Track C (memory-spec
deltas), all landed and accepted across 7 phases with zero silent scope
creep and two legitimate blockers both resolved by ruling rather than
guessing.

Standing by for Track D (phase 8, pact tooling streamline) — hierophant
direction received, briefing it next.
