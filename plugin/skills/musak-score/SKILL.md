---
name: musak-score
description: Use when the user wants to add a post-production score (procedural backing track + beat-synced spoken one-liners) to an already-stitched vidaj story, or mentions "score the story", "musak.sh", or "post-run score" for vidaj. Different from /grimoire:musak (that one is the raw music_maker.py synth) — this wraps the orchestrator that layers dialogue + music onto a finished video.
version: 0.1.0
allowed-tools: [Bash]
---

# MUSAK-SCORE — vidaj post-run score orchestrator

You know `musak.sh` — a standalone bash orchestrator, sibling to `vidaj.sh`, that layers a procedural backing track and a handful of LLM-written, TTS-voiced one-liners onto an **already-stitched** vidaj story. It's pure post-production: it never touches the live generation loop, and it's always run manually after the fact.

Canonical copy: `/Users/vgvm/data/project/vidaj/musak.sh`.

## What it chains

1. **Dialogue plan** — sends `canon.md` + `story-so-far.md` + `beats.jsonl` to an LLM (`prompts/dialogue-plan.md` as system prompt) and expects a JSON array of `{beat, line}` back.
2. **TTS** — each line goes to Piper (`aid:5000`) and becomes a WAV, positioned in the mix by looking up that beat's 0-indexed position among the sorted/deduped/non-failed beats (5s per beat slot).
3. **Backing track** — `musak/music_maker.py` (the `/grimoire:musak` synth) renders a track matching the stitched video's duration (floored to 2s minimum).
4. **Mix** — `ffmpeg` combines video + backing track (ducked to 0.35 volume) + delayed dialogue WAVs into `<name>-scored.mp4`.

Any single piece failing (dialogue plan, one TTS line) degrades gracefully — it falls back to music-only or skips that line, logging to stderr. Only `music_maker.py` failing is fatal.

## Arguments

Whatever the user gives: a story dir, optionally style/bpm/key/voice overrides.

## Invocation

```bash
cd /Users/vgvm/data/project/vidaj
./musak.sh stories/<name> \
  [--style cute|disco|cute-disco] \  # default cute-disco
  [--bpm N] \                        # default 120
  [--key C] \                        # default C
  [--voice en_US-amy-medium]         # default en_US-amy-medium
```

- **Precondition**: `stories/<name>/vidaj-<name>.mp4` must already exist — i.e. `vidaj.sh --resume stories/<name> --stitch` has run. If it hasn't, `musak.sh` exits 1 with a clear message rather than guessing.
- **Output**: `stories/<name>/vidaj-<name>-scored.mp4`.
- **Dry run**: `MUSAK_STUB=1 ./musak.sh stories/<name>` — skips the real LLM/TTS calls (canned two-line dialogue plan, silent 1s WAVs) so you can verify plumbing without hitting any network service.

## Environment overrides

- `MUSAK_LLM_URL` (default `http://chonko:11311/v1/chat/completions`)
- `MUSAK_MODEL` (default `Qwen3.6_35B_A3B`)
- `MUSAK_TTS_URL` (default `http://aid:5000/`)

These are hardcoded defaults, not resolved from KB infra config — same convention as `vidaj.sh` itself (see `/grimoire:vidaj`'s "Portability" note): this is a project-specific orchestrator with a fixed lane map, not a general infra client. Override via env var if the lane map changes.

## Rules

- Never run this before `--stitch` — there's no video to score yet.
- Don't hand-edit the intermediate files it creates in its `mktemp -d` tmp dir; it cleans up after itself on both success and failure paths.
- If the dialogue plan LLM call fails or returns non-JSON, that's expected-and-handled, not a bug — report it as "scored music-only, dialogue plan failed" rather than treating it as an error to fix.
- This script is the orchestration layer that `/grimoire:musak`'s own SKILL.md explicitly says doesn't belong bolted onto `music_maker.py` — don't suggest merging them.

## Tone

Same register as `/grimoire:vidaj`: report real command output, not paraphrases. This is a short-lived post-production pass (LLM call + a few TTS calls + one ffmpeg mux), not a long-running loop — no need to background it or warn about polling.
