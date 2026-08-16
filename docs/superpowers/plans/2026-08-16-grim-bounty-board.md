# grim-bounty-board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native, local-first hub-and-spoke execution-coordination layer where fleet worker sessions ("bounty hunters") pull, atomically claim, work, and submit prioritized cross-repo bounties, with self-healing leases.

**Architecture:** A pure state-machine core (`lib/bounty.js`, no IO) drives all transitions and fencing; a file-store (`lib/bounty-store.js`) persists durable board state (git-committable) split from ephemeral lease state (gitignored), serialized behind a single writer; `grim-server` (:3663, aid) is that sole writer, exposing HTTP routes + an SSE doorbell + an active reclaim sweep; `bin/grim-bounty.js` is a thin HTTP client CLI. Spec: `docs/superpowers/specs/2026-08-15-grim-bounty-board-design.md`.

**Tech Stack:** Node.js (CommonJS, OOP/functional per repo style), Express, minimist, `node:test`. No new dependencies (file-based JSON store, not sqlite).

## Global Constraints

- **grim-server (:3663, aid) is the sole authority** for claim/heartbeat/submit/review/release. Workers never compute ownership or expiry. All mutations flow through the server; the CLI is an HTTP client.
- **Storage split:** durable fields (`id, kind, repo, priority, title, body_path, phase_tag, size, state, attempts, claim_history[], review`) live in a git-committable file; ephemeral lease fields (`owner, lease_epoch, expires_at, last_beat, wip_ref`) live in a **gitignored** file. Live claim state never touches the KB graph.
- **Fencing:** every claim increments `lease_epoch`; `heartbeat`/`submit`/`release` carrying a stale epoch are rejected (HTTP 409).
- **Poison hard-stop:** after `attempts >= 3` reclaim/reject cycles, a bounty goes to `NEEDS_TRIAGE`, never auto-returned to `OPEN`.
- **No self-approval:** a review's reviewer must differ from the bounty's last claimant/author.
- **Reputation is descriptive, not prescriptive (v1):** derived from `claim_history`, surfaced read-only; it never gates claiming, `next`, or review.
- **v1 exposes only `kind="phase"`** (hierophant-authored). `task|bug|chore` are reserved in the model, not enabled in CLI creation.
- **Durable/recoverable:** lease expiry is derived from persisted `expires_at`, never an in-memory timer. Server restart recomputes expirations.
- **State set:** `OPEN, CLAIMED, NEEDS_REVIEW, ACCEPTED, NEEDS_TRIAGE, BLOCKED`. Per-kind timing (seconds): `phase {beat:300, ttl:1800}`, `task|bug {beat:120, ttl:480}`.
- Repo conventions: CommonJS; pure exported functions + `if (require.main === module)` entry; `module.exports = { ... }`; tests are `node:test` `describe/it` requiring the exported functions; atomic file writes via temp-file + `fs.renameSync`.

---

### Task 1: Pure state-machine core — model, transitions, fencing, poison

**Files:**
- Create: `lib/bounty.js`
- Test: `test/bounty.test.js`

**Interfaces:**
- Consumes: nothing (pure, no IO).
- Produces:
  - `STATES` (array), `KINDS` (array), `TIMING` (`{phase:{beat,ttl}, task:{beat,ttl}, bug:{...}}`, seconds), `POISON_ATTEMPTS = 3`
  - `newBounty({id, kind, repo, priority, title, body_path, phase_tag, size}) -> bounty`
  - `ttlFor(kind) -> {beat, ttl}`
  - `legalTransition(state, event) -> boolean` — events: `claim,heartbeat,submit,release,expire,accept,reject,block`
  - `applyClaim(bounty, hunterId, nowMs) -> bounty` (throws `ConflictError` if state !== `OPEN`)
  - `applyHeartbeat(bounty, hunterId, epoch, nowMs, wipRef) -> bounty` (throws `ConflictError` on state/owner/epoch mismatch)
  - `applySubmit(bounty, hunterId, epoch, nowMs) -> bounty`
  - `applyRelease(bounty, hunterId, epoch, nowMs) -> bounty`
  - `applyExpire(bounty, nowMs) -> bounty` (only if `CLAIMED && now >= expires_at`)
  - `applyReview(bounty, reviewerId, verdict /* 'accept'|'reject' */, reason, nowMs) -> bounty` (throws `ConflictError` if reviewer === last claimant, or state !== `NEEDS_REVIEW`)
  - `class ConflictError extends Error` (carries `.code = 'CONFLICT'`)

Time is passed in as `nowMs` (millis) everywhere — no `Date.now()` inside pure functions, so tests are deterministic. `expires_at` is stored as epoch millis.

- [ ] **Step 1: Write failing tests for construction + timing + legal transitions**

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/bounty.test.js`
Expected: FAIL — cannot find module `../lib/bounty`.

- [ ] **Step 3: Implement model, timing, legalTransition**

```js
'use strict'

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

module.exports = { STATES, KINDS, TIMING, POISON_ATTEMPTS, ConflictError, legalTransition, ttlFor, newBounty }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/bounty.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bounty.js test/bounty.test.js
git commit -m "feat(bounty): pure model + timing + legal-transition table"
```

- [ ] **Step 6: Write failing tests for claim/heartbeat/submit/release with fencing**

```js
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
```

- [ ] **Step 7: Run to verify fail**

Run: `node --test test/bounty.test.js`
Expected: FAIL — `applyClaim is not a function`.

- [ ] **Step 8: Implement claim/heartbeat/submit/release**

```js
// helpers
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

function currentHistory(b, epoch) {
  return b.claim_history.find(h => h.epoch === epoch)
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

function closeAttempt(b, epoch, nowMs, outcome) {
  const h = currentHistory(b, epoch)
  if (h) { h.ended_at = nowMs; h.outcome = outcome }
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

module.exports = { STATES, KINDS, TIMING, POISON_ATTEMPTS, ConflictError, legalTransition, ttlFor, newBounty,
  applyClaim, applyHeartbeat, applySubmit, applyRelease }
```

- [ ] **Step 9: Run to verify pass**

Run: `node --test test/bounty.test.js`
Expected: PASS (all claim-lifecycle tests).

- [ ] **Step 10: Commit**

```bash
git add lib/bounty.js test/bounty.test.js
git commit -m "feat(bounty): claim/heartbeat/submit/release with epoch fencing"
```

- [ ] **Step 11: Write failing tests for expire + poison + review**

```js
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
```

- [ ] **Step 12: Run to verify fail**, then **Step 13: implement expire + review**

Run: `node --test test/bounty.test.js` → FAIL (`applyExpire is not a function`).

```js
function lastClaimant(bounty) {
  for (let i = bounty.claim_history.length - 1; i >= 0; i--) {
    if (bounty.claim_history[i].hunter_id) return bounty.claim_history[i].hunter_id
  }
  return null
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

// extend module.exports:
module.exports = Object.assign(module.exports, { applyExpire, applyReview, lastClaimant, maxEpoch })
```

- [ ] **Step 14: Run to verify pass**, then **Step 15: commit**

Run: `node --test test/bounty.test.js` → PASS.

```bash
git add lib/bounty.js test/bounty.test.js
git commit -m "feat(bounty): expire+poison hard-stop and review with no-self-approval"
```

---

### Task 2: Reputation + eligibility (pure, `lib/bounty.js` additions)

**Files:**
- Modify: `lib/bounty.js` (add two functions + exports)
- Test: `test/bounty-reputation.test.js`

**Interfaces:**
- Consumes: bounty objects from Task 1 (esp. `claim_history` entries `{epoch, hunter_id, claimed_at, ended_at, outcome}`).
- Produces:
  - `deriveReputation(bountyList, hunterId) -> {claims, accepts, rejects, reclaims, avg_time_to_submit_ms, triage_contributions}` — aggregates every `claim_history` entry across the board for that hunter. `accepts`/`rejects` counted from a bounty's `review` when that hunter was the submitting claimant; `reclaims` = entries with `outcome==='expired'`; `avg_time_to_submit_ms` over entries with `outcome==='submitted'` (`ended_at - claimed_at`).
  - `nextEligible(bountyList, hunterId, {kind}={}) -> bounty|null` — highest-priority `OPEN` bounty (P0 < P1 < P2 < P3), optional `kind` filter; **v1 does NOT use reputation to filter** (descriptive-only invariant).

- [ ] **Step 1: Write failing tests**

```js
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
})
```

- [ ] **Step 2: Run → fail.** `node --test test/bounty-reputation.test.js` → `deriveReputation is not a function`.

- [ ] **Step 3: Implement**

```js
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

module.exports = Object.assign(module.exports, { deriveReputation, nextEligible, PRIORITY_RANK })
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit**

```bash
git add lib/bounty.js test/bounty-reputation.test.js
git commit -m "feat(bounty): derived reputation + priority-sorted nextEligible"
```

---

### Task 3: Persistence store with durable/ephemeral split (`lib/bounty-store.js`)

**Files:**
- Create: `lib/bounty-store.js`
- Test: `test/bounty-store.test.js`

**Interfaces:**
- Consumes: all `apply*` fns + `newBounty` + `ConflictError` from Task 1; `deriveReputation`/`nextEligible` from Task 2.
- Produces (all take a `root` dir = GRIMOIRE_ROOT):
  - `paths(root) -> {dir, boardFile, leasesFile, huntersFile, gitignoreFile}` (dir = `<root>/bounties`)
  - `loadBoard(root) -> {bounties: bounty[], hunters: Object<hunterId, hunterRecord>}` — reads durable board, merges each ephemeral lease into its bounty's `.lease`
  - `saveBoard(root, {bounties, hunters})` — splits durable vs ephemeral, atomic temp+rename for each file, writes `.gitignore` containing `leases.json`
  - `mutate(root, fn) -> Promise<result>` — serialized critical section: `await`s a per-root promise queue, loads board, calls `fn(board)` (which returns `{board, result}`), saves, resolves `result`. This is the single-writer lock.
  - `upsertHunter(board, {hunterId, host, session_id, nowMs})` — mutates `board.hunters` in place (first_seen/last_seen)
  - `ConflictError` re-exported for the server to map to 409.

- [ ] **Step 1: Write failing tests (round-trip + split + lock)**

```js
'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const S = require('../lib/bounty-store')
const B = require('../lib/bounty')

const mktmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grim-bounty-'))

describe('bounty-store round-trip + split', () => {
  it('saves durable board and gitignored leases separately, reloads merged', async () => {
    const root = mktmp()
    await S.mutate(root, board => {
      const b = B.applyClaim(B.newBounty({ id: 'b1', kind: 'phase', repo: 'g', priority: 'P1', title: 't' }), 'A', 1000)
      board.bounties.push(b)
      return { board, result: null }
    })
    const p = S.paths(root)
    // leases.json holds the ephemeral lease, board.json does not
    const durable = JSON.parse(fs.readFileSync(p.boardFile, 'utf8'))
    const leases  = JSON.parse(fs.readFileSync(p.leasesFile, 'utf8'))
    assert.equal(durable.bounties[0].lease, undefined)   // stripped from durable
    assert.equal(leases['b1'].owner, 'A')
    assert.ok(fs.readFileSync(p.gitignoreFile, 'utf8').includes('leases.json'))
    // reload merges them back
    const board = S.loadBoard(root)
    assert.equal(board.bounties[0].lease.owner, 'A')
  })
  it('mutate serializes concurrent critical sections (no lost update)', async () => {
    const root = mktmp()
    await S.mutate(root, board => { board.bounties.push(B.newBounty({ id: 'b1', kind:'phase', repo:'g', priority:'P1', title:'t' })); return { board, result: null } })
    // fire 5 concurrent attempts count++ style mutations
    await Promise.all([...Array(5)].map(() => S.mutate(root, board => {
      board.bounties[0].attempts += 1; return { board, result: null }
    })))
    assert.equal(S.loadBoard(root).bounties[0].attempts, 5)   // all applied, none lost
  })
})
```

- [ ] **Step 2: Run → fail.** `node --test test/bounty-store.test.js` → module not found.

- [ ] **Step 3: Implement store**

```js
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const B = require('./bounty')

function paths(root) {
  const dir = path.join(root, 'bounties')
  return {
    dir,
    boardFile: path.join(dir, 'board.json'),
    leasesFile: path.join(dir, 'leases.json'),
    huntersFile: path.join(dir, 'hunters.json'),
    gitignoreFile: path.join(dir, '.gitignore'),
  }
}

function _readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function _atomicWrite(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file)   // atomic on same filesystem
}

function loadBoard(root) {
  const p = paths(root)
  const durable = _readJson(p.boardFile, { bounties: [] })
  const leases  = _readJson(p.leasesFile, {})
  const hunters = _readJson(p.huntersFile, {})
  const bounties = (durable.bounties || []).map(b => ({ ...b, lease: leases[b.id] || null }))
  return { bounties, hunters }
}

function saveBoard(root, board) {
  const p = paths(root)
  fs.mkdirSync(p.dir, { recursive: true })
  const leases = {}
  const durable = board.bounties.map(b => {
    const { lease, ...rest } = b
    if (lease) leases[b.id] = lease
    return rest
  })
  _atomicWrite(p.boardFile, { bounties: durable })
  _atomicWrite(p.leasesFile, leases)
  _atomicWrite(p.huntersFile, board.hunters || {})
  if (!fs.existsSync(p.gitignoreFile)) fs.writeFileSync(p.gitignoreFile, 'leases.json\n')
}

// per-root serialization: a chained promise queue keyed by resolved dir
const _queues = new Map()
function mutate(root, fn) {
  const key = paths(root).dir
  const prev = _queues.get(key) || Promise.resolve()
  const run = prev.then(async () => {
    const board = loadBoard(root)
    const { board: next, result } = await fn(board)
    saveBoard(root, next)
    return result
  })
  // keep the chain alive even if this link rejects
  _queues.set(key, run.catch(() => {}))
  return run
}

function upsertHunter(board, { hunterId, host, session_id, nowMs }) {
  board.hunters = board.hunters || {}
  const existing = board.hunters[hunterId]
  board.hunters[hunterId] = {
    hunter_id: hunterId,
    host: host || existing?.host || null,
    session_id: session_id || existing?.session_id || null,
    first_seen: existing?.first_seen ?? nowMs,
    last_seen: nowMs,
  }
  return board
}

module.exports = { paths, loadBoard, saveBoard, mutate, upsertHunter, ConflictError: B.ConflictError }
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit**

```bash
git add lib/bounty-store.js test/bounty-store.test.js
git commit -m "feat(bounty): file store — durable/ephemeral split, atomic write, single-writer lock"
```

---

### Task 4: Server routes + atomic mutations (`bin/grim-server.js`)

**Files:**
- Modify: `bin/grim-server.js` (add a bounty route block near the other `app.post`/`app.get` routes; add `const bstore = require('../lib/bounty-store')`, `const bounty = require('../lib/bounty')`, and resolve `ROOT = config.root`)
- Test: `test/bounty-server.test.js`

**Interfaces:**
- Consumes: `lib/bounty-store` (`mutate, loadBoard, upsertHunter`), `lib/bounty` (`newBounty, applyClaim, applyHeartbeat, applySubmit, applyRelease, applyReview, deriveReputation, nextEligible, ConflictError`).
- Produces HTTP endpoints (all JSON; `ConflictError` → HTTP 409, missing bounty → 404, bad body → 400):
  - `POST /api/bounty` `{id?, kind:'phase', repo, priority, title, body_path, phase_tag, size}` → creates (server assigns `id` if absent) → `201 {bounty}`. v1 rejects `kind !== 'phase'` with 400.
  - `GET /api/bounty` `?state=&repo=&kind=&mine=<hunterId>` → `{bounties:[...]}` priority-sorted.
  - `GET /api/bounty/:id` → `{bounty}` or 404.
  - `POST /api/bounty/:id/claim` `{hunter_id, host?, session_id?}` → `{bounty}` (upserts hunter) or 409.
  - `POST /api/bounty/:id/heartbeat` `{hunter_id, epoch, wip_ref?}` → `{bounty}` or 409.
  - `POST /api/bounty/:id/submit` `{hunter_id, epoch, report?}` → `{bounty}` or 409.
  - `POST /api/bounty/:id/release` `{hunter_id, epoch}` → `{bounty}` or 409.
  - `POST /api/bounty/:id/review` `{reviewer_id, verdict:'accept'|'reject', reason?}` → `{bounty}` or 409.
  - `POST /api/bounty/:id/register` / `GET /api/bounty/hunters` → hunter registry + `deriveReputation` per hunter.
  - Every successful mutation calls `broadcastBounty(event, bounty)` (defined in Task 5; in Task 4 stub it as a no-op `function broadcastBounty(){}` so routes are testable now).

For testability, wrap the route bodies in a small exported factory `mountBounty(app, getRoot)` at the bottom of the relevant section, OR (simpler, matches existing file) add routes inline and test by starting the server on an ephemeral port. This plan uses **start-on-port-0** to match `test/grim-rig-serve.test.js` conventions.

- [ ] **Step 1: Write failing integration test (claim race → one 200, one 409)**

```js
'use strict'
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')

// The server reads config.root for GRIMOIRE_ROOT; set it before requiring.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-bsrv-'))
process.env.GRIMOIRE_ROOT = ROOT

const { app } = require('../bin/grim-server')  // Task 4 must export { app }
const http = require('node:http')

let server, base
before(async () => { server = http.createServer(app); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}` })
after(() => server.close())

async function j(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('bounty server', () => {
  it('create → list → claim is atomic (second claim 409)', async () => {
    const c = await j('POST', '/api/bounty', { kind: 'phase', repo: 'grimoire', priority: 'P1', title: 'demo', body_path: 'plans/phase-70.md', phase_tag: '70' })
    assert.equal(c.status, 201)
    const id = c.body.bounty.id
    const [a, b] = await Promise.all([
      j('POST', `/api/bounty/${id}/claim`, { hunter_id: 'A' }),
      j('POST', `/api/bounty/${id}/claim`, { hunter_id: 'B' }),
    ])
    const codes = [a.status, b.status].sort()
    assert.deepEqual(codes, [200, 409])  // exactly one winner
  })
  it('rejects kind!=phase in v1', async () => {
    const r = await j('POST', '/api/bounty', { kind: 'task', repo: 'g', priority: 'P1', title: 'x' })
    assert.equal(r.status, 400)
  })
})
```

- [ ] **Step 2: Run → fail** (`app` not exported / routes 404).

- [ ] **Step 3: Implement the route block + export `app`**

Add near the top requires:
```js
const bstore = require('../lib/bounty-store')
const bounty = require('../lib/bounty')
const BROOT = () => config.root   // GRIMOIRE_ROOT; server is the sole writer
function broadcastBounty() { /* replaced in Task 5 */ }
function sendConflict(res, e) {
  if (e && e.code === 'CONFLICT') return res.status(409).json({ error: e.message })
  return res.status(500).json({ error: String(e && e.message || e) })
}
```

Add the routes (mirror existing `app.post` style):
```js
app.post('/api/bounty', express.json(), async (req, res) => {
  const { kind = 'phase', repo, priority, title, body_path, phase_tag, size, id } = req.body || {}
  if (kind !== 'phase') return res.status(400).json({ error: 'v1 accepts kind=phase only' })
  if (!repo || !priority || !title) return res.status(400).json({ error: 'repo, priority, title required' })
  const bid = id || `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const b = await bstore.mutate(BROOT(), board => {
    const nb = bounty.newBounty({ id: bid, kind, repo, priority, title, body_path, phase_tag, size })
    board.bounties.push(nb)
    return { board, result: nb }
  })
  broadcastBounty('bounty:created', b)
  res.status(201).json({ bounty: b })
})

app.get('/api/bounty', (req, res) => {
  const { state, repo, kind, mine } = req.query
  let list = bstore.loadBoard(BROOT()).bounties
  if (state) list = list.filter(b => b.state === state)
  if (repo)  list = list.filter(b => b.repo === repo)
  if (kind)  list = list.filter(b => b.kind === kind)
  if (mine)  list = list.filter(b => b.lease && b.lease.owner === mine)
  list.sort((a, b) => (bounty.PRIORITY_RANK[a.priority] ?? 9) - (bounty.PRIORITY_RANK[b.priority] ?? 9))
  res.json({ bounties: list })
})

app.get('/api/bounty/hunters', (req, res) => {
  const board = bstore.loadBoard(BROOT())
  const out = Object.values(board.hunters || {}).map(h => ({ ...h, reputation: bounty.deriveReputation(board.bounties, h.hunter_id) }))
  res.json({ hunters: out })
})

app.get('/api/bounty/:id', (req, res) => {
  const b = bstore.loadBoard(BROOT()).bounties.find(x => x.id === req.params.id)
  if (!b) return res.status(404).json({ error: 'not found' })
  res.json({ bounty: b })
})

function bountyAction(event, apply) {
  return async (req, res) => {
    try {
      const b = await bstore.mutate(BROOT(), board => {
        const idx = board.bounties.findIndex(x => x.id === req.params.id)
        if (idx < 0) throw Object.assign(new Error('not found'), { code: 'NOTFOUND' })
        const updated = apply(board.bounties[idx], req.body || {}, board, Date.now())
        board.bounties[idx] = updated
        return { board, result: updated }
      })
      broadcastBounty(event, b)
      res.json({ bounty: b })
    } catch (e) {
      if (e.code === 'NOTFOUND') return res.status(404).json({ error: 'not found' })
      return sendConflict(res, e)
    }
  }
}

app.post('/api/bounty/:id/claim', express.json(), bountyAction('bounty:claimed', (b, body, board, now) => {
  const updated = bounty.applyClaim(b, body.hunter_id, now)
  bstore.upsertHunter(board, { hunterId: body.hunter_id, host: body.host, session_id: body.session_id, nowMs: now })
  return updated
}))
app.post('/api/bounty/:id/heartbeat', express.json(), bountyAction('bounty:heartbeat', (b, body, board, now) => {
  const updated = bounty.applyHeartbeat(b, body.hunter_id, body.epoch, now, body.wip_ref)
  bstore.upsertHunter(board, { hunterId: body.hunter_id, nowMs: now })
  return updated
}))
app.post('/api/bounty/:id/submit', express.json(), bountyAction('bounty:submitted', (b, body, board, now) => bounty.applySubmit(b, body.hunter_id, body.epoch, now)))
app.post('/api/bounty/:id/release', express.json(), bountyAction('bounty:released', (b, body, board, now) => bounty.applyRelease(b, body.hunter_id, body.epoch, now)))
app.post('/api/bounty/:id/review', express.json(), bountyAction('bounty:reviewed', (b, body, board, now) => bounty.applyReview(b, body.reviewer_id, body.verdict, body.reason, now)))
app.post('/api/bounty/:id/register', express.json(), async (req, res) => {
  const now = Date.now()
  await bstore.mutate(BROOT(), board => { bstore.upsertHunter(board, { hunterId: req.body.hunter_id, host: req.body.host, session_id: req.body.session_id, nowMs: now }); return { board, result: null } })
  res.json({ ok: true })
})
```

Ensure the file exports the express `app` (find the existing `module.exports` and add `app`):
```js
module.exports = Object.assign(module.exports || {}, { app })
```

- [ ] **Step 4: Run → pass.** `node --test test/bounty-server.test.js`

- [ ] **Step 5: Commit**

```bash
git add bin/grim-server.js test/bounty-server.test.js
git commit -m "feat(bounty): server routes — create/list/claim/heartbeat/submit/release/review, 409 on conflict"
```

---

### Task 5: Active reclaim sweep + SSE doorbell (`bin/grim-server.js`)

**Files:**
- Modify: `bin/grim-server.js` (replace the `broadcastBounty` stub; add the SSE endpoint + the sweep timer)
- Test: `test/bounty-sweep.test.js`

**Interfaces:**
- Consumes: `bstore.mutate/loadBoard`, `bounty.applyExpire`.
- Produces:
  - `GET /api/bounty/stream` — SSE; on connect sends the current board snapshot, then a `data:` frame per transition. Mirrors `/api/hmm/stream`.
  - `function broadcastBounty(event, b)` — writes `data: {"event":..., "bounty":...}\n\n` to every SSE client.
  - `async function sweepBounties(root, nowMs = Date.now())` — exported; scans, applies `applyExpire` to each expired lease, persists, broadcasts `bounty:reclaimed` (or `bounty:triage` when the result is `NEEDS_TRIAGE`). Returns the list of changed bounties. Called on an interval (`setInterval(() => sweepBounties(BROOT()), 30_000)`), unref'd so tests don't hang.

- [ ] **Step 1: Write failing test (claim → expire → sweep reclaims; poison → triage)**

```js
'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-sweep-'))
process.env.GRIMOIRE_ROOT = ROOT
const srv = require('../bin/grim-server')   // exports sweepBounties
const bstore = require('../lib/bounty-store'); const B = require('../lib/bounty')

describe('sweepBounties', () => {
  it('reclaims an expired lease back to OPEN', async () => {
    await bstore.mutate(ROOT, board => { board.bounties.push(B.applyClaim(B.newBounty({ id: 's1', kind: 'phase', repo: 'g', priority: 'P1', title: 't' }), 'A', 1000)); return { board, result: null } })
    const claimed = bstore.loadBoard(ROOT).bounties[0]
    const changed = await srv.sweepBounties(ROOT, claimed.lease.expires_at + 1)
    assert.equal(changed.length, 1)
    assert.equal(bstore.loadBoard(ROOT).bounties[0].state, 'OPEN')
  })
})
```

- [ ] **Step 2: Run → fail** (`srv.sweepBounties is not a function`).

- [ ] **Step 3: Implement SSE + broadcast + sweep**

```js
let _bountySSE = []
app.get('/api/bounty/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' })
  _bountySSE.push(res)
  try { res.write(`data: ${JSON.stringify({ event: 'snapshot', bounties: bstore.loadBoard(BROOT()).bounties })}\n\n`) } catch { /* ignore */ }
  req.on('close', () => { _bountySSE = _bountySSE.filter(c => c !== res) })
})

// replace the Task-4 stub (delete the old `function broadcastBounty(){}`)
function broadcastBounty(event, b) {
  const frame = `data: ${JSON.stringify({ event, bounty: b })}\n\n`
  for (const c of _bountySSE) { try { c.write(frame) } catch { /* drop */ } }
}

async function sweepBounties(root, nowMs = Date.now()) {
  const changed = []
  await bstore.mutate(root, board => {
    for (let i = 0; i < board.bounties.length; i++) {
      const b = board.bounties[i]
      if (b.state !== 'CLAIMED' || !b.lease || nowMs < b.lease.expires_at) continue
      const next = bounty.applyExpire(b, nowMs)
      board.bounties[i] = next
      changed.push(next)
    }
    return { board, result: null }
  })
  for (const b of changed) broadcastBounty(b.state === 'NEEDS_TRIAGE' ? 'bounty:triage' : 'bounty:reclaimed', b)
  return changed
}

const _sweepTimer = setInterval(() => { sweepBounties(BROOT()).catch(() => {}) }, 30_000)
if (_sweepTimer.unref) _sweepTimer.unref()

module.exports = Object.assign(module.exports || {}, { sweepBounties })
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit**

```bash
git add bin/grim-server.js test/bounty-sweep.test.js
git commit -m "feat(bounty): active reclaim sweep + SSE doorbell broadcast"
```

---

### Task 6: CLI (`bin/grim-bounty.js`) + dispatcher entry (`bin/grim.js`)

**Files:**
- Create: `bin/grim-bounty.js`
- Modify: `bin/grim.js` (add one `COMMANDS` entry: `'bounty': { script: 'grim-bounty.js', desc: 'Claimable cross-repo work pool (The Bounty Board)' }`)
- Test: `test/bounty-cli.test.js`

**Interfaces:**
- Consumes: the Task 4/5 HTTP endpoints; `config` from `lib/env` to resolve `endpoints.grimoire`.
- Produces (exported for tests):
  - `resolveHunterId(args) -> string` — `args.as || process.env.CLAUDE_CODE_SESSION_ID` (throws a friendly error if neither is set), mirroring `grim mm --session` default.
  - `baseUrl() -> string` — `config.endpoints.grimoire` (e.g. `http://aid:3663`).
  - `formatBoard(bounties) -> string` — priority-sorted, one line per bounty: `#<id> <priority> <state> <repo> <phase_tag> <title>`.
  - `async main(argv)` — minimist verb dispatch: `list, show, next, claim, heartbeat, submit, review, release, create, register, hunters, hunter, watch`. `--json` prints raw. `--as <hunter>` overrides hunter id.

- [ ] **Step 1: Write failing unit tests for the pure helpers**

```js
'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const C = require('../bin/grim-bounty')

describe('grim-bounty helpers', () => {
  it('resolveHunterId prefers --as then env', () => {
    assert.equal(C.resolveHunterId({ as: 'zed' }), 'zed')
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-9'
    assert.equal(C.resolveHunterId({}), 'sess-9')
  })
  it('formatBoard renders priority-sorted lines', () => {
    const out = C.formatBoard([
      { id: 'b2', priority: 'P0', state: 'OPEN', repo: 'g', phase_tag: '70', title: 'hi' },
      { id: 'b1', priority: 'P2', state: 'CLAIMED', repo: 'g', phase_tag: '69', title: 'lo' },
    ])
    const lines = out.trim().split('\n')
    assert.match(lines[0], /b2.*P0.*OPEN/)
    assert.match(lines[1], /b1.*P2.*CLAIMED/)
  })
})
```

- [ ] **Step 2: Run → fail.** **Step 3: Implement CLI**

```js
#!/usr/bin/env node
'use strict'
const minimist = require('minimist')
const { config } = require('../lib/env')

function baseUrl() {
  const url = config?.endpoints?.grimoire
  if (!url) throw new Error('endpoints.grimoire not resolved (lib/env / lbl-config)')
  return url.replace(/\/$/, '')
}

function resolveHunterId(args) {
  const id = args.as || process.env.CLAUDE_CODE_SESSION_ID
  if (!id) throw new Error('no hunter id: pass --as <id> or set CLAUDE_CODE_SESSION_ID')
  return id
}

const PR = { P0: 0, P1: 1, P2: 2, P3: 3 }
function formatBoard(bounties) {
  return [...bounties]
    .sort((a, b) => (PR[a.priority] ?? 9) - (PR[b.priority] ?? 9))
    .map(b => `#${b.id}  ${b.priority}  ${String(b.state).padEnd(12)}  ${b.repo}  ${b.phase_tag ?? '-'}  ${b.title}`)
    .join('\n') + '\n'
}

async function api(method, path, body) {
  const res = await fetch(baseUrl() + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

async function main(argv) {
  const args = minimist(argv.slice(1), { boolean: ['json', 'accept', 'reject'], string: ['as', 'repo', 'priority', 'title', 'phase', 'body', 'size', 'file', 'reason', 'wip', 'state', 'kind'] })
  const verb = argv[0]
  const out = (o) => console.log(args.json ? JSON.stringify(o, null, 2) : o)
  switch (verb) {
    case 'list': {
      const q = new URLSearchParams(Object.fromEntries(['state','repo','kind'].filter(k => args[k]).map(k => [k, args[k]])))
      if (args.mine) q.set('mine', resolveHunterId(args))
      const { bounties } = await api('GET', `/api/bounty?${q}`)
      out(args.json ? bounties : formatBoard(bounties)); break
    }
    case 'show':      out((await api('GET', `/api/bounty/${argv[1]}`)).bounty); break
    case 'next': {
      const { bounties } = await api('GET', `/api/bounty?state=OPEN${args.kind ? `&kind=${args.kind}` : ''}`)
      out(bounties[0] || 'no eligible bounties'); break
    }
    case 'claim':     out((await api('POST', `/api/bounty/${argv[1]}/claim`, { hunter_id: resolveHunterId(args), host: require('node:os').hostname(), session_id: process.env.CLAUDE_CODE_SESSION_ID })).bounty); break
    case 'heartbeat': out((await api('POST', `/api/bounty/${argv[1]}/heartbeat`, { hunter_id: resolveHunterId(args), epoch: Number(args.epoch), wip_ref: args.wip })).bounty); break
    case 'submit':    out((await api('POST', `/api/bounty/${argv[1]}/submit`, { hunter_id: resolveHunterId(args), epoch: Number(args.epoch), report: args.file })).bounty); break
    case 'release':   out((await api('POST', `/api/bounty/${argv[1]}/release`, { hunter_id: resolveHunterId(args), epoch: Number(args.epoch) })).bounty); break
    case 'review':    out((await api('POST', `/api/bounty/${argv[1]}/review`, { reviewer_id: resolveHunterId(args), verdict: args.accept ? 'accept' : 'reject', reason: args.reason })).bounty); break
    case 'create':    out((await api('POST', '/api/bounty', { kind: 'phase', repo: args.repo, priority: args.priority, title: args.title, phase_tag: args.phase, body_path: args.body, size: args.size })).bounty); break
    case 'register':  out(await api('POST', `/api/bounty/${'x'}/register`.replace('/x/','/').replace('bounty//','bounty/register'), { hunter_id: resolveHunterId(args), host: require('node:os').hostname() })); break
    case 'hunters':   out((await api('GET', '/api/bounty/hunters')).hunters); break
    case 'hunter':    out(((await api('GET', '/api/bounty/hunters')).hunters).find(h => h.hunter_id === argv[1]) || 'unknown hunter'); break
    default: console.error('usage: grim bounty <list|show|next|claim|heartbeat|submit|release|review|create|register|hunters|hunter>'); process.exit(1)
  }
}

if (require.main === module) { main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1) }) }
module.exports = { resolveHunterId, baseUrl, formatBoard, main }
```

Note: the `register` route is `POST /api/bounty/register` — simplify the CLI line to `await api('POST', '/api/bounty/register', { hunter_id: resolveHunterId(args), host: require('node:os').hostname() })` (the obfuscated replace above is a mistake; use the clean path).

- [ ] **Step 4: Fix the register line to the clean path, run → pass**

Run: `node --test test/bounty-cli.test.js` → PASS (helpers). Then manually: `grim bounty --help`-style dispatch returns usage.

- [ ] **Step 5: Add dispatcher entry + commit**

Edit `bin/grim.js` COMMANDS, inserting after the `'hmm'` line:
```js
  'bounty':        { script: 'grim-bounty.js',        desc: 'Claimable cross-repo work pool        (The Bounty Board)' },
```

```bash
git add bin/grim-bounty.js bin/grim.js test/bounty-cli.test.js
git commit -m "feat(bounty): grim bounty CLI (HTTP client) + dispatcher entry"
```

---

### Task 7: Telemetry gauges (`lib/bounty.js` + `bin/grim-server.js`)

**Files:**
- Modify: `lib/bounty.js` (add pure `boardMetrics`)
- Modify: `bin/grim-server.js` (expose `GET /api/bounty/metrics` in Prometheus text)
- Test: `test/bounty-metrics.test.js`

**Interfaces:**
- Consumes: a loaded board.
- Produces:
  - `boardMetrics(bountyList, nowMs) -> {open_total, open_by_priority:{P0,P1,P2,P3}, claimed, needs_review, triage, reclaim_total, avg_time_in_open_ms}` (pure).
  - `GET /api/bounty/metrics` → Prometheus exposition text with `grim_bounty_*` gauges (mirrors the rig `toPrometheusText` style: `# HELP`, `# TYPE gauge`, one line per series).

- [ ] **Step 1: Write failing test**

```js
'use strict'
const { describe, it } = require('node:test'); const assert = require('node:assert')
const B = require('../lib/bounty')
describe('boardMetrics', () => {
  it('counts states and priorities', () => {
    const mk = (pr, st) => Object.assign(B.newBounty({ id: pr+st, kind:'phase', repo:'g', priority: pr, title: 't' }), { state: st })
    const m = B.boardMetrics([mk('P0','OPEN'), mk('P1','OPEN'), mk('P0','CLAIMED'), mk('P2','NEEDS_TRIAGE')], 0)
    assert.equal(m.open_total, 2)
    assert.equal(m.open_by_priority.P0, 1)
    assert.equal(m.claimed, 1)
    assert.equal(m.triage, 1)
  })
})
```

- [ ] **Step 2: Run → fail.** **Step 3: Implement**

```js
function boardMetrics(bountyList, nowMs) {
  const m = { open_total: 0, open_by_priority: { P0: 0, P1: 0, P2: 0, P3: 0 }, claimed: 0, needs_review: 0, triage: 0, reclaim_total: 0, avg_time_in_open_ms: null }
  for (const b of bountyList) {
    if (b.state === 'OPEN') { m.open_total++; if (m.open_by_priority[b.priority] != null) m.open_by_priority[b.priority]++ }
    else if (b.state === 'CLAIMED') m.claimed++
    else if (b.state === 'NEEDS_REVIEW') m.needs_review++
    else if (b.state === 'NEEDS_TRIAGE') m.triage++
    m.reclaim_total += (b.claim_history || []).filter(h => h.outcome === 'expired').length
  }
  return m
}
module.exports = Object.assign(module.exports, { boardMetrics })
```

Server endpoint:
```js
app.get('/api/bounty/metrics', (req, res) => {
  const m = bounty.boardMetrics(bstore.loadBoard(BROOT()).bounties, Date.now())
  const lines = []
  const g = (name, help, val, labels = '') => { lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}${labels} ${val}`) }
  g('grim_bounty_open_total', 'Open bounties', m.open_total)
  for (const p of ['P0','P1','P2','P3']) lines.push(`grim_bounty_open{priority="${p}"} ${m.open_by_priority[p]}`)
  g('grim_bounty_claimed', 'Claimed bounties', m.claimed)
  g('grim_bounty_needs_review', 'Bounties awaiting review', m.needs_review)
  g('grim_bounty_triage', 'Poisoned bounties (needs human)', m.triage)
  g('grim_bounty_reclaim_total', 'Total lease reclaims', m.reclaim_total)
  res.type('text/plain').send(lines.join('\n') + '\n')
})
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit**

```bash
git add lib/bounty.js bin/grim-server.js test/bounty-metrics.test.js
git commit -m "feat(bounty): board metrics + /api/bounty/metrics prometheus endpoint"
```

- [ ] **Step 6: Full-suite gate** — run the whole suite N× to confirm determinism (phase-66 discipline: no order-coupling, no live-service dependence, self-terminating).

```bash
node --test 'test/*.test.js' && node --test 'test/*.test.js'
```
Expected: identical PASS counts both runs; process exits (sweep timer is unref'd).

---

## Self-Review

**1. Spec coverage:**
- §2 native/atom-phase/lease → Tasks 1,3,4,5. §3 invariants (sole-writer T4; storage-split T3; fencing T1/T4; no-self-approval T1; reputation-descriptive T2; durable-recoverable T3/T5) ✓. §4 hunter role → registry T3/T4, reputation T2, `hunters`/`register`/`--as` T6 ✓. §5 storage split T3 ✓. §6 model T1 + Hunter/Reputation T2/T3 ✓. §7 state machine T1, SSE transitions T5 ✓. §8 per-kind TTL T1 ✓. §9 CLI T6 ✓. §10 observability T7 ✓. §11 failure recovery — lease/expire T5, poison T1, fencing T1, review-reopen T1, server-restart-recompute (loadBoard derives from persisted expires_at, T3) ✓.
- **Deferred to fast-follow (not in this plan, per spec §12):** `kind=task|bug|chore` authorship, read-only web board, `grim roadmap` reading from the board, reputation-as-policy, the watchdog session. Each is its own later plan.

**2. Placeholder scan:** No TBD/TODO. The Task-6 `register` line is called out with its corrected clean path (Step 4 fixes it). Every step has runnable code.

**3. Type consistency:** `applyClaim/applyHeartbeat/applySubmit/applyRelease/applyReview/applyExpire` signatures identical across Tasks 1,3,4,5. `lease` shape `{owner, lease_epoch, expires_at, last_beat, wip_ref}` consistent T1↔T3↔T4. `claim_history` entry `{epoch, hunter_id, claimed_at, ended_at, outcome}` consistent T1↔T2↔T7. `PRIORITY_RANK` defined T2, reused T4. `mutate(root, fn→{board,result})` consistent T3↔T4↔T5. `boardMetrics` T7 matches its test.

---

## Notes for the pact

These 7 tasks are phase-sized and independently reviewable — they map cleanly onto grimoire phase briefs (and, fittingly, become the **first bounties** the board tracks once it exists). Suggested phase numbering continues the roadmap (e.g. phases 71–77, Track: "Bounty Board"). Land in order: 1→2→3 are pure/local (no server), 4→5 add the server surface, 6 the CLI, 7 the telemetry + the determinism gate.
