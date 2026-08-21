'use strict'

// ── Model + constants ─────────────────────────────────────────────────────────

const STATES = ['OPEN', 'CLAIMED', 'NEEDS_REVIEW', 'ACCEPTED', 'NEEDS_TRIAGE', 'BLOCKED']
const KINDS  = ['phase', 'task', 'bug', 'chore']
const TIMING = { phase: { beat: 300, ttl: 1800 }, task: { beat: 120, ttl: 480 }, bug: { beat: 120, ttl: 480 } }
const POISON_ATTEMPTS = 3

class ConflictError extends Error {
  constructor(msg) { super(msg); this.name = 'ConflictError'; this.code = 'CONFLICT' }
}

// event -> set of states it is legal from
const TRANSITIONS = {
  claim:     new Set(['OPEN']),
  heartbeat: new Set(['CLAIMED']),
  submit:    new Set(['CLAIMED']),
  release:   new Set(['CLAIMED']),
  expire:    new Set(['CLAIMED']),
  accept:    new Set(['NEEDS_REVIEW']),
  reject:    new Set(['NEEDS_REVIEW']),
  block:     new Set(['OPEN', 'CLAIMED', 'NEEDS_REVIEW']),
}

function legalTransition(state, event) {
  const set = TRANSITIONS[event]
  return !!set && set.has(state)
}

function ttlFor(kind) { return TIMING[kind] || TIMING.task }

function newBounty({ id, kind, repo, priority, title, body_path, phase_tag, size }) {
  return {
    id, kind, repo, priority, title,
    body_path: body_path || null,
    phase_tag: phase_tag || null,
    size: size || null,
    state: 'OPEN',
    attempts: 0,
    claim_history: [],
    review: null,
    lease: null,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maxEpoch(bounty) {
  return bounty.claim_history.reduce((m, h) => Math.max(m, h.epoch || 0), 0)
}

function assertLegal(bounty, event) {
  if (!legalTransition(bounty.state, event)) {
    throw new ConflictError(`illegal ${event} from ${bounty.state}`)
  }
}

function assertOwner(bounty, hunterId, epoch) {
  const l = bounty.lease
  if (!l || l.owner !== hunterId || l.lease_epoch !== epoch) {
    throw new ConflictError('stale or non-owning lease')
  }
}

function clone(b) { return JSON.parse(JSON.stringify(b)) }

function currentHistory(b, epoch) {
  return b.claim_history.find(h => h.epoch === epoch)
}

function closeAttempt(b, epoch, nowMs, outcome) {
  const h = currentHistory(b, epoch)
  if (h) { h.ended_at = nowMs; h.outcome = outcome }
}

function lastClaimant(bounty) {
  for (let i = bounty.claim_history.length - 1; i >= 0; i--) {
    if (bounty.claim_history[i].hunter_id) return bounty.claim_history[i].hunter_id
  }
  return null
}

// ── Transitions ───────────────────────────────────────────────────────────────

function applyClaim(bounty, hunterId, nowMs) {
  assertLegal(bounty, 'claim')
  const b = clone(bounty)
  const epoch = maxEpoch(b) + 1
  const { ttl } = ttlFor(b.kind)
  b.state = 'CLAIMED'
  b.lease = { owner: hunterId, lease_epoch: epoch, expires_at: nowMs + ttl * 1000, last_beat: nowMs, wip_ref: null }
  b.claim_history.push({ epoch, hunter_id: hunterId, claimed_at: nowMs, ended_at: null, outcome: null })
  return b
}

function applyHeartbeat(bounty, hunterId, epoch, nowMs, wipRef) {
  assertLegal(bounty, 'heartbeat')
  assertOwner(bounty, hunterId, epoch)
  const b = clone(bounty)
  const { ttl } = ttlFor(b.kind)
  b.lease.expires_at = nowMs + ttl * 1000
  b.lease.last_beat = nowMs
  if (wipRef !== undefined && wipRef !== null) b.lease.wip_ref = wipRef
  return b
}

function applySubmit(bounty, hunterId, epoch, nowMs) {
  assertLegal(bounty, 'submit')
  assertOwner(bounty, hunterId, epoch)
  const b = clone(bounty)
  closeAttempt(b, epoch, nowMs, 'submitted')
  b.state = 'NEEDS_REVIEW'
  b.lease = null
  return b
}

function applyRelease(bounty, hunterId, epoch, nowMs) {
  assertLegal(bounty, 'release')
  assertOwner(bounty, hunterId, epoch)
  const b = clone(bounty)
  closeAttempt(b, epoch, nowMs, 'released')
  b.state = 'OPEN'
  b.lease = null
  return b
}

function applyExpire(bounty, nowMs) {
  if (bounty.state !== 'CLAIMED' || !bounty.lease || nowMs < bounty.lease.expires_at) {
    return bounty // no-op: not expired
  }
  const b = clone(bounty)
  closeAttempt(b, b.lease.lease_epoch, nowMs, 'expired')
  b.attempts += 1
  b.lease = null
  b.state = b.attempts >= POISON_ATTEMPTS ? 'NEEDS_TRIAGE' : 'OPEN'
  return b
}

function applyReview(bounty, reviewerId, verdict, reason, nowMs) {
  assertLegal(bounty, verdict === 'accept' ? 'accept' : 'reject')
  if (reviewerId && reviewerId === lastClaimant(bounty)) {
    throw new ConflictError('reviewer must differ from claimant (no self-approval)')
  }
  const b = clone(bounty)
  b.review = { verdict, reviewer: reviewerId, reason: reason || null, at: nowMs }
  if (verdict === 'accept') {
    b.state = 'ACCEPTED'
  } else {
    b.attempts += 1
    b.state = b.attempts >= POISON_ATTEMPTS ? 'NEEDS_TRIAGE' : 'OPEN'
  }
  return b
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }

function deriveReputation(bountyList, hunterId) {
  let claims = 0, reclaims = 0, submits = 0, submitTotal = 0, accepts = 0, rejects = 0
  for (const b of bountyList) {
    for (const h of b.claim_history || []) {
      if (h.hunter_id !== hunterId) continue
      claims += 1
      if (h.outcome === 'expired') reclaims += 1
      if (h.outcome === 'submitted' && h.ended_at != null) { submits += 1; submitTotal += (h.ended_at - h.claimed_at) }
    }
    // accept/reject credited to the submitting claimant
    if (b.review && lastClaimant(b) === hunterId) {
      if (b.review.verdict === 'accept') accepts += 1
      else if (b.review.verdict === 'reject') rejects += 1
    }
  }
  return {
    claims, accepts, rejects, reclaims,
    avg_time_to_submit_ms: submits ? Math.round(submitTotal / submits) : null,
    triage_contributions: bountyList.filter(b => b.state === 'NEEDS_TRIAGE' && lastClaimant(b) === hunterId).length,
  }
}

function nextEligible(bountyList, hunterId, { kind } = {}) {
  const open = bountyList
    .filter(b => b.state === 'OPEN' && (!kind || b.kind === kind))
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
  return open[0] || null
}

module.exports = {
  STATES, KINDS, TIMING, POISON_ATTEMPTS, ConflictError,
  legalTransition, ttlFor, newBounty,
  applyClaim, applyHeartbeat, applySubmit, applyRelease,
  applyExpire, applyReview,
  maxEpoch, lastClaimant,
  deriveReputation, nextEligible, PRIORITY_RANK,
}
