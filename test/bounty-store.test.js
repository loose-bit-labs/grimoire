'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
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

describe('upsertHunter', () => {
  it('sets first_seen on first touch, updates last_seen', () => {
    const board = { bounties: [], hunters: {} }
    const now = 1_000_000
    S.upsertHunter(board, { hunterId: 'A', host: 'aid', session_id: 's1', nowMs: now })
    assert.equal(board.hunters.A.first_seen, now)
    assert.equal(board.hunters.A.last_seen, now)
    assert.equal(board.hunters.A.host, 'aid')
    S.upsertHunter(board, { hunterId: 'A', host: 'aid', session_id: 's2', nowMs: now + 1000 })
    assert.equal(board.hunters.A.first_seen, now)
    assert.equal(board.hunters.A.last_seen, now + 1000)
    assert.equal(board.hunters.A.session_id, 's2')
  })
})

describe('ConflictError re-export', () => {
  it('is the same class from bounty', () => {
    assert.strictEqual(S.ConflictError, B.ConflictError)
  })
})
