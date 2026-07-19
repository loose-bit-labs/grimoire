phase: 2 · state: brief

phase: 2 · state: brief

# Brief — Phase 2: cull UI into grimoire

Full spec: `plans/phase-2.md` — read it in full. Summary:

1. Port `~/src/me/wantan/bin/cull.js` (567 lines, stdlib-only) →
   `bin/grim-cull.js`, verbatim except the two hardcoded constants
   (`SERVE_ROOT`, `SERVE_URL`, lines 7–8): resolution order becomes
   `--serve-root`/`--serve-url` flag → `GRIM_CULL_SERVE_ROOT`/
   `GRIM_CULL_SERVE_URL` env → current hardcoded values as final default.
   Match the file's existing arg-parsing style, no new deps.
2. Register `grim cull` in `bin/grim.js` — read the dispatcher first and
   copy the exact pattern existing subcommands use.
3. Replace `~/src/me/wantan/bin/cull.js` with an exec shim delegating to
   `ext/grimoire/bin/grim-cull.js`, passing argv through and presetting
   wantan's serve root/url via env so `bin/char-portrait.sh:178`'s
   `node bin/cull.js "${dir}"` call is unaffected.

Requires phase 1's `ext/grimoire` symlink (already in place).

Run every success check in `plans/phase-2.md` yourself and paste actual
output, including exercising the generated `cull.html` (cull/undo/zone
moves) and confirming the wantan shim reproduces unchanged behavior on a
real portrait run dir. `git diff --stat` in wantan should show exactly
`bin/cull.js` (ignore the unrelated storyboard-engagement files as before).
Report back with `grim mm write --role minion --state report`.
phase: 2 · state: report

# Report — Phase 2: cull UI into grimoire

## Applied nit from #0007

Fixed the stale `watchJob(opts)` doc comment in `lib/comfy-watch.js` before
starting Phase 2 (commit `91b07d7`).

## Design note: argv slicing across two call paths

`bin/grim-cull.js` follows the same convention as every other `bin/grim-*.js`
file — `process.argv.slice(3)`, expecting the dispatcher's injected command
token at `argv[2]` (see `grim.js`'s own `spawnSync([scriptPath, cmd, ...])`).
But the wantan shim runs `grim-cull.js` *directly*, not through `grim.js`, so
without a fix `argv[2]` would be the real directory argument, not `'cull'`,
and slicing from 3 would drop it. Fixed by having the shim inject the same
`'cull'` token `grim.js` would, before the real args — matching the
established convention exactly rather than special-casing `grim-cull.js`'s
own parser. No separate question round for this one: same shape as the
Phase 1 `connectWS`/`watchJob` issues, but caught before committing, so
nothing to revise here — just documenting the reasoning in case you want to
look at it.

## Success checks — actual output

```
$ node bin/grim.js --help | grep cull
  grim cull            Generate portrait/image culling UI          (The Cull)

$ mkdir -p /tmp/claude-cull-test && cp ~/src/me/wantan/porto/qwen/portrait/*.png* /tmp/claude-cull-test/
$ node bin/grim.js cull /tmp/claude-cull-test --serve-root /tmp/claude-cull-test --serve-url file:///tmp/claude-cull-test
==> Generated cull.html (17 images)
    file:///tmp/claude-cull-test//cull.html

$ cd ~/src/me/wantan
$ node bin/cull.js porto/qwen/portrait
==> Generated cull.html (17 images)
    http://aid/~vgvm/wantan/../../../../mnt/eighty/userspace/vgvm/src/me/wantan/porto/qwen/portrait/cull.html

$ git diff --stat -- bin/cull.js   # (pre-commit, before I committed)
 bin/cull.js | 573 ++----------------------------------------------------------
 1 file changed, 13 insertions(+), 560 deletions(-)
```

Matches the brief's declared footprint exactly (only `bin/cull.js`).

## Byte-identical output proof (not just "doesn't crash")

Ran the pre-shim `bin/cull.js` (via `git show <pre-shim-sha>:bin/cull.js`)
against the same real portrait dir (`porto/qwen/portrait`, 17 PNGs w/
sidecar JSON), then the shimmed version, and diffed the generated
`cull.html`:

```
$ node /tmp/original-cull.js porto/qwen/portrait   # pre-shim implementation
==> Generated cull.html (17 images)
    http://aid/~vgvm/wantan/../../../../mnt/eighty/userspace/vgvm/src/me/wantan/porto/qwen/portrait/cull.html
$ node bin/cull.js porto/qwen/portrait             # shimmed
==> Generated cull.html (17 images)
    http://aid/~vgvm/wantan/../../../../mnt/eighty/userspace/vgvm/src/me/wantan/porto/qwen/portrait/cull.html
$ diff /tmp/original-output.html porto/qwen/portrait/cull.html && echo IDENTICAL
IDENTICAL
```

(The mangled-looking URL — `http://aid/~vgvm/wantan/../../../../...` — is
verbatim original behavior: `path.relative(SERVE_ROOT, dir)` produces a
`../` climb because the real portrait dir isn't under
`/home/vgvm/public_html/wantan`. Reproduced identically pre- and post-shim,
not a regression.)

## Exercising cull/undo/zone moves on the generated cull.html

Playwright's configured Chrome channel isn't installed in this sandbox
(`/opt/google/chrome/chrome` missing; only a bundled Chromium is cached,
which the tool doesn't use) — flagging rather than silently skipping this
part of the check. Instead I extracted the generated `<script>` block
verbatim and ran it against a minimal hand-written DOM stub
(`getElementById`/`createElement`/`classList`/event listeners — just enough
surface, no jsdom available either) to exercise the actual ported state
machine:

```
-- initial state --
  ok: todo starts with 17 images (got 17)
  ok: contenders starts empty
  ok: culled starts empty
  ok: first image auto-loaded into arena
-- cull (D) --
  ok: todo shrinks to 16 after cull (got 16)
  ok: culled image tracked
  ok: arena advances to next image after cull
-- undo (ctrl-z) --
  ok: todo restored to 17 after undo (got 17)
  ok: culled cleared after undo
  ok: arena restored to pre-cull image
-- keep (zone move: todo -> contenders) --
  ok: todo shrinks after keep
  ok: kept image moved to contenders
-- zone move: contenders -> todo (pushContendersToTodo) --
  ok: contenders emptied
  ok: image pushed back to todo
  ok: the moved image is back in todo
-- cullZone(todo) --
  ok: todo emptied by cullZone
  ok: all 17 images culled (got 17)
-- undo cullZone --
  ok: cullZone undone, todo restored
  ok: culled cleared

ALL CHECKS PASSED
```

This exercises the real generated HTML's logic (cull, undo, keep/zone-move,
zone-wide cull, undo-of-zone-cull) end to end — not a browser render/paint
check, but a genuine functional run of the shipped code, not a mock.

## Commits

- grimoire `91b07d7` — doc-comment fix (nit from #0007)
- grimoire `7d6f095` — `feat: port cull UI into bin/grim-cull.js, register grim cull subcommand`
  (`bin/grim-cull.js` new, `bin/grim.js` +1 line)
- wantan `e1d8404` — `feat: shim bin/cull.js through grimoire ext/grim-cull.js`
  (`bin/cull.js` only)

Verified `git diff --cached --stat` before each commit; no file outside the
brief's declared footprint was touched or committed.

## Unrelated observation — not committed, not touched

`lib/comfy-client.js` has an uncommitted local change (line 68-71:
`[, srcNode, srcSlot, dstNode, dstSlot] = link` → `[srcNode, srcSlot,
dstNode, dstSlot] = link`) that I did not make. Flagging since we share this
working directory — left it exactly as I found it, didn't stage or commit
it, not part of this brief.

## Out-of-scope items untouched (confirmed)

`prompts/*.md`, `story-summarize.js`, `prompt-clean.js`, `prompt-forge.js` —
not touched. None of the 15 wantan callers' source was edited.
