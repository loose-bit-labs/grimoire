---
name: musak
description: Use when the user wants a quick procedural background track — cute glockenspiel loop, disco groove, or a cute-to-disco hybrid — without any external music-gen service. Good for placeholder scores, silly video backing tracks, or filling audio gaps in a generated-video pipeline.
version: 0.1.0
allowed-tools: [Bash]
---

# MUSAK — Procedural Cute/Disco Music Generator

You know `music_maker.py` — a self-contained, pure-numpy WAV synthesizer. No network, no GPU, no external service. It runs anywhere Python 3 + numpy exist, in well under a second for typical durations.

Canonical copy: `musak/music_maker.py` in the `vidaj` project (`/Users/vgvm/data/project/vidaj/musak/music_maker.py`). It's a standalone script with no vidaj-specific dependencies — safe to copy into any project that wants a quick procedural track.

## Arguments

Whatever the user describes: mood (cute / disco / hybrid), tempo, length, key. Translate loosely into flags.

## Invocation

```bash
python3 musak/music_maker.py \
  --style cute|disco|cute-disco \
  --bpm <80-160> \
  --duration <seconds> \
  --key <C,C#,Db,D,Eb,E,F,F#,G,Ab,A,Bb,B> \
  --scale major|minor \
  [--sparkle] [--kick] [--kick_vol 0.0-1.5] \
  --output out.wav
```

Only hard dependency: `numpy` (`pip install numpy` if missing — no other setup).

## Style guide

- `cute` — glockenspiel arpeggio, optional light `--kick`. Good for playful/whimsical scenes.
- `disco` — kick/snare/hihat groove + bass + chord stabs; add `--sparkle` for high chime accents on the 1 and 5.
- `cute-disco` — first half of the duration is `cute`, second half is `disco` (hard cut at the midpoint, not a crossfade — don't expect a smooth blend).

`--scale minor` changes the whole chord progression, not just the melody — use it for a moodier variant of either style.

## Rules

- Don't invent flags that aren't in the arg list above — check `python3 music_maker.py --help` if unsure, the script is short enough to read directly.
- Mono 44.1kHz WAV output only — if the caller needs stereo or another format, pipe through `ffmpeg` afterward rather than modifying the generator.
- If asked for something outside cute/disco (e.g. "moody ambient"), say so — this tool is scoped to those two styles and their hybrid, not a general music generator.
- This script has no notion of a story, video, or timeline — if the caller wants beat-synced or narrative-aware audio, that's an orchestration layer on top, not something to bolt onto `music_maker.py` itself. See `/grimoire:musak-score`, which wraps `vidaj`'s `musak.sh` — the concrete implementation of that orchestration layer (LLM dialogue plan + Piper TTS + this synth + ffmpeg mix, run after `vidaj.sh --stitch`).

## Tone

Cheerful and quick — this is a toy synth, not a production tool. Get a WAV file out fast, don't overthink the sound design.
