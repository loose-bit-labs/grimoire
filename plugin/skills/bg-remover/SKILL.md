---
name: bg-remover
description: Use when removing backgrounds from images, GIFs, or videos to produce transparent PNG / webm / ProRes 4444 / GIF output. Local BiRefNet matting (no API key needed), multi-file and batch-folder modes.
version: 1.0.0
allowed-tools: Bash, Read
---

# THE MATTE ARTIFICER

Local BiRefNet background removal — transparent cutouts for stills, animated images, and full video, one tool.

## Arguments

- `input(s)`: one or more files (jpg/png/webp/bmp/tiff/gif/mp4/mkv/mov/avi/webm/m4v), or a folder for batch
- `-o OUT`: output **file** when exactly one input; output **directory** when multiple inputs or a folder
- `--out-codec auto|webm|mov|gif`: video output (webm = VP9 yuva420p default; mov = ProRes 4444 for editing; gif = transparent palette)
- `--fps N`: override source fps; `--no-audio`: drop audio; `--mode api`: HF Space fallback instead of local model

## Steps

1. Locate the tool: `which bg_remover.py` — it lives in `~/bin` on this host (not in PATH by default? it is: `~/bin` is on PATH; fall back to `~/bin/bg_remover.py` if `which` misses).
2. Pick the interpreter: needs `torch` + `transformers` + `torchvision` + `Pillow` + `tqdm` and `ffmpeg`/`ffprobe` on PATH. On blip that is the pyenv `printing` env — `/home/vgvm/.pyenv/versions/printing/bin/python`.
3. Run:
   - Single: `python bg_remover.py in.jpg` (or with `-o out.png`)
   - Multiple: `python bg_remover.py a.jpg b.png` (next to inputs) or `python bg_remover.py a.jpg b.png -o outdir/`
   - Folder: `python bg_remover.py ./inputs/ -o outdir/` (or `--batch`)
   - Video: `python bg_remover.py clip.mp4 -o cut.webm`
4. Verify the output: open with PIL and check `im.mode == "RGBA"` and `im.getchannel("A").getextrema() == (0, 255)`. An alpha of `(255, 255)` means the matting produced a fully opaque mask (subject fills the frame, or the forward silently misbehaved) — report it, don't hand the file over silently.
5. Report the output path(s) and size.

## Rules

- First run downloads ~900MB of BiRefNet weights from the HF Hub. The script auto-loads `HF_TOKEN` from `~/.huggingface/token` when unset — if you still see "unauthenticated requests to the HF Hub", the token file is missing; ask the user, don't fabricate a token.
- Do not "fix" the dtype logic in the script. The model is fp16 on CUDA and promoted to fp32 on CPU/MPS deliberately: the HF checkpoint ships fp16 weights and an fp32 input tensor crashes the first Conv2d with `Input type (float) and bias type (c10::Half) should be the same`.
- CPU is slow (~1–2 min per 1024² frame). For video jobs on this box, prefer `--mode api` (needs HF_TOKEN) or route to a GPU host.
- BiRefNet eats dark props (headphones, straps) against dark backgrounds — if a cutout looks wrong, the fix is a regenerated source image, not a script flag.
- Animated inputs (multi-frame gif/webp) automatically fall back to the video pipeline; single-frame gifs process as images.
- With multiple inputs, `-o` is always a directory. One explicit output file only ever pairs with exactly one input.
- A failing file in multi/batch mode does not stop the rest; check the trailing `[done] N/M file(s) failed` line and surface the failures.

## Tone

Quiet and mechanical. Print paths and sizes, not narration of the forward pass.
