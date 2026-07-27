# Phase 25 — `grim mm next`: the deterministic pact router (the stop predicate in code)

**Authority:** hierophant, 2026-07-26. **Repo:** grimoire only. Track I (Autopact).
**Foundation phase** — 26 and 27 depend on it. Pure code + tests; no loop wiring yet,
no deploy. Rule 13: all routing/stop mechanics live here, never in SKILL.md prose.

## Why

The pact already knows whose turn it is (`computeNextMove` in `bin/grim-mm.js`, used by
`status` and `read --json`). Autonomy needs one more thing: a single command that tells a
self-driving session **act / wait / halt-for-human**, with the halt reasons decided by
code, not re-judged by the model each wake.

## What lands

1. **`grim mm next --role <r> --session <s>`** — new verb in `bin/grim-mm.js`. Reuses
   `computeNextMove`; adds the halt predicate; prints one verdict + sets an exit code:
   - `ACT` (exit 0) — this role should act now. Print the exact legal command / brief
     file (same string `read`'s footer already produces).
   - `WAIT` (exit 3) — not this role's turn, nothing halting. Print whose turn it is.
   - `HALT <reason>` (exit 4) — human input required. Print the reason + the re-entry
     command the user runs to resume (`grim mm read --role <r> ...`).
   - `--json` emits `{verdict, reason?, command, owner, phase, state}`.

2. **The HALT predicate (all in code, evaluated in this order):**
   | reason | fires when |
   |---|---|
   | `budget` | (stub hook now — a `--budget-exceeded` flag the caller passes; real accounting is the loop's job in phase 26). Wire the branch, default off. |
   | `deadlock` | the current phase has ≥ **3** `revise` messages in the thread (thrash guard). Count from `readThread`. |
   | `decision` | latest is `escalate` **and** its body's first line carries a `scope:` tag of `scope`/`product`/`external` (see #3). Architecture escalations without that tag are **not** a halt — they route to the hierophant as `ACT`. |
   | `permission` | the next brief to be worked carries `requires: permission` in its header (see #4) — an outward/irreversible action (deploy, router/DNS, ufw, external/paid API). Per the standing rope ruling the pact **commits locally but never pushes**, so push is simply not a pact power and needs no per-phase tag. |
   | `roadmap-empty` | latest is `accepted` (or archived) **and** no next phase is queued in `plans/ROADMAP.md` — nothing left to brief. |

   If none fire → fall through to the existing `computeNextMove` result mapped to
   `ACT`/`WAIT`.

3. **Escalate scope tag.** `grim mm write --state escalate` gains an optional
   `--scope architecture|scope|product|external` (default `architecture`). Stored as a
   `scope:` line in the message header next to `phase:`/`state:`. `next` reads it to
   decide `decision`-halt vs. route-to-hierophant. Update `parseHeader` to carry it.

4. **Brief permission tag.** `plans/phase-*.md` may declare `requires: permission` in a
   header line; add a tiny reader (`briefRequiresPermission(phase)`) that greps the brief
   file. Document the convention at the top of ROADMAP's acceptance bar.

5. **Roadmap phase-queue reader.** `nextQueuedPhase()` parses `plans/ROADMAP.md`'s phase
   tables for the lowest-numbered row whose Status is not `✅ accepted` and not archived —
   that's "is there work left." Deterministic string parse, no model.

## Out of scope / do NOT

- No `/loop` wiring, no wakeups, no notifications — that's phase 26.
- No hierophant auto-answer logic — phase 27.
- Don't change `computeNextMove`'s existing output shape (status/read depend on it);
  `next` *wraps* it.
- No new deps. No network calls.

## Success checks (mage runs these, pastes output)

- On the current live thread: `grim mm next --role mage --session x` → `ACT` exit 0 with
  the mage's legal command (phase 20 report is waiting on the mage).
- Fabricate a fixture thread (temp dir, `GRIM_MM_DIR` or `--dir` if supported) with 3
  `revise` on one phase → `HALT deadlock` exit 4.
- Fixture: latest `escalate --scope product` → `HALT decision`. Same but `--scope
  architecture` → `ACT` for hierophant (route up, no halt).
- Fixture: latest `accepted`, ROADMAP has a queued row → `ACT` (archive-then-brief).
  Remove the queued row → `HALT roadmap-empty`.
- A brief tagged `requires: permission` as next → `HALT permission`.
- `--json` shape validated for each verdict.
- Footprint: `bin/grim-mm.js`, tests, ROADMAP acceptance-bar note. KB entity
  `concept_autopact_router` describing the three-valued verdict + halt table.
