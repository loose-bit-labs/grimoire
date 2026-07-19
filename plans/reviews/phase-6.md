phase: 6 · state: brief

phase: 6 · state: brief

# Brief — Phase 6: config client layer + first migrated consumer

Full spec: `plans/phase-6.md` + `tmp/moar.md` — read both. Depends on phase
5 (accepted, `428abb9` — route + CLI now exist).

Summary:

1. `lib/env.js`: add `refreshLblCache()` (async) — fetch `GET /config/lbl`
   from `config.host`; on success write to `~/.config/lbl-config.json` and
   return the fresh object; on any failure return the cached object (or
   null). Never throws, never deletes the cache. `lib/env.js` itself stays
   sync-at-require-time — no HTTP calls at require time, only inside this
   new function.
2. Refactor `bin/grim-config.js`'s `sync` subcommand to call
   `refreshLblCache()` instead of duplicating the fetch — one fetch
   implementation only.
3. **Proof migration — `bin/model-ask.js`:** at the start of its async entry
   path, call `refreshLblCache()` and use the returned config for `use.*`
   lookups instead of its private `_lbl()`-style file read. Don't touch its
   model-routing logic. Behavior with the server down must be identical to
   today (falls back to cache, no hang).
4. Extend the phase-5 pre-commit hook block: when `config/lbl-config.json`
   is in the commit, POST a one-line summary of changed top-level keys to
   `POST /noise-floor/think` — best-effort (`curl --max-time 2 || true`), a
   down server must never block the commit.
5. KB: find the existing lbl-config pattern entity (`grim oracle
   lbl-config`) and `grim tome update` it to describe the new flow —
   canonical file in repo, route, precedence chain (env → fetch → cache →
   fallback), cache's now-secondary role.

Declared footprint: `lib/env.js`, `bin/model-ask.js`, `bin/grim-config.js`,
the pre-commit hook, one KB entity. Nothing else.

Run every success check yourself and paste actual output:
- Server up: `node bin/model-ask.js` text task works, cache file mtime
  updates.
- Server unreachable (`GRIMOIRE_HOST=http://localhost:9`): model-ask behaves
  exactly as today off cache — no error, no hang, fetch timeout ≤2s.
- A commit touching `config/lbl-config.json` posts a noise-floor thought
  (check `GET /noise-floor/context`) and succeeds even with the server down.
- `grim oracle lbl-config` shows the updated entity.

Report back with `grim mm write --role minion --state report`.
phase: 6 · state: question

# Question — Phase 6 blocked by pre-existing hook violation (not in scope)

All 4 Phase 6 changes are implemented and staged (`lib/env.js`, `bin/model-ask.js`,
`bin/grim-config.js`, `.githooks/pre-commit`), but `git commit` is blocked by the
hostname-ban pre-commit check:

```
  BLOCKED  lib/env.js — hardcoded hostname URL(s):
    72:   ollama: process.env.OLLAMA_HOST   || _lblEndpoint('ollama')   || 'http://aid:11434',
```

That line is untouched by me — it's the pre-existing hardcoded Ollama fallback,
last committed in `e3a1122` (`fix: scrub grimoire.local, wire lbl-config.json as
host resolution source`). The hostname-ban hook itself landed later, in `e96c62f`
(`feat: pre-commit hook blocks hardcoded bare-hostname URLs`), which was never
retroactively run against `lib/env.js` since that file hadn't been committed since.
My Phase 6 edit is the first touch to this file since the hook existed, so it's
the first commit to surface the violation — not something Phase 6 introduced.

Not in my declared footprint to fix (the brief says touch `lib/env.js`, `bin/model-
ask.js`, `bin/grim-config.js`, the pre-commit hook, one KB entity — nothing about
scrubbing the pre-existing `http://aid:11434` fallback). Options as I see them,
not picking one myself:

1. Fix the fallback line too (e.g. drop it, or read from `config/lbl-config.json`
   in-repo the way `bin/grim-config.js` does) — small, but expands the footprint.
2. `git commit --no-verify` for this one commit — bypasses the hook I'm not
   authorized to skip without being told to.
3. Brief a follow-up phase/task specifically to scrub this line.

Everything else is done and verified (success-check output below). Waiting on
direction before committing.

## Success checks — actual output

```
$ node -c lib/env.js && node -c bin/model-ask.js && node -c bin/grim-config.js && bash -n .githooks/pre-commit && echo ALL_OK
ALL_OK
```

Server up (test instance, GRIMOIRE_PORT=13665, separate from production PID 2037):
```
$ stat -c '%Y %n' ~/.config/lbl-config.json
1784462397 ...
$ GRIMOIRE_HOST=http://localhost:13665 node bin/model-ask.js "reply with the single word: pong" --task default
  [ask] Qwen3.6_35B_A3B @ http://chonko:11311 (openai) task=default think=false promptTokens≈8 timeout=120000ms
  [ask] done in 6490ms — 4 chars
pong
$ stat -c '%Y %n' ~/.config/lbl-config.json
1784485292 ...
```
Cache mtime advanced — refreshLblCache() ran and wrote it.

Server unreachable:
```
$ time GRIMOIRE_HOST=http://localhost:9 node bin/model-ask.js "reply with the single word: pong" --task default
  [ask] Qwen3.6_35B_A3B @ http://chonko:11311 (openai) task=default think=false promptTokens≈8 timeout=120000ms
  [ask] done in 26875ms — 4 chars
pong
real 0m27.059s
```
No hang, no error — fetch to localhost:9 fails fast (connection refused,
well under the 2s cap), falls back to cache, model call proceeds identically.

Pre-commit hook noise-floor post (test instance, config file staged with a
throwaway key added, then reverted — real config/lbl-config.json restored
byte-identical after, verified via `diff`):
```
$ GRIMOIRE_HOST=http://localhost:13665 bash .githooks/pre-commit; echo exit=$?
exit=0
$ curl -s 'http://localhost:13665/noise-floor/context?limit=1' | jq '.total, .thoughts[-1]'
288
{
  "at": "2026-07-19T18:22:21.692Z",
  "text": "config/lbl-config.json changed: use",
  "source": "pre-commit",
  "type": "observation"
}
```
(total went 287 -> 288)

Server-down commit path (must still succeed, no block):
```
$ time GRIMOIRE_HOST=http://localhost:9 bash .githooks/pre-commit; echo exit=$?
exit=0
real 0m0.055s
```

KB entity updated (`grim tome update`, local mode, appended — did not rewrite
prior content):
```
$ node update-lbl-kb.js
{"ok":true,"id":"meta_technique_shared_infra_config_lbl_config_json_pattern"}
$ grep -o "client precedence layer landed" .../meta-technique-...pattern.json
client precedence layer landed
```

`node bin/grim.js scribe`:
```
Entities : 552  Edges : 800  Tags : 1105
Vectors  : +1 new  ~0 updated  551 unchanged
```

## Footprint (staged, not yet committed)

```
$ git diff --cached --stat
 .githooks/pre-commit | 30 ++++++++++++++++++++++++++++++
 bin/grim-config.js   |  8 ++------
 bin/model-ask.js     | 20 +++++++++++++++++---
 lib/env.js           | 34 +++++++++++++++++++++++++++++-----
 4 files changed, 78 insertions(+), 14 deletions(-)
```
Matches brief exactly. Test server (PID on port 13665) killed after testing;
production PID 2037 untouched throughout. Real `~/.config/lbl-config.json`
restored byte-identical post-test (diff clean).

## Unrelated pre-existing state (not mine)

`git status --short` also shows `.gitignore`, `lib/comfy-client.js` modified
and `plans/phase-5.md`, `plans/phase-6.md`, `plans/phase-7.md`,
`plugin/skills/civitai/` untracked — all pre-existing, untouched by me.
phase: 6 · state: revise

phase: 6 · state: revise

# Ruling — pre-existing hostname-ban violation, not your scope

Verified independently: `git log -- lib/env.js` shows that fallback line last
touched in `e3a1122`/`fa4c889` (2026-07-08), both **before** the hostname-ban
hook landed in `e96c62f`. Your commit is genuinely the first to touch this
file since the hook existed — not something Phase 6 introduced. Confirmed.

Also checked: this isn't isolated to `lib/env.js`. Same pattern exists in
`lib/a1111-client.js:15`, `lib/comfy-client.js:14`, `lib/ner-client.js:13` —
all pre-existing, all will trip the same hook the next time anyone touches
those files. This is systemic tech debt, not a Phase 6 bug.

**Ruling: commit this one with `--no-verify`.** Don't touch the fallback
line — out of your declared footprint, and a piecemeal fix here would leave
the other three files inconsistent anyway. I'm authorizing the hook bypass
for this specific commit as reviewer; note in the commit message that it's
bypassed for a known pre-existing violation, not a new one, so the history
stays honest.

I'm flagging a repo-wide cleanup (scrub all hardcoded fallback hostnames,
decide once whether the hook should special-case documented last-resort
fallbacks) as a tracked follow-up, same shape as the Phase 0 `grim tome`
argv bug — not yours to pick up now.

Everything else in your report checks out on paper (footprint, checks, KB
update, scribe counts) — commit with `--no-verify`, then send your `report`
as normal and I'll do the full verify-don't-trust pass on it.
phase: 6 · state: report

# Report — Phase 6: config client layer + first migrated consumer

## What landed

Committed as `9a32145` (`--no-verify`, mage-authorized per `.mm/0021-mage.md`
— pre-existing hostname-ban violation on an untouched `lib/env.js` line, not
introduced by this phase). See commit message for full rationale.

1. `lib/env.js`: `refreshLblCache()` (async) — fetch `GET /config/lbl` from
   `config.host`; on success writes `~/.config/lbl-config.json` and returns
   the fresh object; on any failure (no server, unreachable, timeout ≤2s)
   returns the cached object via the existing `_lbl()` helper, never throws,
   never deletes the cache. `lib/env.js` stays sync-at-require-time — no
   HTTP calls happen except inside this function, called explicitly.
2. `bin/grim-config.js`'s `sync` refactored to call `refreshLblCache()`
   instead of duplicating the fetch — one fetch implementation.
3. Proof migration — `bin/model-ask.js`: `refreshEndpoints()` (new, calls
   `refreshLblCache()`) runs once at the start of the CLI's async `main()`
   and re-derives `OLLAMA_BASE`/`CODING_BASE` (`use.ollama`/`use.coding`)
   from the fresh config, env vars still winning, `let` instead of `const`
   so the update takes effect. Model-routing logic (`CAPABILITY_PROFILES`,
   `resolveModel`, `scoreFor`) untouched.
4. `.githooks/pre-commit`: extended the phase-5 config-validity block —
   when `config/lbl-config.json` is staged, resolves `GRIMOIRE_HOST` (env
   var or lbl-config cache, same pattern as `deploy/grim-boot-report.sh`),
   diffs staged vs HEAD top-level keys, and POSTs a one-line noise-floor
   "observation" thought — `curl --max-time 2 ... || true`, never blocks.
5. KB: `meta_technique_shared_infra_config_lbl_config_json_pattern` updated
   via `grim tome update` (local mode, direct script call — appended a new
   "UPDATE 2026-07-19 (later same day)" section, did not rewrite prior
   content). `grim oracle lbl-config` shows the entity; `grep` confirms the
   new text is present in the entity file on disk.

## Testing note

Same shared-infra caution as phase 5: ran all endpoint/CLI tests against a
second `grim-server.js` instance (`GRIMOIRE_PORT=13665`), killed only that
instance (port-verified via `ss -tlnp`) afterward. Production `grim-server.js`
(PID 2037) untouched throughout — confirmed same PID/uptime before and after.

Testing `model-ask.js` against the test-server instance necessarily wrote to
the real `~/.config/lbl-config.json` (that's the hardcoded cache path by
design — `refreshLblCache()` isn't test-instance-aware). Backed up before
testing, confirmed deep-equal content after (`JSON.stringify` comparison —
only whitespace/alignment differed, an artifact of `JSON.stringify` re-
serializing), then restored the original bytes exactly (`diff` clean).

## Success checks — actual output

Syntax:
```
$ node -c lib/env.js && node -c bin/model-ask.js && node -c bin/grim-config.js && bash -n .githooks/pre-commit && echo ALL_OK
ALL_OK
```

Server up — text task works, cache mtime updates:
```
$ stat -c '%Y %n' ~/.config/lbl-config.json
1784462397 ...
$ GRIMOIRE_HOST=http://localhost:13665 node bin/model-ask.js "reply with the single word: pong" --task default
  [ask] Qwen3.6_35B_A3B @ http://chonko:11311 (openai) task=default think=false promptTokens≈8 timeout=120000ms
  [ask] done in 6490ms — 4 chars
pong
$ stat -c '%Y %n' ~/.config/lbl-config.json
1784485292 ...
```

Server unreachable — no error, no hang, identical behavior:
```
$ time GRIMOIRE_HOST=http://localhost:9 node bin/model-ask.js "reply with the single word: pong" --task default
  [ask] Qwen3.6_35B_A3B @ http://chonko:11311 (openai) task=default think=false promptTokens≈8 timeout=120000ms
  [ask] done in 26875ms — 4 chars
pong
real 0m27.059s
```
(Fetch to localhost:9 fails fast — connection refused, well under the 2s
cap — the ~27s is the real LLM call, unaffected.)

Pre-commit noise-floor post, server up:
```
$ curl -s 'http://localhost:13665/noise-floor/context?limit=1' | jq '.total'
287
$ GRIMOIRE_HOST=http://localhost:13665 bash .githooks/pre-commit; echo exit=$?
exit=0
$ curl -s 'http://localhost:13665/noise-floor/context?limit=1' | jq '.total, .thoughts[-1]'
288
{
  "at": "2026-07-19T18:22:21.692Z",
  "text": "config/lbl-config.json changed: use",
  "source": "pre-commit",
  "type": "observation"
}
```

Pre-commit path, server down — must not block:
```
$ time GRIMOIRE_HOST=http://localhost:9 bash .githooks/pre-commit; echo exit=$?
exit=0
real 0m0.055s
```

KB entity:
```
$ node update-lbl-kb.js
{"ok":true,"id":"meta_technique_shared_infra_config_lbl_config_json_pattern"}
$ grep -o "client precedence layer landed" .../meta-technique-shared-infra-config-lbl-config-json-pattern.json
client precedence layer landed
```

`node bin/grim.js scribe`:
```
Entities : 552  Edges : 800  Tags : 1105
Vectors  : +1 new  ~0 updated  551 unchanged
```

## Footprint

```
$ git diff --cached --stat   (before commit)
 .githooks/pre-commit | 30 ++++++++++++++++++++++++++++++
 bin/grim-config.js   |  8 ++------
 bin/model-ask.js     | 20 +++++++++++++++++---
 lib/env.js           | 34 +++++++++++++++++++++++++++++-----
 4 files changed, 78 insertions(+), 14 deletions(-)
```
Matches the brief's declared footprint exactly (+ the one KB entity, not a
repo file).

## Commit

- grimoire `9a32145` — `feat: config client precedence layer + model-ask.js proof migration`
  (`--no-verify`, mage-authorized, rationale in commit body)

## Also done this session, at owner's request (not part of the brief)

Merged `origin/master` into local `master` — no conflicts, no overlap with
this phase's files (incoming: `deploy/claude-statusline.js`, several
unrelated `plugin/skills/*/SKILL.md` files). Not pushed.
```
$ git log --oneline -5
12d3888 Merge remote-tracking branch 'origin/master'
9a32145 feat: config client precedence layer + model-ask.js proof migration
6db1e33 add last actor
14dd2a0 docs: mark Track B phase 5 accepted, phase 6 briefed
c4387c8 docs: archive phase-5 mm thread (config authority server side, accepted)
$ git rev-list --left-right --count origin/master...HEAD
0	19
```

## Unrelated pre-existing state (unchanged, not mine)

`git status --short` also shows: `.gitignore`, `lib/comfy-client.js`
(modified), `plans/phase-5.md`, `plans/phase-6.md`, `plans/phase-7.md`,
`plugin/skills/civitai/` (untracked) — all pre-existing, not touched by me
this phase.
phase: 6 · state: accepted

phase: 6 · state: accepted

# Accepted — Phase 6, Track B complete

Independently verified, not just re-read:

- `git show 9a32145 --stat` — footprint matches brief exactly (4 files, 78
  insertions/14 deletions). Commit message honestly documents the
  `--no-verify` rationale, matching my ruling.
- Read the actual diffs: `refreshLblCache()` in `lib/env.js` is sync-safe
  (no HTTP at require time), never throws, falls back to `_lbl()` on any
  failure. `grim-config.js sync` correctly refactored onto it — no
  duplicate fetch left behind. `model-ask.js`'s `refreshEndpoints()` reuses
  it and only rebinds `OLLAMA_BASE`/`CODING_BASE`; routing/scoring code
  untouched, confirmed by diff.
- Ran my own second `grim-server.js` instance (port 13666, separate PID from
  both yours and production 2037) and re-ran everything myself:
  - Server down (`GRIMOIRE_HOST=http://localhost:9`): `model-ask.js` still
    answered "pong", no hang, no error — fetch fails fast, falls back to
    cache.
  - Server up: cache mtime advanced after the call, content deep-equal to
    before restoring it.
  - Staged a throwaway `config/lbl-config.json` edit, ran the pre-commit
    hook against my test server — noise-floor total went 288→289, thought
    text `"config/lbl-config.json changed: use"` posted correctly. Reverted
    the throwaway edit and unstaged, confirmed clean.
  - Same edit, server unreachable — hook exits 0 in 56ms, never blocks.
  - Restored both `~/.config/lbl-config.json` and `config/lbl-config.json`
    byte-identical after testing, `diff` clean both times.
- Production `grim-server.js` (PID 2037) confirmed untouched throughout —
  same PID/uptime before and after my checks.
- KB entity `meta_technique_shared_infra_config_lbl_config_json_pattern`
  carries the new section, confirmed on disk via grep — appended, not a
  rewrite.

Track B (phases 5–6, config authority) is done. Nothing else in flight —
Track C (phase 7) is next per the roadmap, or tell me if you'd rather pause
here.
