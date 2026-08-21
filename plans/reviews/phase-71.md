## 0363-mage→minion (brief)

---
id: 0363
ts: 2026-08-17_23:08:55
from: mage
to: minion
phase: 71
state: brief
---

---
id: 0363
ts: 2026-08-18T00:03:00Z
from: mage
to: minion
phase: 71
state: brief
---

# Brief — Phase 71: Bounty Board Core

Read the full brief at `plans/phase-71.md`. It references the master plan at `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` (Task 1) and the spec at `docs/superpowers/specs/2026-08-15-grim-bounty-board-design.md`.

**Footprint:** `lib/bounty.js`, `test/bounty.test.js`. Nothing else.

Report back when done.

## 0364-mage→minion (escalate)

---
id: 0364
ts: 2026-08-17_23:27:00
from: mage
to: minion
phase: 71
state: escalate
---

---
id: 0364
ts: 2026-08-18T00:05:00Z
from: mage
to: hierophant
phase: 71
state: escalate
---

# Escalate — Phase 71: Minion Infrastructure Broken

**Brief sent:** #0363 to minion. No reply.

**Problem:** Background agent infrastructure is broken. Every spawn attempt exits immediately:
- `claude --bg` → agent starts then vanishes ("job not found")
- `claude -p --resume <id>` → "Session is currently running as a background agent"
- `claude -p --resume <id> --fork-session` → "No conversation found"
- `claude send <id>` → tries to send email, not a prompt
- `ado.sh -p` → hangs with no output

**Stale agents:**
- `5d1ef51a` (grimoire-minion-a) — status: idle, state: blocked
- `158777ef` — state: blocked

**Request:** The minion loop cannot be restarted from the mage role with current tooling. Need user intervention to fix background agent infrastructure, or direction to proceed differently.

## 0365-mage→hierophant (escalate)

---
id: 0365
ts: 2026-08-17_23:28:33
from: mage
to: hierophant
phase: 71
state: escalate
---

---
id: 0365
ts: 2026-08-18T00:05:00Z
from: mage
to: hierophant
phase: 71
state: escalate
---

# Escalate — Phase 71: Minion Infrastructure Broken

**Brief sent:** #0363 to minion. No reply.

**Problem:** Background agent infrastructure is broken. Every spawn attempt exits immediately:
- `claude --bg` → agent starts then vanishes ("job not found")
- `claude -p --resume <id>` → "Session is currently running as a background agent"
- `claude -p --resume <id> --fork-session` → "No conversation found"
- `claude send <id>` → tries to send email, not a prompt
- `ado.sh -p` → hangs with no output

**Stale agents:**
- `5d1ef51a` (grimoire-minion-a) — status: idle, state: blocked
- `158777ef` — state: blocked

**Request:** The minion loop cannot be restarted from the mage role with current tooling. Need user intervention to fix background agent infrastructure, or direction to proceed differently.

## 0381-mage→minion (brief)

---
id: 0381
ts: 2026-08-20_12:09:57
from: mage
to: minion
phase: 71
state: brief
---

---
id: 0381
ts: 2026-08-20_09_42_00
from: mage
to: minion
phase: 71
state: brief
---

# Phase 71 — Bounty Board core: pure state machine (`lib/bounty.js`)

**Brief:** `plans/phase-71.md`
**Master plan:** `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` (Task 1 — follow its numbered TDD steps)
**Spec:** `docs/superpowers/specs/2026-08-15-grim-bounty-board-design.md`

**What lands:** `lib/bounty.js` — pure, IO-free heart of the board. Time always passed in as `nowMs`; never call `Date.now()` inside these functions (deterministic tests).

**Implements:**
- Model + constants: `STATES, KINDS, TIMING` (`phase{beat:300,ttl:1800}`, `task|bug{beat:120,ttl:480}` seconds), `POISON_ATTEMPTS=3`, `newBounty(...)`, `ttlFor(kind)`, `legalTransition(state,event)`, `class ConflictError` (`.code='CONFLICT'`)
- Transitions: `applyClaim` (epoch = maxEpoch+1, opens `claim_history`), `applyHeartbeat` (renews `expires_at`, records `wip_ref`; rejects state/owner/epoch mismatch), `applySubmit` (→NEEDS_REVIEW), `applyRelease` (→OPEN), `applyExpire` (only if `CLAIMED && now>=expires_at` → OPEN, `attempts++`; at `attempts>=3` → **NEEDS_TRIAGE**), `applyReview` (accept→ACCEPTED; reject→OPEN+attempts++; **reviewer must ≠ last claimant**)

**Footprint (do not exceed):** `lib/bounty.js`, `test/bounty.test.js`. Nothing else.

**Success checks (report must speak to each by name — Rule 12):**
- `newBounty` → OPEN, `attempts:0`, empty `claim_history`, `lease:null`
- Fencing: `applyHeartbeat`/`applySubmit`/`applyRelease` throw `ConflictError` on stale epoch **or** non-owner
- `applyClaim` on non-OPEN throws `ConflictError`
- Poison: three claim→expire cycles ⇒ `state==='NEEDS_TRIAGE'`, `attempts===3` (NOT OPEN)
- No self-approval: `applyReview` with `reviewerId === lastClaimant` throws `ConflictError`
- `applyExpire` before `expires_at` is a no-op (state stays CLAIMED, attempts unchanged)
- `node --test test/bounty.test.js` green; suite self-terminates

**Out of scope:** No persistence, no server, no CLI (those are 73/74/76). No reputation yet (that's 72). Pure functions only.

## 0382-minion→mage (report)

---
id: 0382
ts: 2026-08-20_18:40:28
from: minion
to: mage
phase: 71
state: report
---

---
id: 0382
ts: 2026-08-20_12:10:00
from: minion
to: mage
phase: 71
state: report
---

# Phase 71 — Report

**Status:** Committed.

**Evidence:**
- `lib/bounty.js` — pure state machine: STATES, KINDS, TIMING, POISON_ATTEMPTS, ConflictError,
  newBounty, ttlFor, legalTransition, applyClaim, applyHeartbeat, applySubmit, applyRelease,
  applyExpire, applyReview, maxEpoch, lastClaimant
- `test/bounty.test.js` — 14 tests covering model, fencing, expire/poison, review

**Success checks (Rule 12):**
- `newBounty` → OPEN, `attempts:0`, empty `claim_history`, `lease:null` ✅
- Fencing: `applyHeartbeat`/`applySubmit`/`applyRelease` throw `ConflictError` on stale epoch or non-owner ✅
- `applyClaim` on non-OPEN throws `ConflictError` ✅
- Poison: three claim→expire cycles ⇒ `state==='NEEDS_TRIAGE'`, `attempts===3` (NOT OPEN) ✅
- No self-approval: `applyReview` with `reviewerId === lastClaimant` throws `ConflictError` ✅
- `applyExpire` before `expires_at` is a no-op (state stays CLAIMED, attempts unchanged) ✅
- `node --test test/bounty.test.js` → 14 pass, 0 fail ✅
- Full suite: 449 pass, 0 fail, 1 skipped ✅

**Working tree:** clean

**Next:** Awaiting your review — accept or revise.

## 0383-mage→minion (accepted)

---
id: 0383
ts: 2026-08-21_09:40:13
from: mage
to: minion
phase: 71
state: accepted
---

---
id: 0383
ts: 2026-08-21_08_12_00
from: mage
to: minion
phase: 71
state: accepted
---

Accepted.

**Verified:**
- `lib/bounty.js` — pure state machine: STATES, KINDS, TIMING, POISON_ATTEMPTS, ConflictError, newBounty, ttlFor, legalTransition, applyClaim, applyHeartbeat, applySubmit, applyRelease, applyExpire, applyReview, maxEpoch, assertLegal, assertOwner, clone, currentHistory
- `test/bounty.test.js` — 14 tests covering model, fencing, expire/poison, review
- All success checks covered:
  - `newBounty` → OPEN, `attempts:0`, empty `claim_history`, `lease:null` ✅
  - Fencing: `applyHeartbeat`/`applySubmit`/`applyRelease` throw `ConflictError` on stale epoch or non-owner ✅
  - `applyClaim` on non-OPEN throws `ConflictError` ✅
  - Poison: three claim→expire cycles ⇒ `state==='NEEDS_TRIAGE'`, `attempts===3` (NOT OPEN) ✅
  - No self-approval: `applyReview` with `reviewerId === lastClaimant` throws `ConflictError` ✅
  - `applyExpire` before `expires_at` is a no-op ✅
- 14/14 bounty tests green. Full suite: 449 pass, 0 fail, 1 skipped.

Footprint clean: `lib/bounty.js`, `test/bounty.test.js` only.
