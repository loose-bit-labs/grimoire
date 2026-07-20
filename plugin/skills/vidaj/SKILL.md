---
name: vidaj
description: Use when the user wants to run, resume, stitch, or inspect a vidaj story — the unattended Wan 2.2 i2v story machine at /Users/vgvm/data/project/vidaj. Triggers on "run vidaj", "concept → story", "go nuts", genesis, "stitch the clips", "vidaj report", canon/beats/drift, or Phase 2/3 conductor references for that project.
version: 4
allowed-tools: Bash, Read
---

# VIDAJ — the story machine

THE VIDAJ — iterative Wan 2.2 i2v, concept in → madness out. Observer/scribe/
director LLM agents (thin bash over existing CLIs, no new wheels) carry
continuity between loops so the canon subject doesn't disco-ball away like
`jambone_it.sh` did (see `looped.txt`: subject gone by loop 3).

Repo: `/Users/vgvm/data/project/vidaj`. Full spec: `plans/2026-07-09-vidaj-phase-brief.md`.
Forward plan 1f→2→3: `plans/melodic-swinging-perlis.md`. Conductor brief with
wantan gap callouts: `plans/phase-3-conductor.md`. Roadmap: `ROADMAP.md`.

## Arguments

- A freeform concept line: `"a neon hamster dj at the sickest club"` — triggers
  genesis (Phase 2): LLM invents canon.md + t2i_prompt + opening beat, then
  `grim vision cast 832x480` seed.png on superack, then loops i2v on aid.
- `--go-nuts` — no concept file at all, LLM invents a wild one.
- Or explicit legacy flags: `--canon FILE --image FILE` for pinned canon/seed.
- `--resume DIR`, `--stitch`, `--report` — same as always.

## Instructions

1. `cd /Users/vgvm/data/project/vidaj`.
2. Read ROADMAP.md quick for current phase — Phase 1c deleted re-anchor
   (`_vidaj_reanchor`, `--drift-patience`, `--denoise` ALL GONE); Phase 1d
   switched to mp4-native `wantan-i2v` (no more `webp2mp4.sh`);
   Phase 1e is cache-bust retry with `. N` prompt suffix + `sleep 480`;
   Phase 1f hardened observer/scribe (see below); Phase 2 genesis landed;
   Phase 1g-0 fixed the LLM lane (lbl-config resolution, chonko→meinherz);
   Phase 1g-1 added the collapse guard (`_vidaj_collapsed`, re-anchor to
   last known-good literal frame). **Gate 2 (overnight derelict03 proof
   run) is the current gate — Phase 3 stays briefed-not-built until it
   passes.** Check ROADMAP's latest Gate 2 attempt status before assuming
   Phase 3 work is unblocked.
3. Decide the mode:
   - **New genesis (Phase 2 path — preferred):**
     - `VIDAJ_STUB=1 ./vidaj.sh "a neon hamster dj at the sickest club" --loops 2`
       → NAME slugified from first 4 words + date
       (`a-neon-hamster-dj-0712-0041`), genesis via `prompts/genesis.md` →
       `canon.md` + `opening-beat.txt` + `grim vision cast --width 832
       --height 480 -o seed.png` (Wan native 832x480), seed → loop → clips.
       `concept.txt` holds the real input text.
     - `VIDAJ_STUB=1 ./vidaj.sh --go-nuts --loops 2` → NAME = `MMDD-HHMM-go-nuts`,
       concept.txt = `GO NUTS`, same genesis tail.
   - **New pinned-canon run (legacy, still works):**
     `--canon canon-derelict.md --image derelict03.png --loops 48 --hours 6`
   - **Resume:** `--resume stories/<name>` — picks up after highest
     `clips/clip-NNN.mp4`, frame = matching `frames/frame-NNN.png` or seed.png.
   - **Stitch:** `--resume stories/<name> --stitch` — concats mp4s into
     `vidaj-<name>.mp4` (upsamples if .res marker exists for --res runs).
   - **Report:** `--resume stories/<name> --report` — one line per beat
     `[i] verdict: beat`.
4. Key flags: `--name NAME` (default: slugified concept+date), `--loops N`
   (48) or `--hours H` (wall-clock budget wins), `--seed N` (1331, bumps +1),
   `--history N` (beats shown to director, 4), `--model NAME`
   (Qwen3.6_35B_A3B, used for director/scribe/genesis via llama-server),
   `--res WxH` (generate small, upscale at stitch, test-speed knob),
   `--go-nuts` (invent wild concept), `--stitch`, `--report`,
   `--test-collapse [N]` (Phase 1g-1 stub-only test knob: force
   `_vidaj_collapsed()` to trip N times, default 1; do not use outside
   testing).
   DELETED flags (do not pass — error): `--drift-patience`, `--denoise`.
5. Each loop → `wantan-i2v --image FRAME --prompt PROMPT --seed N --watch
   --out clip-N.mp4` on aid:13031 (mp4-native since Phase 1d). Blocks 7-15 min
   per clip. Two failure detectors run per clip, same retry convention
   (0=flagged, 1=fine — always capture `$?` explicitly, `!`/`||` on these
   is a bash gotcha since bash treats any nonzero as "failure"): (a)
   `_vidaj_fried()` — SATAVG ratio >1.5 flags progressive saturation
   bleed; (b) `_vidaj_collapsed()` (Phase 1g-1, `be5495d`/`80e27e3`) —
   clip size <50% of the run's rolling median (`.clip-sizes`), or
   near-zero SATAVG spread (blank/solid-color frame, the cold-collapse
   signature). Either flag retries once via the existing `". N"` prompt
   cache-buster + `sleep 480` reload wait (Phase 1e). On a **second**
   collapse failure specifically (not fried): re-anchors to the last
   known-good **literal** frame (`frames/frame-(N-1).png` or `seed.png`)
   and the run continues — logged to `beats.jsonl` as
   `{i,ts,stage:"generate",collapsed:true,reanchored_from:PATH}` so the
   dawn report can count recoveries. This is NOT a resurrection of the
   dead `_vidaj_reanchor`/img2img path (Phase 1c killed that for good) —
   just chaining off a prior real frame. A second *fried* (not collapsed)
   failure still falls through to `_vidaj_fail_loop` as before. For
   >1-2 loops, run in bg — don't poll.
6. `VIDAJ_STUB=1` runs instantly with canned LLM/ffmpeg output — use for
   plumbing verification. `bash tests/smoke.sh` now covers Phase 1 explicit
   canon+image path (resume+stitch+report+musak) PLUS Phase 2a bare concept
   + 2b --go-nuts (both 832x480 seed + beats). No `rm -rf` — smoke moves
   stale artifacts to snit/ with timestamp per standing rule never-rm-rf.md.
7. Story state lives in `stories/<name>/` (gitignored, disposable):
   - `canon.md` (genesis-written, immutable downstream)
   - `opening-beat.txt` (genesis's opening sentence)
   - `story-so-far.md` (scribe-owned rolling summary, 150 words max)
   - `beats.jsonl` (append-only `{i,ts,observation,verdict,beat,prompt,seed,clip}`)
   - `concept.txt` (input concept line or GO NUTS)
   - `clips/clip-NNN.mp4`, `frames/frame-NNN.png`, `seed.png` (832x480)
   - `.res`, `.audio` marker files for --res / future --audio
   - `vidaj-<name>.mp4` (stitch output), `vidaj-<name>-scored.mp4` (musak)
8. Observer lane: `describe-image.js --prompt prompts/observer.md FRAME`
   on chonko's ollama (llava:latest = 7B, NOT 13B). Phase 1f hardening:
   explicit anti-franchise clause (never name film/game/TV titles — this
   is NOT a movie still, NOT a game screenshot, NOT fan art), scavenger gear
   + alien megacity anchoring, honest no-human clause. Scribe now discounts
   any film/game titles in OBSERVATION as llava hallucination.
   See ROADMAP Phase 1f notes + `prompts/observer.md`, `prompts/scribe.md`.
9. LLM lane (Phase 1g-0, `f02987a`): `VIDAJ_LLM_URL`/`MUSAK_LLM_URL` resolve
   env var → `jq -r '.endpoints[.use.openai]' ~/.config/lbl-config.json`
   → hardcoded `chonko:11311` fallback if jq/the file/the key are missing.
   Muse1.1 moved text LLM off chonko onto meinherz — live value today is
   `http://meinherz:11311` (`use.openai`/`use.anthropic` both point at
   `mh_llama`). chonko is llava/vision-only now (11434 ollama, no chat
   model). `_vidaj_llm_json`'s success check now explicitly guards against
   empty LLM output before its `jq -e` test — a bare `jq -e` on empty
   stdin exits 0, which used to make a dead LLM endpoint silently pass as
   a successful empty response instead of failing loud. Genesis-path
   fatal errors ("genesis LLM call failed", "grim vision cast failed for
   genesis seed") now echo to stdout too, so `| tee` logs capture *why* a
   run died instead of going 0-byte. **Known follow-up, not yet fixed**:
   `musak.sh:81` has the same empty-input `jq -e` pattern (lower urgency,
   musak runs post-hoc, not mid unattended run). Wantan i2v lives on
   aid:13031; it's the Wan abstraction (driver-over-wantan per user rule —
   when wantan lacks a feature, call it out so it can be added there, don't
   workaround in vidaj). `wantan-s2v` is GGUF lip-sync (face+audio) on
   meinherz:13031, not music/beat full-scene — see phase-3-conductor.md gaps.
10. Phase 3 sketch (briefed, not code yet): `--audio TRACK` → sections.json
    (librosa/essentia boundary+energy) → chapter breaks via fresh
    `grim vision cast 832x480` keyframes per section (fixes drift stagnation,
    pays pacing). `--engine i2v|s2v` dispatch only when full-scene s2v model
    ships on aid — s2v today is lip-sync only, no duck-type. stitch+audio mux
    + musak compat per plan.
11. Seeds outside stories/: `derelict{01,02,03}.png`, `sick01.png` (832x480 Wan
    native since derelict02), `outie/` 11 original PoC clips (832x480 proof).
    Logs go to `logs/` not /tmp.

## Rules

- Lane map (updated Phase 1g-0): aid=Wan video (13031), chonko=llava/vision
  only (11434 ollama, no chat model), meinherz=text LLM via lbl-config
  `use.openai` → `mh_llama` (11311, currently Qwen3.6_35B_A3B-equivalent —
  check `models.default` live, it changes), superack=A1111 (7860). This
  moved once already (Muse1.1) — don't hardcode a host, always resolve
  `VIDAJ_LLM_URL`/`MUSAK_LLM_URL` from live `~/.config/lbl-config.json` at
  runtime with a graceful hardcoded fallback if it's missing/changed shape
  again. Owner flagged the meinherz=NPCs "untouched" convention is now in
  tension with meinherz also serving the LLM lane — unresolved, don't
  paper over it.
- Reuse existing plumbing: thin bash over existing CLIs. No new wheels.
  If a capability is missing, check wantan first — vidaj is driver over wantan,
  the abstraction is "ask Ollama what, ComfyUI how".
- No `rm -rf` EVER in this project (standing rule never-rm-rf.md). If you need
  something gone: `mv ${whatever} snit/${base}-$(date +%s)` or
  `mv ${whatever} delete-me-${base}-$(date +%s)`. User cleans up.
- Never hand-edit `beats.jsonl` or `story-so-far.md` — machine-owned.
- Check ROADMAP.md for phase status — Phase 3 (conductor) is spec-only.
- For wantan gaps (s2v shape today = lip-sync on meinherz not full-scene,
  missing sections emitter, --out=DIR vs FILE): call it out so it can be added
  in wantan, don't monkey-patch inside vidaj — repeat the user's driver rule.

## Tone

Concise, savestate energy. gamer-flavored logs ok in vidaj itself
("reality slipping — casting re-anchor" now gone, keep new style).
No Norse theme. Report real command output, not paraphrases — mage/minion
verify pattern is cmd + pasted output.

