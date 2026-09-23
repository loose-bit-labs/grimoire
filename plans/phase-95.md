# Phase 95 — Jev as an advisory second opinion in review/ruling loops

**Authority:** hierophant, 2026-09-23. **Repo:** grimoire. **Track: TypeSafe Integration.**
**Depends on:** phase 93 (`grim jev` CLI).

## Why

Two review-shaped judgment seams already exist in the pact and already lean on a human/LLM's
unaided read with no second signal:

1. **Mage's bounty/phase review** (`plugin/skills/mage/SKILL.md`, "Judgment" → verify-don't-trust):
   the reviewer re-runs tests and reads the diff, but *whether the pasted evidence actually satisfies
   a specific prose success-check* is still a bare human/LLM judgment call per bullet, with nothing
   to catch a plausible-sounding but thin report.
2. **Hierophant's architecture rulings** (`plugin/skills/hierophant/SKILL.md`, "Judgment"): already
   has real precedent for using Jev this way — the mm role-stamp guard design and the hardware-parts
   schema-depth call both used a Choice/Noul read as one input before ruling. That precedent is not
   yet written into the skill itself, so it isn't consistently reached for.

TypeSafe's own doctrine is explicit that this is exactly its "verify and escalate" use case
(docs.typesafe.ai use-case map: "check specific claims... against evidence; send uncertain or failing
cases to a person or reasoning model") and that a typed judgment "guarantees the interface, not
truth" — it is a second signal to weigh, never a verdict.

## What lands

**`plugin/skills/mage/SKILL.md`** — add to the "Judgment" section, after the verify-don't-trust
bullet: for a report whose evidence for a given success check is thin, ambiguous, or hard to
mechanically re-verify (not for checks you've already directly reproduced — those need no second
opinion), optionally run `grim jev ask` with a `noul` question per such check ("does this pasted
evidence satisfy this specific success check") using the check's exact brief text + the pasted
evidence as `state`. A low-probability or surprising result is a prompt to look harder at *that*
check yourself — **it never substitutes for your own verification and never changes the verdict on
its own.** Record any Jev read used in the acceptance/revise message so the minion and the thread
see it.

**`plugin/skills/hierophant/SKILL.md`** — add to the "Judgment" section: for a genuinely close
architecture call (multiple defensible options, no existing convention or prior ruling settles it),
optionally run `grim jev ask` for a Choice (among the real options) and/or Noul (worth doing at all)
read before ruling — cite it in the direction message as one input among others, the way `.mm/0425`'s
predecessors did informally. **Never reach for it to avoid making the call, and never let it override
direct evidence** (code you've read, a reproduced test result, an existing ROADMAP/brief ruling).

## Footprint

`plugin/skills/mage/SKILL.md`, `plugin/skills/hierophant/SKILL.md`. No engine code.

## Success checks

- Both SKILL.md edits explicitly state: (a) when to reach for Jev, (b) that it's advisory only and
  never overrides direct evidence, (c) that a used read gets cited in the outgoing message so it's
  auditable in `.mm/`.
- Grep both files for "jev" to confirm the addition landed in the right section (not just appended
  at the end).
- No change to the verdict states, escalation mechanics, or `grim mm`/`grim mm drive` behavior —
  this is prose guidance only, not a new gate in code.

## Out of scope

No automatic/blocking gate anywhere (no auto-accept, no auto-escalate on a low Jev score) — both
loops' human/LLM judgment stays the actual decision-maker. No change to `bin/grim-mm*.js` or
`lib/bounty*.js`.
