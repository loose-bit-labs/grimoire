# Phase 92 — KB Capture Quality II: archaeology that extracts mechanism, not trivia

**Authority:** hierophant, 2026-09-16. **Repo:** grimoire. **Track: KB Capture Quality.**
**Depends on:** nothing hard; pairs with phase 91 (same Track, same disease deeper).

## Why (the evidence)

Pointed at several repos of weird, valuable code, `grim archaeologist` produced entities of the shape
*"project X uses a mix of C and C++."* Language-mix trivia, not the load-bearing knowledge — the whole point
of cataloging a repo is to capture what's **non-obvious and reusable**: the clever mechanism, the surprising
API, the leverage point, the gotcha. The synthesis is shallow.

Pipeline: `bin/grim-archaeologist.js` Phase 3 synthesis runs a local model over the walk and writes
`archaeology/{slug}/final.md`; then the `/archaeologist` skill (Claude) reads `final.md` and writes KB
entities. The shallowness is in **the synthesis prompt + what final.md is asked to contain**, and in the
KB-pass accepting a vibe summary as an entity.

## What lands

**A. Synthesis prompt targets mechanism.** The Phase-3 prompt (the doc that becomes `final.md`) must extract,
per repo: the **non-obvious mechanisms** (how the clever part actually works), **notable APIs / entrypoints**,
**reusable patterns**, **leverage points**, and **gotchas/surprises** — with file:symbol anchors. Explicitly
instruct it to *skip* generic facts (language mix, dependency list, LOC) unless load-bearing. "What would a
sharp engineer want to remember about this repo a year from now?" is the bar.

**B. final.md has a required "Salient Findings" section** — a bulleted list of concrete, anchored findings
(each: claim + `path:symbol`). Empty/generic → the dig is flagged incomplete, not silently accepted.

**C. KB-pass rejects vibe entities.** The `/archaeologist` skill guidance: an entity whose description is a
generic summary ("uses a mix of C and C++", "a web app that does X") is not KB-worthy — capture the specific
findings from Salient Findings instead, one entity per genuinely-notable mechanism/pattern, related to the
project entity.

## Footprint

`bin/grim-archaeologist.js` (Phase-3 synthesis prompt + final.md template + "Salient Findings" gate),
`plugin/skills/archaeologist/SKILL.md` (KB-pass quality bar), a synthesis fixture test if feasible.

## Success checks

- Re-dig one of the "weird valuable" repos → `final.md` has a non-empty **Salient Findings** section with
  ≥3 anchored, specific findings (not language/LOC/dep trivia).
- The KB-pass produces entities describing *mechanisms/patterns*, none whose description is a generic
  language/stack summary.
- A repo with genuinely nothing notable → an honest "no salient findings" (fail loud, Rule 12), not a
  fabricated summary.
- Full suite green + self-terminating.

## Out of scope

Ingest/research capture (phase 91). Re-cataloging every past dig — this fixes the pipeline; re-digs are
on-demand.
