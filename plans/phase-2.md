# Phase 2 — cull UI into grimoire

Read `plans/ROADMAP.md` first. Requires phase 1's `ext/grimoire` symlink.

## Source → target

`~/src/me/wantan/bin/cull.js` (567 lines, stdlib-only) → `bin/grim-cull.js`

## Steps

1. **`bin/grim-cull.js`** — port verbatim except the two constants at lines 7–8:
   ```js
   const SERVE_ROOT = '/home/vgvm/public_html/wantan';
   const SERVE_URL  = 'http://aid/~vgvm/wantan';
   ```
   Resolution order for each: `--serve-root` / `--serve-url` flag → env
   `GRIM_CULL_SERVE_ROOT` / `GRIM_CULL_SERVE_URL` → the current values above as final
   defaults. Match the arg-parsing style already used in the file; no new deps.
2. **`grim cull` subcommand** — register in `bin/grim.js` exactly the way existing
   subcommands dispatch to their `bin/grim-*.js` files (read the dispatcher first, copy the
   pattern).
3. **wantan shim** — replace `~/src/me/wantan/bin/cull.js` with an exec shim that runs
   `ext/grimoire/bin/grim-cull.js`, passing through argv and presetting wantan's serve
   root/url (the two values above) via env so `bin/char-portrait.sh:178`
   (`node bin/cull.js "${dir}"`) behaves identically.

## Success checks (run all)

```bash
cd ~/src/me/grimoire
mkdir -p /tmp/claude-cull-test && cp <a few PNGs from wantan gen/> /tmp/claude-cull-test/
node bin/grim.js cull /tmp/claude-cull-test --serve-root /tmp/claude-cull-test --serve-url file:///tmp/claude-cull-test
# → cull.html generated; open it, exercise cull + undo (ctrl-z) + zone moves

cd ~/src/me/wantan
node bin/cull.js <an existing portrait run dir>   # unchanged behavior via shim
git diff --stat    # wantan: exactly bin/cull.js
```
