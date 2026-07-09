# Phase 1 — ComfyUI client into grimoire lib

Read `plans/ROADMAP.md` first: the shim mechanism and hard rules apply.

## Source → target

| Source (wantan) | Target (grimoire) |
|---|---|
| `~/src/me/wantan/bin/comfy-queue.js` (309 lines) | `lib/comfy-client.js` |
| `~/src/me/wantan/bin/comfy-watch-lib.js` (291 lines) | `lib/comfy-watch.js` |

## Steps

1. **`lib/comfy-client.js`** — port `comfy-queue.js` verbatim. It uses node stdlib only
   (`fs`, `http`, `path`) — no local deps. Changes allowed:
   - Header doc-block + `'use strict'` in the style of `lib/a1111-client.js`.
   - Default ComfyUI host: read `process.env.GRIMOIRE_COMFY_HOST` first, then the current
     hardcoded default. Keep the class importable AND the CLI entry (`require.main === module`)
     working.
2. **`lib/comfy-watch.js`** — port `comfy-watch-lib.js` with ONE structural change: delete
   `const { KNOWN_HOSTS } = require('./hosts.js')` (line 10). `watchJob(opts)` gains an
   optional `knownHosts` array (default `[]`), used where `KNOWN_HOSTS` was used
   (the fallback candidate-host list, old lines 114–115). Export `{ watchJob }` only.
3. **wantan symlink**: `ln -s ~/src/me/grimoire ~/src/me/wantan/ext/grimoire`.
   Add one line to wantan `README.md` Setup section alongside the other `ext/` links.
4. **wantan shims** (old paths, old export shapes, callers untouched):
   - `bin/comfy-queue.js` → re-export everything from `../ext/grimoire/lib/comfy-client.js`;
     when run directly, delegate to its CLI (e.g. spawn or require-and-run).
   - `bin/comfy-watch-lib.js` →
     ```js
     const { watchJob: _watchJob } = require('../ext/grimoire/lib/comfy-watch.js');
     const { KNOWN_HOSTS } = require('./hosts.js');
     const watchJob = (opts) => _watchJob({ knownHosts: KNOWN_HOSTS, ...opts });
     module.exports = { watchJob, KNOWN_HOSTS };
     ```

## Success checks (run all)

```bash
cd ~/src/me/wantan
node bin/skills/i2v.js --help                    # resolves through the shim, prints usage
node -e "const q=require('./bin/comfy-queue.js'); console.log(typeof q)"
node -e "const w=require('./bin/comfy-watch-lib.js'); console.log(Object.keys(w))"  # [watchJob, KNOWN_HOSTS]
git diff --stat    # exactly: bin/comfy-queue.js, bin/comfy-watch-lib.js, README.md (+ ext untracked)
```
If a ComfyUI host is up (check `aid:13031`), queue one cheap real job via an existing skill and
watch it complete. If no host is up, say so in the report — do not claim the live check passed.
