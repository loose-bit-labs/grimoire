# Phase 3 — civitai downloader into grimoire

Read `plans/ROADMAP.md` first. Requires phase 1's `ext/grimoire` symlink.

## Source → target

`~/src/me/wantan/bin/civitai-download.sh` → `bin/grim-civitai.sh`

## Steps

1. **`bin/grim-civitai.sh`** — port verbatim except:
   - `DEST_DIR="${WANTAN_DEST_DIR:-$REPO/ext/comfy/models/diffusion_models}"` becomes
     `DEST_DIR="${GRIM_CIVITAI_DEST:-$PWD}"`.
   - Token source is UNCHANGED: `~/.config/nixe/keys.json` (`.civitai` key) — this is the
     shared-infra keys pattern, do not move it.
   - Keep executable bit.
2. **wantan shim** — replace `~/src/me/wantan/bin/civitai-download.sh` with:
   ```bash
   #!/bin/bash
   REPO="$(cd "$(dirname "$0")/.." && pwd)"
   export GRIM_CIVITAI_DEST="${WANTAN_DEST_DIR:-$REPO/ext/comfy/models/diffusion_models}"
   exec "$REPO/ext/grimoire/bin/grim-civitai.sh" "$@"
   ```
   (Preserves the old `WANTAN_DEST_DIR` override for any existing muscle memory.)

## Success checks (run all)

```bash
~/src/me/grimoire/bin/grim-civitai.sh --list 2053259     # read-only API call, lists versions
cd ~/src/me/wantan && bin/civitai-download.sh --list 2053259   # same output via shim
git diff --stat    # wantan: exactly bin/civitai-download.sh
```
Do NOT download a model as a test — `--list` is sufficient.
