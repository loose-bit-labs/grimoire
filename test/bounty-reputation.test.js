'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const B = require('../lib/bounty')

describe('deriveReputation', () => {
  it('counts claims, reclaims(expired), submits and averages submit time', () => {
    const T0 = 0
    let b = B.newBounty({ id: 'b1', kind: 'phase', repo: 'g', priority: 'P1', title: 't' })
    b = B.applyClaim(b, 'A', T0)
    b = B.applyExpire(b, b.lease.expires_at + 1)      // A reclaimed once
    b = B.applyClaim(b, 'A', 10_000)
    b = B.applySubmit(b, 'A', 2, 10_000 + 5_000)      // A submitted in 5s
    const rep = B.deriveReputation([b], 'A')
    assert.equal(rep.claims, 2)
    assert.equal(rep.reclaims, 1)
    assert.equal(rep.avg_time_to_submit_ms, 5_000)
  })
  it('credits accepts/rejects from review when hunter was submitting claimant', () => {
    const T0 = 0
    let b = B.newBounty({ id: 'b1', kind: 'phase', repo: 'g', priority: 'P1', title: 't' })
    b = B.applyClaim(b, 'A', T0)
    b = B.applySubmit(b, 'A', 1, T0 + 1000)
    b = B.applyReview(b, 'B', 'accept', 'good', T0 + 2000)
    const rep = B.deriveReputation([b], 'A')
    assert.equal(rep.accepts, 1)
    assert.equal(rep.rejects, 0)
  })
  it('returns zeroed counts for unknown hunter', () => {
    const rep = B.deriveReputation([], 'ghost')
    assert.equal(rep.claims, 0)
    assert.equal(rep.reclaims, 0)
    assert.equal(rep.avg_time_to_submit_ms, null)
    assert.equal(rep.triage_contributions, 0)
  })
})

describe('nextEligible', () => {
  it('returns highest priority OPEN, honoring kind filter', () => {
    const mk = (id, pr, st, kind='phase') => Object.assign(B.newBounty({ id, kind, repo: 'g', priority: pr, title: id }), { state: st })
    const board = [ mk('b1','P2','OPEN'), mk('b2','P0','OPEN'), mk('b3','P0','CLAIMED'), mk('b4','P1','OPEN','task') ]
    assert.equal(B.nextEligible(board, 'A').id, 'b2')             // P0 open phase
    assert.equal(B.nextEligible(board, 'A', { kind: 'task' }).id, 'b4')
  })
  it('returns null when nothing OPEN matches', () => {
    const mk = (id, st) => Object.assign(B.newBounty({ id, kind:'phase', repo:'g', priority:'P1', title:id }), { state: st })
    assert.equal(B.nextEligible([mk('b1','CLAIMED')], 'A'), null)
  })
  it('reputation does not influence eligibility', () => {
    const mk = (id, pr, st) => Object.assign(B.newBounty({ id, kind:'phase', repo:'g', priority: pr, title:id }), { state: st })
    const board = [ mk('b1','P3','OPEN'), mk('b2','P1','OPEN') ]
    // even if A has terrible reputation, nextEligible ignores it
    assert.equal(B.nextEligible(board, 'A').id, 'b2')
  })
})

describe('PRIORITY_RANK', () => {
  it('is exported and ordered P0<P1<P2<P3', () => {
    assert.deepEqual(B.PRIORITY_RANK, { P0: 0, P1: 1, P2: 2, P3: 3 })
  })
})
