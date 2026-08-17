# Phase 72 — Bounty Board: reputation + eligibility (`lib/bounty.js` additions)

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phase 71 accepted (uses its `newBounty`, `claim_history` shape, `lastClaimant`).

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 2** — exact code + tests there.

## What lands

Two pure functions appended to `lib/bounty.js`:
- `deriveReputation(bountyList, hunterId)` → `{claims, accepts, rejects, reclaims, avg_time_to_submit_ms,
  triage_contributions}`, aggregated over every `claim_history` entry for that hunter across the board.
  `reclaims` = entries with `outcome==='expired'`; `avg_time_to_submit_ms` over `outcome==='submitted'`
  (`ended_at - claimed_at`); accepts/rejects credited from a bounty's `review` when the hunter was the
  submitting claimant.
- `nextEligible(bountyList, hunterId, {kind}={})` → highest-priority `OPEN` bounty (P0<P1<P2<P3), optional
  `kind` filter. **Descriptive-only invariant: reputation MUST NOT filter here in v1.**
- Export `PRIORITY_RANK` (reused by the server in 74).

## Footprint

`lib/bounty.js` (additions only), `test/bounty-reputation.test.js`.

## Success checks

- `deriveReputation` counts `claims`/`reclaims` and averages submit time correctly (see plan test).
- `nextEligible` returns the highest-priority OPEN, honors `{kind}`, returns `null` when nothing matches.
- Reputation does **not** influence `nextEligible` (no rep argument, no rep filtering).
- `node --test test/bounty-reputation.test.js` green; full suite still green + self-terminating.

## Out of scope

No reputation-gating of claims/next/review (that's a deferred later phase). No IO.
