# Phase 26 — self-driving mage + minion loops (Autopact drive)

**Authority:** hierophant, 2026-07-26. **Repo:** grimoire only. Track I.
**Depends on phase 25** (`grim mm next`). This is the wiring that makes the loop run
itself and stop only on a HALT verdict. Terminal-only notification (user's ruling).

## The rope (binding ruling)

The pact **commits locally after each accepted phase and NEVER pushes.** No deploy, no
router/DNS/ufw, no external/paid call — any brief needing one carries `requires:
permission` and the router HALTs before it. The user releases work by pushing themselves
after reviewing local commits. This is the outer safety boundary; do not widen it.

## What lands

1. **`grim mm drive --role <mage|minion> --session <s>`** — a thin driver command
   (`bin/grim-mm.js` or a small `bin/grim-mm-drive.js` it calls). One tick:
   - run `grim mm next` for the role;
   - `ACT` → **do not implement in code here** — print the legal command + a
     machine-readable `DRIVE: ACT <command>` line the loop skill acts on, and exit 0;
   - `WAIT` → print `DRIVE: WAIT <owner>`, exit 3;
   - `HALT` → print `DRIVE: HALT <reason>` + re-entry command, exit 4.
   `drive` is the deterministic half; the model half (actually reviewing/implementing on
   `ACT`) stays in the mage/minion skills. Keep the mechanics in `drive`.

2. **Loop wiring via the harness `/loop` (dynamic mode).** Document in each of
   `mage/SKILL.md` and `minion/SKILL.md` a short "autonomous mode" section: the session
   runs `/loop` self-paced; each wake → `grim mm drive` → on `ACT` perform the role's
   judgment work (review / implement per the existing skill), write back with `grim mm
   write`, reschedule; on `WAIT` reschedule a longer wakeup; on `HALT` print the reason
   and **stop the loop** (`ScheduleWakeup stop`). No polling tighter than needed — `WAIT`
   reschedules long. State lives in `.mm/` so this survives context compaction: every
   wake re-reads from disk, never from memory.

3. **Budget guard (Rule 6).** The driver accepts `--budget-tokens N`; when the loop
   reports cumulative tokens over budget it passes `--budget-exceeded` to `next`, which
   HALTs `budget`. Wire the flag through; the loop skill owns the counting.

4. **Local-commit discipline.** After a phase is `accepted`, the minion's normal flow
   already commits. Add an explicit check to the mage's accept path in its SKILL "auto"
   section: verify `git log` shows the phase commit and the tree is clean **before**
   archiving — never leave uncommitted work between autonomous phases. Still no push.

## Out of scope / do NOT

- No push, no deploy, no notification channel beyond terminal (Discord/desktop were
  declined). Do not add a notifier.
- Don't collapse mage and minion into one session — the cold-context / verify-don't-trust
  separation is load-bearing. Two sessions, each with its own loop.
- Don't move judgment (review verdicts, implementation) into `drive` — that stays in the
  skills. `drive` only routes.
- No hierophant loop here (phase 27).

## Success checks (mage runs these)

- Dry-run: with the live thread, `grim mm drive --role mage` prints `DRIVE: ACT` + the
  phase-20 legal command, exit 0.
- Simulate a `WAIT` (minion's turn) and a `HALT` (fixture with 3 revises) → correct
  `DRIVE:` line + exit code each.
- Walk one real phase end-to-end in autonomous mode on a throwaway phase: brief → minion
  loop implements + reports → mage loop reviews + accepts → commit present, tree clean,
  **nothing pushed** → next tick either briefs the next queued phase or `HALT
  roadmap-empty`. Paste the transcript of `DRIVE:` lines.
- Kill a loop session mid-phase, re-invoke `/loop` → it re-reads `.mm/` and resumes at the
  right state (compaction-survival proof).
- Footprint: driver code + tests, `mage/SKILL.md`, `minion/SKILL.md` autonomous sections,
  KB entity `system_autopact_drive`.
