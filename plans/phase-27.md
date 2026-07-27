# Phase 27 — hierophant auto-authority within tracks (escalate-woken, not polling)

**Authority:** hierophant, 2026-07-26. **Repo:** grimoire only. Track I.
**Depends on phases 25–26.** Closes the loop: the top layer answers routine
architecture escalations itself and halts to the user only for genuine decisions.

## Ruling being encoded (user's choice)

The hierophant **auto-decides any architecture/design question inside the existing
roadmap tracks.** It HALTs to the user only for: new scope, a new track, product
direction, or anything touching money/external systems — i.e. exactly the `decision`
halt from phase 25 (`escalate --scope scope|product|external`). Architecture-scoped
escalations are the hierophant's to rule, autonomously.

The hierophant is expensive (opus) and must **not poll.** It is woken only when an
`escalate` lands — the mage's escalate write is the trigger.

## What lands

1. **`hierophant/SKILL.md` autonomous section.** On wake: `grim mm next --role
   hierophant`. If verdict is `ACT` on an `escalate` tagged `architecture` (or untagged →
   default architecture): read the disputed code/briefs, rule concretely, hand down
   `--state direction` pointing at `plans/`, and **return control to the mage loop** (the
   mage's next tick picks up the direction). If verdict is `HALT decision`: print the
   reason + the escalation summary and stop — the user rules new scope. Never run the
   per-phase loop; never implement.

2. **Wake trigger (no polling).** Document the trigger: the mage's autonomous loop, when
   it writes `--state escalate`, prints a `DRIVE: HALT escalate → summon /hierophant`
   line and stops its own loop; the hierophant session is (re-)invoked to handle it, then
   the mage loop resumes. If a lightweight signal file is cheap (e.g. `grim mm write
   --state escalate` touches `.mm/.escalated`), use it so a watching hierophant `/loop`
   can wake on it rather than time-polling — but a mage-printed summons is the acceptance
   bar; the signal file is a nicety, don't block on it.

3. **Authority boundary check in code.** The `scope:` tag from phase 25 is the whole
   boundary — no new judgment code needed. Add one assertion: if a `direction` is written
   in response to an escalation tagged `scope|product|external`, `next` should still have
   HALTed first; guard against the hierophant ruling on something reserved for the user
   (fail loud in `drive` if it sees a `direction` answering a `decision`-halt escalation).

## Out of scope / do NOT

- No change to the rope (still commit-local, no push). No notifier (terminal only).
- Don't make the hierophant poll on a timer — escalate-woken only.
- Don't let the hierophant self-approve product/scope changes — those always HALT to the
  user, even mid-flow.

## Success checks (mage runs these)

- Fixture escalate `--scope architecture` → hierophant path rules + writes `direction`,
  mage loop resumes and briefs from it. No user stop.
- Fixture escalate `--scope product` → `HALT decision`; hierophant refuses to rule, prints
  the summary, stops. The `drive` guard rejects a `direction` written against it.
- End-to-end (throwaway phase): minion raises an architecture `question` the mage can't
  answer → mage escalates `--scope architecture` + stops with a summons → hierophant rules
  → mage resumes → phase accepted, committed locally, not pushed.
- Footprint: `hierophant/SKILL.md`, optional `.mm/.escalated` signal + `drive` guard,
  tests for the guard, KB entity `concept_autopact_hierophant_authority`.

## Track I complete after 27

Autopact done: the loop self-drives, commits locally, and stops only for a decision,
a permission, an empty roadmap, a deadlock, or a budget breach — every one of them a
code verdict, none re-judged per wake.
