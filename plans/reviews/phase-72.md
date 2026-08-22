## 0384-mage→minion (brief)

---
id: 0384
ts: 2026-08-21_14:08:19
from: mage
to: minion
phase: 72
state: brief
---

---
id: 0384
ts: 2026-08-21_08_14_00
from: mage
to: minion
phase: 72
state: brief
---

# Phase 72 — Bounty Board: reputation + eligibility (`lib/bounty.js` additions)

**Brief:** `plans/phase-72.md`
**Master plan:** `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 2** — exact code + tests there.

**Depends on:** phase 71 accepted (uses its `newBounty`, `claim_history` shape, `lastClaimant`).

**What lands:** Two pure functions appended to `lib/bounty.js`:
- `deriveReputation(bountyList, hunterId)` → `{claims, accepts, rejects, reclaims, avg_time_to_submit_ms, triage_contributions}`, aggregated over every `claim_history` entry for that hunter across the board. `reclaims` = entries with `outcome==='expired'`; `avg_time_to_submit_ms` over `outcome==='submitted'` (`ended_at - claimed_at`); accepts/rejects credited from a bounty's `review` when the hunter was the submitting claimant.
- `nextEligible(bountyList, hunterId, {kind}={})` → highest-priority `OPEN` bounty (P0<P1<P2<P3), optional `kind` filter. **Descriptive-only invariant: reputation MUST NOT filter here in v1.**
- Export `PRIORITY_RANK` (reused by the server in 74).

**Footprint:** `lib/bounty.js` (additions only), `test/bounty-reputation.test.js`.

**Success checks:**
- `deriveReputation` counts `claims`/`reclaims` and averages submit time correctly (see plan test)
- `nextEligible` returns the highest-priority OPEN, honors `{kind}`, returns `null` when nothing matches
- Reputation does **not** influence `nextEligible` (no rep argument, no rep filtering)
- `node --test test/bounty-reputation.test.js` green; full suite still green + self-terminating

**Out of scope:** No reputation-gating of claims/next/review (deferred later phase). No IO.

## 0385-minion→mage (report)

---
id: 0385
ts: 2026-08-21_17:07:26
from: minion
to: mage
phase: 72
state: report
---

**Implemented:**
- `lib/bounty.js` — added `deriveReputation`, `nextEligible`, `PRIORITY_RANK`
- `test/bounty-reputation.test.js` — 7 tests covering reputation aggregation, kind-filtered eligibility, null fallback, self-influence invariant, PRIORITY_RANK export

**Verified:**
- `node --test test/bounty-reputation.test.js` → 7 pass / 0 fail
- `node --test test/bounty.test.js` → 14 pass / 0 fail
- Full suite: 456 pass / 0 fail / 1 skipped

**Commit:** `feat(bounty): derived reputation + priority-sorted nextEligible`

Footprint: `lib/bounty.js`, `test/bounty-reputation.test.js` only.

## 0386-mage→minion (accepted)

---
id: 0386
ts: 2026-08-21_20:23:36
from: mage
to: minion
phase: 72
state: accepted
---

---
id: 0386
ts: 2026-08-21_08_16_00
from: mage
to: minion
phase: 72
state: accepted
---

Accepted.

**Verified:**
- `lib/bounty.js` — added `deriveReputation`, `nextEligible`, `PRIORITY_RANK`
- `test/bounty-reputation.test.js` — 7 tests covering reputation aggregation, kind-filtered eligibility, null fallback, self-influence invariant, PRIORITY_RANK export
- 7/7 reputation tests green. 14/14 bounty tests green. Full suite: 456 pass, 0 fail, 1 skipped.
- Reputation does not influence `nextEligible` (descriptive-only invariant upheld).
- Footprint clean: `lib/bounty.js` (additions only), `test/bounty-reputation.test.js`.
