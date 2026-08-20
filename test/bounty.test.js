'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const B = require('../lib/bounty')

describe('bounty model + timing', () => {
  it('newBounty defaults to OPEN with empty history and attempts 0', () => {
    const b = B.newBounty({ id: 'b1', kind: 'phase', repo: 'grimoire', priority: 'P1', title: 't', body_path: 'plans/phase-70.md', phase_tag: '70', size: 'M' })
    assert.equal(b.state, 'OPEN')
    assert.equal(b.attempts, 0)
    assert.deepEqual(b.claim_history, [])
    assert.equal(b.lease, null)
  })
  it('ttlFor returns per-kind seconds', () => {
    assert.deepEqual(B.ttlFor('phase'), { beat: 300, ttl: 1800 })
    assert.deepEqual(B.ttlFor('task'), { beat: 120, ttl: 480 })
  })
  it('legalTransition allows claim from OPEN, rejects submit from OPEN', () => {
    assert.equal(B.legalTransition('OPEN', 'claim'), true)
    assert.equal(B.legalTransition('OPEN', 'submit'), false)
    assert.equal(B.legalTransition('CLAIMED', 'heartbeat'), true)
    assert.equal(B.legalTransition('NEEDS_REVIEW', 'accept'), true)
  })
})

describe('claim lifecycle + fencing', () => {
  const base = () => B.newBounty({ id: 'b1', kind: 'phase', repo: 'grimoire', priority: 'P1', title: 't', body_path: 'plans/phase-70.md', phase_tag: '70', size: 'M' })
  const T0 = 1_000_000

  it('applyClaim sets CLAIMED, epoch 1, expires_at = now + ttl*1000, opens history', () => {
    const b = B.applyClaim(base(), 'hunter-A', T0)
    assert.equal(b.state, 'CLAIMED')
    assert.equal(b.lease.owner, 'hunter-A')
    assert.equal(b.lease.lease_epoch, 1)
    assert.equal(b.lease.expires_at, T0 + 1800 * 1000)
    assert.equal(b.claim_history.length, 1)
    assert.equal(b.claim_history[0].outcome, null) // still open
    assert.equal(b.claim_history[0].epoch, 1)
  })
  it('applyClaim on non-OPEN throws ConflictError', () => {
    const claimed = B.applyClaim(base(), 'hunter-A', T0)
    assert.throws(() => B.applyClaim(claimed, 'hunter-B', T0), { code: 'CONFLICT' })
  })
  it('applyHeartbeat renews expires_at and records wip_ref; rejects stale epoch', () => {
    const b = B.applyClaim(base(), 'hunter-A', T0)
    const beat = B.applyHeartbeat(b, 'hunter-A', 1, T0 + 60_000, 'abc123')
    assert.equal(beat.lease.expires_at, T0 + 60_000 + 1800 * 1000)
    assert.equal(beat.lease.wip_ref, 'abc123')
    assert.throws(() => B.applyHeartbeat(b, 'hunter-A', 99, T0 + 60_000, 'x'), { code: 'CONFLICT' })
    assert.throws(() => B.applyHeartbeat(b, 'other', 1, T0 + 60_000, 'x'), { code: 'CONFLICT' })
  })
  it('applySubmit -> NEEDS_REVIEW and closes history outcome=submitted', () => {
    const b = B.applyClaim(base(), 'hunter-A', T0)
    const s = B.applySubmit(b, 'hunter-A', 1, T0 + 120_000)
    assert.equal(s.state, 'NEEDS_REVIEW')
    assert.equal(s.claim_history[0].outcome, 'submitted')
    assert.equal(s.lease, null)
  })
  it('applyRelease -> OPEN, outcome=released, lease cleared', () => {
    const b = B.applyClaim(base(), 'hunter-A', T0)
    const r = B.applyRelease(b, 'hunter-A', 1, T0 + 5000)
    assert.equal(r.state, 'OPEN')
    assert.equal(r.claim_history[0].outcome, 'released')
    assert.equal(r.lease, null)
  })
})

describe('expire + poison + review', () => {
  const base = () => B.newBounty({ id: 'b1', kind: 'phase', repo: 'grimoire', priority: 'P1', title: 't', body_path: 'plans/phase-70.md', phase_tag: '70', size: 'M' })
  const T0 = 1_000_000

  it('applyExpire returns OPEN, attempts++, outcome=expired when past expires_at', () => {
    const b = B.applyClaim(base(), 'hunter-A', T0)
    const past = b.lease.expires_at + 1
    const e = B.applyExpire(b, past)
    assert.equal(e.state, 'OPEN')
    assert.equal(e.attempts, 1)
    assert.equal(e.claim_history[0].outcome, 'expired')
    assert.equal(e.lease, null)
  })
  it('applyExpire before expires_at is a no-op (returns same state CLAIMED)', () => {
    const b = B.applyClaim(base(), 'hunter-A', T0)
    const e = B.applyExpire(b, T0 + 1000)
    assert.equal(e.state, 'CLAIMED')
    assert.equal(e.attempts, 0)
  })
  it('third expiry crosses POISON_ATTEMPTS -> NEEDS_TRIAGE (not OPEN)', () => {
    let b = base()
    for (let i = 0; i < 3; i++) {
      b = B.applyClaim(b, `h${i}`, T0)
      b = B.applyExpire(b, b.lease.expires_at + 1)
    }
    assert.equal(b.attempts, 3)
    assert.equal(b.state, 'NEEDS_TRIAGE')
  })
  it('applyReview accept -> ACCEPTED', () => {
    let b = B.applyClaim(base(), 'hunter-A', T0)
    b = B.applySubmit(b, 'hunter-A', 1, T0 + 1000)
    const a = B.applyReview(b, 'hunter-B', 'accept', 'looks good', T0 + 2000)
    assert.equal(a.state, 'ACCEPTED')
    assert.equal(a.review.verdict, 'accept')
    assert.equal(a.review.reviewer, 'hunter-B')
  })
  it('applyReview reject -> OPEN with attached review + attempts++', () => {
    let b = B.applyClaim(base(), 'hunter-A', T0)
    b = B.applySubmit(b, 'hunter-A', 1, T0 + 1000)
    const r = B.applyReview(b, 'hunter-B', 'reject', 'tests missing', T0 + 2000)
    assert.equal(r.state, 'OPEN')
    assert.equal(r.attempts, 1)
    assert.equal(r.review.reason, 'tests missing')
  })
  it('reviewer cannot equal last claimant (no self-approval)', () => {
    let b = B.applyClaim(base(), 'hunter-A', T0)
    b = B.applySubmit(b, 'hunter-A', 1, T0 + 1000)
    assert.throws(() => B.applyReview(b, 'hunter-A', 'accept', 'me', T0 + 2000), { code: 'CONFLICT' })
  })
})
