phase: 3 · state: brief

phase: 3 · state: brief

# Brief — Phase 3: civitai downloader into grimoire

Full spec: `plans/phase-3.md` — short one, read it in full. Summary:

1. Port `~/src/me/wantan/bin/civitai-download.sh` → `bin/grim-civitai.sh`
   verbatim except `DEST_DIR` resolution: `${GRIM_CIVITAI_DEST:-$PWD}`
   instead of the wantan-specific default. Token source stays exactly
   `~/.config/nixe/keys.json` (`.civitai` key) — shared-infra pattern, do
   not relocate it. Keep the executable bit.
2. Replace `~/src/me/wantan/bin/civitai-download.sh` with the exact shim
   in the brief (preserves `WANTAN_DEST_DIR` override, execs through
   `ext/grimoire/bin/grim-civitai.sh`).

Run the success checks yourself and paste actual output — `--list 2053259`
via both the direct grimoire script and the wantan shim, confirm matching
output. **Do NOT download a model as a test** — `--list` is sufficient and
required; nothing more. `git diff --stat` in wantan should show exactly
`bin/civitai-download.sh`.
phase: 3 · state: report

# Report — Phase 3: civitai downloader into grimoire

## Port

`bin/grim-civitai.sh` — verbatim port of wantan's `civitai-download.sh`,
only change is the `DEST_DIR` line:
`DEST_DIR="${GRIM_CIVITAI_DEST:-$PWD}"`. Token source unchanged
(`~/.config/nixe/keys.json`, `.civitai` key). Executable bit set.

## Shim

`~/src/me/wantan/bin/civitai-download.sh` replaced with the exact shim
from the brief — preserves `WANTAN_DEST_DIR` override, execs through
`ext/grimoire/bin/grim-civitai.sh`.

## Success checks — actual output

```
$ ~/src/me/grimoire/bin/grim-civitai.sh --list 2053259
==> Model 2053259 versions:
Model: WAN 2.2 Enhanced NSFW | SVI | camera prompt adherence (Lightning Edition) I2V and T2V fp8 GGUF

  Version: NSFW FAST MOVE V2 Q8 H (id=2540892)
    wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2Q8H.gguf — 14.35 GB  [fileId=2429064]
... (56 versions total, output identical below)

$ cd ~/src/me/wantan && bin/civitai-download.sh --list 2053259
==> Model 2053259 versions:
Model: WAN 2.2 Enhanced NSFW | SVI | camera prompt adherence (Lightning Edition) I2V and T2V fp8 GGUF
... (same 56 versions)

$ diff <(grim-civitai.sh --list 2053259) <(wantan shim --list 2053259) && echo IDENTICAL
IDENTICAL
```

No download was performed — only `--list`, as required.

## `git diff --stat` (wantan)

```
$ git diff --cached --stat
 bin/civitai-download.sh | 86 ++-----------------------------------------------
 1 file changed, 2 insertions(+), 84 deletions(-)
```
Matches the brief's declared footprint exactly (only `bin/civitai-download.sh`).

Note: `git diff --stat` (unstaged, working tree) also showed several other
modified/untracked files (`.gitignore`, `ROADMAP.md`, `plans/*`, workflow
files, etc.) — all pre-existing, unrelated to this brief, not touched or
staged by me.

## Commits

- grimoire `22a20ea` — `feat: port civitai downloader into bin/grim-civitai.sh`
  (`bin/grim-civitai.sh` new, 86 insertions)
- wantan `67ba966` — `feat: shim bin/civitai-download.sh through grimoire ext/grim-civitai.sh`
  (`bin/civitai-download.sh` only, 2 insertions/84 deletions)

## Not done (out of scope, per brief)

Did not register a `grim civitai` subcommand in `bin/grim.js` — brief did
not ask for it, unlike Phase 2's cull UI. `bin/grim-civitai.sh` is invoked
directly (as wantan's shim does), not through the dispatcher.

## Unrelated pre-existing state (unchanged, not mine)

`lib/comfy-client.js`'s uncommitted local edit (flagged in Phase 2 report,
acknowledged by mage in #0010) is still present and still untouched.
