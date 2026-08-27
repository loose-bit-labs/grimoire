'use strict'

/**
 * test/research-queue.test.js — phase 84: durable pending → researched queue
 *
 * WHY these invariants matter: dives used to live in in-memory Maps tied to a
 * front-end's process lifetime — the 2026-08-11 outage lost every request
 * with no trace. The queue must (1) survive process death, (2) always end
 * terminal (nothing stuck pending after a drain), (3) lose no update under
 * concurrent submit + worker, (4) dedup re-submits of a still-pending drop.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const RQ = require('../lib/research-queue')
const rig = require('../bin/grim-research.js')

const mktmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grim-rq-'))

// ── Durability ───────────────────────────────────────────────────────────────

describe('durability — state on disk, not in a Map', () => {
  it('a FRESH PROCESS still sees a submitted entry as pending', async () => {
    const root = mktmp()
    const { id } = await RQ.submit(root, { drop: 'https://example.com/durable' })

    // Simulate the writer process exiting: run list in a child node process
    // that shares nothing but the file — no in-memory Map can carry the entry.
    const out = execFileSync(process.execPath, ['-e',
      `const RQ=require(${JSON.stringify(require.resolve('../lib/research-queue'))});` +
      `const l=RQ.list(${JSON.stringify(root)},{status:'pending'});` +
      `console.log(l.length + ':' + (l[0] ? l[0].id : 'none'))`,
    ], { encoding: 'utf8' }).trim()

    assert.strictEqual(out, `1:${id}`, 'the fresh process reads the entry from disk')
  })
})

// ── Entry shape ──────────────────────────────────────────────────────────────

describe('submit entry shape', () => {
  it('a pending entry carries the full shape and an opaque replyTarget', async () => {
    const root = mktmp()
    const rt = { kind: 'discord-dm', channelId: 'c1', userId: 'u1' }
    const { entry } = await RQ.submit(root, { drop: 'https://example.com/shape', replyTarget: rt })

    assert.strictEqual(entry.status, 'pending')
    assert.strictEqual(entry.drop, 'https://example.com/shape')
    assert.deepStrictEqual(entry.replyTarget, rt, 'the queue stores it, never interprets it')
    assert.ok(entry.id && entry.submittedAt)
    assert.strictEqual(entry.startedAt, null)
    assert.strictEqual(entry.finishedAt, null)
    assert.strictEqual(entry.result, null)
    assert.strictEqual(entry.error, null)
  })
})

// ── Terminal always ──────────────────────────────────────────────────────────

describe('terminal always — never stuck pending', () => {
  it('success → researched with result + finishedAt, pending drained', async () => {
    const root = mktmp()
    const { id } = await RQ.submit(root, { drop: 'https://example.com/ok' })
    const claimed = await RQ.claimNext(root)
    assert.strictEqual(claimed.id, id)
    assert.ok(claimed.startedAt, 'claim stamps startedAt')

    const result = { digest: 'd', entityId: 'ent_1', acquisitionFailed: false, deduped: false }
    const done = await RQ.complete(root, id, { result })
    assert.strictEqual(done.status, 'researched')
    assert.ok(done.finishedAt)
    assert.deepStrictEqual(done.result, result)
    assert.strictEqual(RQ.list(root, { status: 'pending' }).length, 0)
  })

  it('throw → failed with the error, pending drained', async () => {
    const root = mktmp()
    const { id } = await RQ.submit(root, { drop: 'https://example.com/boom' })
    await RQ.claimNext(root)

    const done = await RQ.fail(root, id, { error: 'model is on vacation' })
    assert.strictEqual(done.status, 'failed')
    assert.strictEqual(done.error, 'model is on vacation')
    assert.ok(done.finishedAt)
    assert.strictEqual(RQ.list(root, { status: 'pending' }).length, 0)
  })

  it('refuses to rewrite a terminal entry (complete after complete rejects)', async () => {
    const root = mktmp()
    const { id } = await RQ.submit(root, { drop: 'https://example.com/once' })
    await RQ.claimNext(root)
    await RQ.complete(root, id, { result: null })
    await assert.rejects(RQ.complete(root, id, { result: null }), /not pending/)
  })

  it('rejects completing an unknown id', async () => {
    const root = mktmp()
    await assert.rejects(RQ.complete(root, 'deadbeef0000', { result: null }), /no entry/)
  })
})

// ── Worker (drainQueue) ──────────────────────────────────────────────────────

describe('drainQueue — the worker is always terminal', () => {
  it('good drop → researched + result; throwing drop → failed + error; nothing left pending', async () => {
    const root = mktmp()
    await RQ.submit(root, { drop: 'https://example.com/good' })
    await RQ.submit(root, { drop: 'https://example.com/bad' })

    const calls = []
    const research = async (drop, opts) => {
      calls.push({ drop, opts })
      if (drop.endsWith('/bad')) throw new Error('model is on vacation')
      return { digest: 'fine', entityId: 'ent_1', acquisitionFailed: false, deduped: false }
    }
    const n = await rig.drainQueue(root, { research })

    assert.strictEqual(n, 2)
    const researched = RQ.list(root, { status: 'researched' })
    const failed = RQ.list(root, { status: 'failed' })
    assert.strictEqual(researched.length, 1)
    assert.strictEqual(researched[0].result.digest, 'fine')
    assert.strictEqual(researched[0].result.entityId, 'ent_1')
    assert.strictEqual(failed.length, 1)
    assert.strictEqual(failed[0].error, 'model is on vacation')
    assert.strictEqual(RQ.list(root, { status: 'pending' }).length, 0, 'never stuck pending after a drain')
    // the worker runs dives with no wall clock (phase 68's timeout: 0)
    for (const c of calls) assert.strictEqual(c.opts.timeout, 0)
  })

  it('drain --once processes exactly one entry, leaves the rest pending', async () => {
    const root = mktmp()
    for (let i = 0; i < 3; i++) await RQ.submit(root, { drop: `https://example.com/x${i}` })

    const n = await rig.drainQueue(root, { once: true, research: async () => ({ digest: 'd' }) })

    assert.strictEqual(n, 1)
    assert.strictEqual(RQ.list(root, { status: 'researched' }).length, 1)
    assert.strictEqual(RQ.list(root, { status: 'pending' }).length, 2)
  })

  it('an empty queue drains to zero without spinning', async () => {
    const root = mktmp()
    assert.strictEqual(await rig.drainQueue(root, { research: async () => ({ digest: 'd' }) }), 0)
  })
})

// ── Serial + no lost update ──────────────────────────────────────────────────

describe('serial + no lost update', () => {
  it('5 concurrent submits all land (chained mutate, bounty-store pattern)', async () => {
    const root = mktmp()
    const urls = [...Array(5)].map((_, i) => `https://example.com/c${i}`)

    const results = await Promise.all(urls.map(u => RQ.submit(root, { drop: u })))

    assert.strictEqual(new Set(results.map(r => r.id)).size, 5, 'every submit landed, none lost')
    assert.strictEqual(RQ.list(root, { status: 'pending' }).length, 5)
  })

  it('oldest pending first; FIFO advances as entries go terminal', async () => {
    const root = mktmp()
    for (let i = 0; i < 3; i++) await RQ.submit(root, { drop: `https://example.com/f${i}` })

    const first = await RQ.claimNext(root)
    assert.ok(first.startedAt, 'claim stamps startedAt')
    assert.strictEqual(first.drop, 'https://example.com/f0', 'oldest submitted is claimed first')
    // A claim is not terminal: with no terminal in between, the next claim
    // re-claims the same in-flight entry (at-least-once after a crash)
    assert.strictEqual((await RQ.claimNext(root)).id, first.id)
    await RQ.complete(root, first.id, { result: null })

    const f1 = await RQ.claimNext(root)
    assert.strictEqual(f1.drop, 'https://example.com/f1', 'FIFO advances once the older entry is terminal')
    await RQ.fail(root, f1.id, { error: 'nope' })

    const f2 = await RQ.claimNext(root)
    assert.strictEqual(f2.drop, 'https://example.com/f2')
    await RQ.complete(root, f2.id, { result: null })

    assert.strictEqual(await RQ.claimNext(root), null, 'empty once all entries are terminal')
  })
})

// ── Dedup ────────────────────────────────────────────────────────────────────

describe('dedup', () => {
  it('the same URL twice while pending → one entry, same id', async () => {
    const root = mktmp()
    const a = await RQ.submit(root, { drop: 'https://example.com/dup' })
    const b = await RQ.submit(root, { drop: 'https://example.com/dup' })

    assert.strictEqual(b.id, a.id)
    assert.strictEqual(b.duplicate, true)
    assert.strictEqual(a.duplicate, false)
    assert.strictEqual(RQ.list(root).length, 1, 'no double entry')
  })

  it('a researched entry outside the dedup window can be re-requested', async () => {
    const root = mktmp()
    const { id } = await RQ.submit(root, { drop: 'https://example.com/again' })
    await RQ.claimNext(root)
    await RQ.complete(root, id, { result: null })

    // Age the entry past DEDUP_WINDOW_MS — a re-request is legitimate now.
    const file = RQ.paths(root).file
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    data.entries[0].submittedAt = new Date(Date.now() - (RQ.DEDUP_WINDOW_MS + 60000)).toISOString()
    fs.writeFileSync(file, JSON.stringify(data, null, 2))

    const again = await RQ.submit(root, { drop: 'https://example.com/again' })
    assert.strictEqual(again.duplicate, false)
    assert.strictEqual(RQ.list(root).length, 2)
  })
})

// ── list guards ──────────────────────────────────────────────────────────────

describe('list', () => {
  it('rejects an unknown status instead of filtering on it silently', () => {
    const root = mktmp()
    assert.throws(() => RQ.list(root, { status: 'bogus' }), /unknown status/)
  })
})
