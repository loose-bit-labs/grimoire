## 0126-hierophant (direction)

phase: 25 · state: direction

# Direction — Track I (Autopact): the pact runs itself, stops only on a code verdict

New track, phases 25–27. ROADMAP updated; briefs `plans/phase-25.md`…`phase-27.md`.
This is orthogonal to the queued Track F/G items — sequence it after they clear, or pull
25 forward, mage's call. Nothing here blocks the current phase-20 loop.

**Decision.** The loop self-drives. `grim mm status`/`computeNextMove` already knows whose
turn it is; Autopact adds `grim mm next` — a **three-valued router in code**
(`ACT`/`WAIT`/`HALT <reason>`, exit 0/3/4) — and a `/loop` driver per role. The model is
spent only on the judgment seams (review, implement, rule); routing and the stop predicate
are code (Rule 13), never re-derived per wake. State lives in `.mm/` so it survives
compaction — every wake re-reads from disk.

**Rope (binding, from the user).** The pact **commits locally after each accepted phase
and never pushes.** Deploy, router/DNS, ufw, external/paid actions are outside the rope:
their brief carries `requires: permission` and the router HALTs before them. The user
releases work by pushing after reviewing local commits.

**Stop predicate — the only reasons the whole system halts to the user**, all decided in
code (phase 25 table): `budget` · `deadlock` (≥3 revises on a phase) · `decision`
(escalate tagged scope/product/external) · `permission` (brief requires an outward action)
· `roadmap-empty`. Everything else — brief→report→revise→accepted→archive→next-brief, and
**architecture escalations within existing tracks** — flows without stopping.

**Hierophant authority (from the user).** Auto-decide any architecture inside the existing
roadmap tracks; HALT to the user only for new scope, new track, product direction, or
money/external. Hierophant is escalate-woken, never polling.

**Notification (from the user): terminal only.** A halted session prints the reason + the
re-entry command and stops. No Discord, no desktop push — do not add a notifier.

**Sequence & footprint.** 25 first (pure code + tests, no wiring). 26 wires the mage+minion
loops. 27 wires the hierophant. Each lands independently, grimoire repo only, no new deps.
Hold the footprint exactly as each brief declares; run every success check yourself.

**Next actor: mage.** Finish the phase-20 verdict, then brief phase 25.

## 0127-mage (accepted)

phase: 25 · state: accepted

Phase 20 accepted. 16/16 tests pass. Code review passed: plist structure, templating, launchd unload+load, systemd unchanged. Acceptance requires plink verification — please test on plink.

## 0132-mage (brief)

phase: 25 · state: brief

Phase 25 briefed — plans/phase-25.md. Track I (Autopact) foundation. Scope: grim mm next — deterministic pact router (ACT/WAIT/HALT with exit codes). Halt predicates: budget (stub), deadlock (≥3 revises), decision (escalate scope tag), permission (brief header), roadmap-empty. Also: escalate --scope flag, brief permission tag reader, roadmap phase-queue reader. Pure code + tests, no loop wiring. See brief.

## 0133-minion (report)

phase: 25 · state: report
Phase 25 implemented. 184/184 tests pass (8 new + 176 existing).

## What landed

1. **`bin/grim-mm.js`** — New `next` verb:
   - `grim mm next --role <r> --session <s>` → ACT (exit 0) / WAIT (exit 3) / HALT <reason> (exit 4)
   - Halt predicates: budget (stub), deadlock (≥3 revises), decision (escalate scope:scope/product/external), permission (brief header), roadmap-empty
   - Architecture-escalate routes to hierophant (ACT, not HALT)
   - `--json` emits {verdict, reason?, command, owner, phase, state}
   - `--scope` flag on `grim mm write --state escalate`
   - `parseHeader` now extracts scope from header block
   - `briefRequiresPermission()` + `nextQueuedPhase()` helpers

2. **`test/grim-mm-next.test.js`** — 8 tests covering all verdicts and halt reasons

3. **`plans/ROADMAP.md`** — Acceptance bar note about `requires: permission`

4. **KB** — `concept_autopact_router` (DefinedTerm, works_on project_grimoire)

## Mage verification needed

- `grim mm next --role mage --session "$CLAUDE_CODE_SESSION_ID"` → ACT with legal command
- `grim mm write --role mage --state escalate --scope product --file /dev/stdin` → header includes `scope: product`
- `grim mm next --role mage --session "$CLAUDE_CODE_SESSION_ID" --json` → valid JSON shape

Commit: `6e5d838`

## 0134-mage (escalate)

phase: 25 · state: escalate
scope: product
test escalation with scope

## 0135-mage (accepted)

phase: 25 · state: accepted
Accepted. All 8 tests pass. Verification checks confirmed: next ACT verdict, scope header parsing, JSON shape all correct. Clean scope — no out-of-bounds edits. Archive and brief phase 26.
