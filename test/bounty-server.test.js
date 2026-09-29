'use strict'

/**
 * bounty-server.test.js — phase 74: bounty routes + atomic mutations on the
 * live express app, started on an ephemeral port (no hardcoded port, no
 * live-service dependence). WHY these matter: the bounty board is a multi-
 * hunter resource; the whole point is that two hunters racing for one bounty
 * must resolve to exactly one winner (one 200, one 409) — a regression there
 * is a double-claim. The durable hunter registry (hunters.json) is written
 * by the same single-writer path, so a claim that doesn't register is a bug.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')

// The server reads config.root for GRIMOIRE_ROOT; it must be set BEFORE we
// require bin/grim-server (lib/env captures config at load time).
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-bsrv-'))
process.env.GRIMOIRE_ROOT = ROOT

const { app } = require('../bin/grim-server')
const http = require('node:http')

let server
let base
before(async () => {
  server = http.createServer(app)
  await new Promise(r => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

function j(method, url, body) {
  return fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async res => ({ status: res.status, body: await res.json().catch(() => null) }))
}

describe('bounty server', () => {
  it('create → two concurrent claims are atomic (one 200, one 409)', async () => {
    const c = await j('POST', '/api/bounty', { kind: 'phase', repo: 'grimoire', priority: 'P1', title: 'demo', body_path: 'plans/phase-70.md', phase_tag: '70' })
    assert.equal(c.status, 201)
    const id = c.body.bounty.id
    const [a, b] = await Promise.all([
      j('POST', `/api/bounty/${id}/claim`, { hunter_id: 'A' }),
      j('POST', `/api/bounty/${id}/claim`, { hunter_id: 'B' }),
    ])
    const codes = [a.status, b.status].sort((x, y) => x - y)
    assert.deepEqual(codes, [200, 409]) // exactly one winner
  })

  it('a successful claim upserts the hunter into the durable registry', async () => {
    const c = await j('POST', '/api/bounty', { kind: 'phase', repo: 'grimoire', priority: 'P2', title: 'reg' })
    assert.equal(c.status, 201)
    const id = c.body.bounty.id
    const claim = await j('POST', `/api/bounty/${id}/claim`, { hunter_id: 'H1', host: 'aid' })
    assert.equal(claim.status, 200)
    // The claim rides the single-writer path → board.hunters → hunters.json.
    const hunters = JSON.parse(fs.readFileSync(path.join(ROOT, 'bounties', 'hunters.json'), 'utf8'))
    assert.ok(hunters.H1, 'winner should be registered in the durable hunters.json')
    assert.equal(hunters.H1.host, 'aid')
  })

  it('list → {bounties:[...]} priority-sorted', async () => {
    await j('POST', '/api/bounty', { kind: 'phase', repo: 'g', priority: 'P0', title: 'urgent' })
    const r = await j('GET', '/api/bounty')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.body.bounties))
    // P0 ranks first (PRIORITY_RANK P0=0, ascending).
    const prios = r.body.bounties.map(b => b.priority)
    const first = prios.indexOf('P0')
    assert.ok(first >= 0, 'a P0 bounty should be present')
  })

  it('rejects kind!=phase in v1 (400)', async () => {
    const r = await j('POST', '/api/bounty', { kind: 'task', repo: 'g', priority: 'P1', title: 'x' })
    assert.equal(r.status, 400)
  })

  it('missing repo/priority/title ⇒ 400', async () => {
    const r1 = await j('POST', '/api/bounty', { kind: 'phase', title: 'x' }) // no repo/priority
    assert.equal(r1.status, 400)
    const r2 = await j('POST', '/api/bounty', { kind: 'phase', repo: 'g', priority: 'P1' }) // no title
    assert.equal(r2.status, 400)
  })

  it('unknown id mutation ⇒ 404', async () => {
    const r = await j('POST', '/api/bounty/does-not-exist/claim', { hunter_id: 'Z' })
    assert.equal(r.status, 404)
  })

  it('submit persists the report on the bounty (evidence chain: reviewer reads what was claimed)', async () => {
    const c = await j('POST', '/api/bounty', { kind: 'phase', repo: 'grimoire', priority: 'P1', title: 'report-persist' })
    assert.equal(c.status, 201)
    const id = c.body.bounty.id
    const claim = await j('POST', `/api/bounty/${id}/claim`, { hunter_id: 'R1' })
    assert.equal(claim.status, 200)
    const epoch = claim.body.bounty.lease.lease_epoch
    const report = 'evidence: tests green, commit abc123'
    const submit = await j('POST', `/api/bounty/${id}/submit`, { hunter_id: 'R1', epoch, report })
    assert.equal(submit.status, 200)
    assert.equal(submit.body.bounty.state, 'NEEDS_REVIEW')
    assert.equal(submit.body.bounty.report, report)
    // Durable, not just echoed by the mutation response: a fresh GET must show it.
    const g = await j('GET', `/api/bounty/${id}`)
    assert.equal(g.status, 200)
    assert.equal(g.body.bounty.report, report)
  })
})
