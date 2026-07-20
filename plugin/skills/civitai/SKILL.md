---
name: civitai
description: Download a model version from Civitai, or list a model's available versions and files, via the resumable grim-civitai downloader. Use when the user wants to fetch a checkpoint/LoRA/GGUF from a Civitai model page/ID, or check what versions exist before choosing one.
argument-hint: "--list <modelId> | <modelVersionId> [output_filename]"
allowed-tools: [Bash]
---

# /civitai — resumable Civitai model downloader

Wraps `bin/grim-civitai.sh` — lists versions/files for a Civitai model, or
resumably downloads a specific version.

## Arguments

$ARGUMENTS:
- `--list <modelId>` — list all versions + files for a model (the numeric ID
  from the Civitai model page URL, not a version ID)
- `<modelVersionId> [output_filename]` — download that version; filename is
  optional, defaults to the file's original name

## Instructions

```bash
cd ~/src/me/grimoire
bin/grim-civitai.sh --list <modelId>
bin/grim-civitai.sh <modelVersionId> [output_filename]
```

Always `--list` first if the user only gave a model page URL/ID rather than
a specific version — versions and file variants (fp8/fp16/GGUF quant, etc.)
differ enough that guessing which one they want is a bad default.

Report the download destination path back to the user when done.

## Notes

- Download destination: `$GRIM_CIVITAI_DEST` env if set, else `$PWD`.
- Auth token read from `~/.config/nixe/keys.json` (`.civitai` key) — the
  shared-infra keys pattern; never ask the user for a token directly.
- Download is resumable — safe to re-run on a partial/interrupted file.
- Do not use `--list` output as a substitute for actually downloading when
  the user wants the file — it's a lookup step, not the end goal.
