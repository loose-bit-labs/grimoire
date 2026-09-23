# Phase 94 — Spellwright: Jev-assisted spell-worthy gate

**Authority:** hierophant, 2026-09-23. **Repo:** grimoire. **Track: TypeSafe Integration.**
**Depends on:** phase 93 (`grim jev` CLI).

## Why

Spellwright's Phase-1/3 "is this spell-worthy?" call (`plugin/skills/spellwright/SKILL.md`) is
currently a subjective judgment made fresh each invocation by whatever model is running the skill —
no record of *why* something was skipped survives beyond the session's prose report, and the bar
("would take >30s to remember how to invoke," "chains a specific sequence," "used across multiple
projects") is applied inconsistently across sessions/models. This session's own spellwright pass
(2026-09-20, three candidates, all skipped) reasoned through the bar in prose with no calibrated,
auditable number attached — exactly the gap a Noul judgment fills, and exactly the kind of semantic
classification Rule 5 sanctions the model for (not routing, not a deterministic transform).

## What lands

Edit `plugin/skills/spellwright/SKILL.md` Phase 1/3 (Inventory / Draft) to add, for each candidate
that isn't an obvious skip (a one-liner) or an obvious forge (the user explicitly asked): run
`grim jev ask` with a `state` describing the candidate (what it does, how it'd be invoked, whether it
chains steps) and the skill's own three bar criteria as `criteria` on a single `noul` question
("is this spell-worthy per the stated bar"), then record the returned probability in the Phase 5
report next to the verdict — e.g. `SKIPPED: 3 (below the spell-worthy bar; jev: 0.08/0.11/0.14)`.
**Advisory only — the skill's own judgment still rules.** A low Jev probability is not itself
sufficient to skip, and a high one is not itself sufficient to forge; if the skill's reasoning and
Jev's read disagree, say so explicitly in the report (Rule 7 — surface conflicts, don't average them)
rather than silently picking one.

## Footprint

`plugin/skills/spellwright/SKILL.md` only. No engine code — this phase wires an existing CLI (93)
into an existing skill's prose instructions.

## Success checks

- SKILL.md's Phase 1/3 section explicitly instructs invoking `grim jev ask` with a `noul` question
  per non-obvious candidate, and names what goes in `state` vs `criteria`.
- SKILL.md's Phase 5 report template is updated to include the Jev probability alongside each
  verdict.
- SKILL.md explicitly states the read is advisory (does not auto-decide) and the Rule-7
  disagreement-surfacing requirement.
- Dry-run demonstration: re-run spellwright against a synthetic small candidate set (can reuse this
  session's own three prior candidates as fixtures) and paste the real Jev responses + the resulting
  report line.

## Out of scope

No change to the forge/register mechanics (Phase 2/4 of the skill) — only the worth-it judgment in
Phase 1/3 and its reporting in Phase 5. No engine code.
