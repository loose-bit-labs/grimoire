phase: 1 · state: brief

phase: 1 · state: brief

# Brief — Phase 1: ComfyUI client into grimoire lib

Hierophant direction (#0001, #0002) is binding. Roadmap: `plans/ROADMAP.md`.
Full spec: `plans/phase-1.md` — read it in full before starting, it has exact
line-level instructions. Summary:

1. Port `~/src/me/wantan/bin/comfy-queue.js` → `lib/comfy-client.js` verbatim
   (stdlib only). Add doc-block + `'use strict'` matching `lib/a1111-client.js`
   style. Default ComfyUI host: `process.env.GRIMOIRE_COMFY_HOST` first, then
   the existing hardcoded default. Keep both the importable class and the CLI
   entry (`require.main === module`) working.
2. Port `~/src/me/wantan/bin/comfy-watch-lib.js` → `lib/comfy-watch.js` with
   ONE structural change: drop the `./hosts.js` KNOWN_HOSTS import; `watchJob(opts)`
   gains an optional `knownHosts` array (default `[]`) used wherever KNOWN_HOSTS
   was used. Export `{ watchJob }` only.
3. Create symlink `~/src/me/wantan/ext/grimoire -> ~/src/me/grimoire`. Add one
   line to wantan's `README.md` Setup section next to the other `ext/` links.
4. Shim the two old wantan paths exactly as specified in the brief (re-export
   shapes must match — `comfy-queue.js` re-exports + CLI delegation,
   `comfy-watch-lib.js` wraps `watchJob` with `KNOWN_HOSTS` injected). The 15
   existing wantan callers are never touched.

**Hard rules (do not violate):** don't touch `prompts/*.md`, `story-summarize.js`,
`prompt-clean.js`, `prompt-forge.js` — out of scope by ruling. Don't edit any of
the 15 wantan callers. Shims stay under ~20 lines each.

Run every success check in `plans/phase-1.md` yourself and paste the actual
output in your report — including the live ComfyUI queue/watch check if a host
is up (check `aid:13031`); if none is up, say so explicitly, don't skip it
silently. Report back with `grim mm write --role minion --state report`.
phase: 1 · state: question

## Blocker: spec contradiction on `connectWS` export

`lib/comfy-watch.js` and both shims already exist on disk (written in a prior
pass) — steps 1–3 look complete. But step 4 as specified breaks a live caller:

- Brief (and `plans/phase-1.md` step 2) say `lib/comfy-watch.js` must
  **"Export `{ watchJob }` only."** — confirmed, that's what's on disk.
- Original `wantan/bin/comfy-watch-lib.js` exported
  `{ watchJob, KNOWN_HOSTS, connectWS }` (verified via `git show HEAD:...`).
- `wantan/bin/free-watchdog.js:46` does
  `const { connectWS } = require('./comfy-watch-lib.js')` and calls it at
  line 211. free-watchdog.js is one of the untouched 15 callers.
- The shim currently on disk tries to re-export `connectWS` from
  `../ext/grimoire/lib/comfy-watch.js`, but that module doesn't export it —
  so `connectWS` comes through as `undefined`. Confirmed live:

  ```
  $ node -e "const w=require('./bin/comfy-watch-lib.js'); console.log(Object.keys(w), typeof w.connectWS)"
  [ 'watchJob', 'KNOWN_HOSTS', 'connectWS' ] undefined
  ```

  free-watchdog.js will crash the first time it calls `connectWS(...)`.
  This violates "behavior out of the box is unchanged on both sides" and
  "the 15 existing wantan callers are never touched" (their behavior, not
  just their source, is in scope).

Two ways to close this, need a ruling before I touch anything further:

1. **`lib/comfy-watch.js` also exports `connectWS`** (verbatim, no behavior
   change — it doesn't reference KNOWN_HOSTS at all, so it needs no wrapping).
   Shim re-exports it straight through. Minimal diff from what's already
   on disk: add `connectWS` to the `module.exports` in the lib file.
2. Keep the lib export as `{ watchJob }` only, and have the **shim** require
   `connectWS` from the *original* wantan implementation instead of the
   grimoire lib — but the original implementation no longer exists locally
   once ported, so this would mean keeping a second copy of `connectWS` in
   the shim, which contradicts "shims stay under ~20 lines" and "verbatim
   port" intent.

Option 1 seems clearly right (it's the same function, unrelated to the
KNOWN_HOSTS refactor this phase is about) but the brief was explicit about
"Export `{ watchJob }` only," so I'm not silently overriding that — flagging
before I change it.

## State of the rest (steps 1–3), verified so far

- `lib/comfy-client.js` (325 lines) — ported, doc-block + `'use strict'` in
  `a1111-client.js` style, `GRIMOIRE_COMFY_HOST` env fallback present, CLI
  entry (`require.main === module`) intact, exports `{ ComfyQueue }`.
- `lib/comfy-watch.js` (333 lines) — `hosts.js`/`KNOWN_HOSTS` import dropped,
  `watchJob(opts)` takes `knownHosts = []`, used at `findHost()` call sites
  (lines 117–177). Exports `{ watchJob }` only (see blocker above).
- Symlink: `~/src/me/wantan/ext/grimoire -> ~/.grimoire -> grimoire repo`
  (indirected through a `~/.grimoire` dotlink, not a direct symlink to the
  repo path — not what the brief literally says but functionally
  equivalent and already wantan's established pattern per its own README).
- `~/src/me/wantan/README.md` Setup section has the `ext/grimoire` line.
- Shims are in place (`bin/comfy-queue.js` 9 lines, `bin/comfy-watch-lib.js`
  9 lines) — both well under the 20-line budget, but the watch shim's
  `connectWS` re-export is currently broken per the blocker above.

Have not run the full success-check suite or touched anything further —
stopping here pending a ruling on the `connectWS` export.
phase: 1 · state: revise

phase: 1 · state: revise

# Ruling: connectWS blocker — go with option 1

Confirmed independently: `connectWS(host, wsPath, onMessage, onClose)` in the
original `comfy-watch-lib.js` doesn't touch `KNOWN_HOSTS` — it's an unrelated
export riding along in the same file. "Export `{ watchJob }` only" in the brief
was about not carrying the `hosts.js` dependency into the lib, not about
dropping unrelated live exports. The hard rule that outranks the literal
phrasing: the 15 callers' *behavior* stays unchanged, and `free-watchdog.js`
depends on `connectWS`. Ship option 1.

1. Add `connectWS` to `module.exports` in `lib/comfy-watch.js` (verbatim,
   already defined at line 57 — just add it to the exports line).
2. No shim change needed — `bin/comfy-watch-lib.js` already re-exports it
   correctly, it'll resolve once the lib exports it.
3. Re-run the full success-check suite from `plans/phase-1.md` and paste
   actual output for all of it, including:
   - `node bin/comfy-watch-lib.js` require check → expect
     `[ 'watchJob', 'KNOWN_HOSTS', 'connectWS' ] function`
   - the live ComfyUI check — `aid:13031` is up (confirmed `200` on
     `/system_stats` just now), so queue one cheap real job via an existing
     skill and watch it complete, don't skip this.
4. Re-report with `grim mm write --role minion --state report`, phase 1.
phase: 1 · state: report

# Report — Phase 1: ComfyUI client into grimoire lib

## Applied ruling (#0005)

Added `connectWS` to `lib/comfy-watch.js`'s `module.exports` (verbatim
function already at line 57, unrelated to the KNOWN_HOSTS refactor). No
shim change was needed for this part — `bin/comfy-watch-lib.js` already
re-exported it.

## Second bug found while running the live check — fixed, applying the same principle

The shim's `watchJob` wrapper (both what was on disk and the brief's own
sample code in `plans/phase-1.md`) was a single-arg wrapper:

```js
const watchJob = (opts) => _watchJob({ knownHosts: KNOWN_HOSTS, ...opts });
```

But wantan's original `watchJob` signature — confirmed via
`git show HEAD:bin/comfy-watch-lib.js` — is `watchJob(promptId, opts = {})`,
**two** positional args. The single-arg wrapper silently drops `promptId`
(every caller passes it positionally: `i2v.js`, `chain-i2v.js`, etc.), and
the real `promptId` string gets object-spread into `opts` character-by-index
instead. Reproduced live:

```
$ node -e "require('./bin/comfy-watch-lib.js').watchJob('a89a...', {host:'aid:13031',...})"
Locating [object Object] ... not found yet, searching ...
  [0m05s] searching all hosts ... [0m10s] ... (hangs forever, host never matches)
```

Same failure class as the `connectWS` blocker — brief's literal shim code
vs. "the 15 callers' behavior stays unchanged." Per your ruling's own
stated principle, I applied the fix rather than filing a third question
round, since it was mechanically unambiguous (only one signature makes the
existing two-arg call sites work) and I needed it to run the live check you
required. Fixed in `wantan/bin/comfy-watch-lib.js`:

```js
const watchJob = (promptId, opts = {}) => _watchJob(promptId, { knownHosts: KNOWN_HOSTS, ...opts });
```

Flagging this explicitly in case you want it reverted/handled differently —
did not touch `plans/phase-1.md`'s sample code, only the shim file itself.

## Success checks — actual output

```
$ cd ~/src/me/wantan
$ node bin/skills/i2v.js --help
I2V — image-to-video for character animation (walking, reacting, pose-to-motion).

Usage: i2v.js [--image FILE] [--prompt TEXT] [--neg TEXT]
              [--frames N] [--seed N|random] [--host HOST]
              [--character NAME] [--show SHOW]
              [--workflow 5b|14b]  (default: per-host)
              [--watch|--no-watch] [--out FILE|DIR] [--free]
              -h, --help
...

$ node -e "const q=require('./bin/comfy-queue.js'); console.log(typeof q)"
object

$ node -e "const w=require('./bin/comfy-watch-lib.js'); console.log(Object.keys(w))"
[ 'watchJob', 'KNOWN_HOSTS', 'connectWS' ]

$ git diff --stat -- bin/comfy-queue.js bin/comfy-watch-lib.js README.md
 README.md              |   4 +
 bin/comfy-queue.js     | 316 +----------------------------------------------
 bin/comfy-watch-lib.js | 325 +------------------------------------------------
 3 files changed, 9 insertions(+), 636 deletions(-)
```

Matches the brief's declared footprint exactly. (Rest of `wantan git
status` — `.gitignore`, `ROADMAP.md`, docs/specs, `plans/phase-2R/8/A-audio`,
`sick01.png`, `workflows/…` — is pre-existing unrelated work, not touched,
not staged, not committed by me.)

`ext/` diff: nothing shown — `wantan/.gitignore` already ignores `ext/`
(existing convention), so the symlink is invisible to git status as
expected; brief's "(+ ext untracked)" note confirmed:
```
$ ls -la ext/grimoire
lrwxrwxrwx 1 vgvm vgvm 20 Jul 18 11:15 ext/grimoire -> /home/vgvm/.grimoire
```
(indirected through the pre-existing `~/.grimoire -> grimoire repo` dotlink,
wantan's established pattern — not a direct symlink to the repo path, but
functionally identical and matches what's documented in wantan's README.)

## Live ComfyUI check

`aid:13031` confirmed up (`GET /system_stats` → 200). Queued a real job via
the existing `bin/skills/qwen-img.js` skill (1024x1024, 4 steps — cheapest
available), then watched it end-to-end through the fixed shim:

```
$ node bin/skills/qwen-img.js
qwen-img → .../workflows/wantan-qwen-img-api.json
  1024x1024, 4 steps
✓ Queued — prompt_id: 15d93459-c3a8-4882-9bff-7c6fe114e3b8

$ node -e "require('./bin/comfy-watch-lib.js').watchJob('15d93459-...', {host:'aid:13031', outDir:'...'}).then(r=>console.log('DONE',JSON.stringify(r)))"
✓ Already done — downloading
  ↓ DonkeyTron_Qwen__00001_.png ... /tmp/.../scratchpad/DonkeyTron_Qwen__00001_.png (1675 KB)
DONE ["/tmp/.../scratchpad/DonkeyTron_Qwen__00001_.png"]
```

(4-step image gen completes faster than the watch call starts, so this
exercised the "already done, download from history" branch rather than the
live WebSocket progress branch — both paths share the same `findHost` /
`downloadOutputs` code, and the fix above is what let `findHost` match the
promptId at all instead of hanging on `[object Object]`.)

## Commits

- grimoire `89977a2` — `feat: port ComfyUI queue/watch client from wantan into grimoire lib`
  (`lib/comfy-client.js`, `lib/comfy-watch.js`, new files)
- wantan `f5967c5` — `feat: shim comfy-queue.js/comfy-watch-lib.js through grimoire ext/`
  (`bin/comfy-queue.js`, `bin/comfy-watch-lib.js`, `README.md`)

Neither commit touches any file outside the brief's declared footprint —
verified via `git diff --cached --stat` before committing in both repos.

## Out-of-scope items untouched (confirmed)

`prompts/*.md`, `story-summarize.js`, `prompt-clean.js`, `prompt-forge.js` —
not touched. None of the 15 wantan callers' source was edited (only their
runtime behavior was restored via the two shim fixes above).
