# Phase 71 — Bounty Board core: pure state machine (`lib/bounty.js`)

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** nothing (pure, no IO — start here). First of 7 (71–77).

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 1** — follow its numbered
TDD steps; the exact code + test cases live there. Spec: `docs/superpowers/specs/2026-08-15-grim-bounty-board-design.md`.

## What lands

`lib/bounty.js` — the pure, IO-free heart of the board. Time is always passed in as `nowMs`; never call
`Date.now()` inside these functions (deterministic tests). Implements:
- Model + constants: `STATES, KINDS, TIMING` (`phase{beat:300,ttl:1800}`, `task|bug{beat:120,ttl:480}` seconds),
  `POISON_ATTEMPTS=3`, `newBounty(...)`, `ttlFor(kind)`, `legalTransition(state,event)`, `class ConflictError` (`.code='CONFLICT'`).
- Transitions: `applyClaim` (epoch = maxEpoch+1, opens `claim_history`), `applyHeartbeat` (renews `expires_at`,
  records `wip_ref`; rejects state/owner/epoch mismatch), `applySubmit` (→NEEDS_REVIEW), `applyRelease` (→OPEN),
  `applyExpire` (only if `CLAIMED && now>=expires_at` → OPEN, `attempts++`; at `attempts>=3` → **NEEDS_TRIAGE**),
  `applyReview` (accept→ACCEPTED; reject→OPEN+attempts++; **reviewer must ≠ last claimant**).

## Footprint (do not exceed)

`lib/bounty.js`, `test/bounty.test.js`. Nothing else.

## Success checks (report must speak to each by name — Rule 12)

- `newBounty` → OPEN, `attempts:0`, empty `claim_history`, `lease:null`.
- Fencing: `applyHeartbeat`/`applySubmit`/`applyRelease` throw `ConflictError` on stale epoch **or** non-owner.
- `applyClaim` on non-OPEN throws `ConflictError`.
- Poison: three claim→expire cycles ⇒ `state==='NEEDS_TRIAGE'`, `attempts===3` (NOT OPEN).
- No self-approval: `applyReview` with `reviewerId === lastClaimant` throws `ConflictError`.
- `applyExpire` before `expires_at` is a no-op (state stays CLAIMED, attempts unchanged).
- `node --test test/bounty.test.js` green; suite self-terminates.

## Out of scope

No persistence, no server, no CLI (those are 73/74/76). No reputation yet (that's 72). Pure functions only.
