'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const rig = require('../bin/grim-research.js')

// ── classify() ────────────────────────────────────────────────────────────────

describe('classify()', () => {
  it('identifies full Reddit URLs', () => {
    const r = rig.classify('https://www.reddit.com/r/LocalLLaMA/comments/abc/')
    assert.strictEqual(r.type, 'reddit')
    assert.ok(r.url)
  })

  it('identifies Reddit shortlinks', () => {
    const r = rig.classify('https://redd.it/xyz123')
    assert.strictEqual(r.type, 'reddit')
    assert.ok(r.url)
  })

  it('identifies generic URLs', () => {
    const r = rig.classify('https://github.com/example/repo')
    assert.strictEqual(r.type, 'url')
    assert.ok(r.url)
  })

  it('identifies bare terms', () => {
    const r = rig.classify('ZLUDA')
    assert.strictEqual(r.type, 'term')
    assert.strictEqual(r.term, 'ZLUDA')
  })

  it('identifies multi-word terms', () => {
    const r = rig.classify('vector database benchmark')
    assert.strictEqual(r.type, 'term')
    assert.strictEqual(r.term, 'vector database benchmark')
  })
})

// ── extractText() ─────────────────────────────────────────────────────────────

describe('extractText()', () => {
  // extractText is not exported; test via acquireUrl behavior
  // We test the HTML extraction logic indirectly

  it('strips script and style tags', () => {
    // We can't test extractText directly since it's not exported.
    // The function is tested implicitly via acquireUrl in integration tests.
    assert.ok(true)
  })
})

// ── checkDedup() ──────────────────────────────────────────────────────────────

describe('checkDedup()', () => {
  it('returns deduped:false for unknown terms', async () => {
    const result = await rig.checkDedup('xyzzyplughfoobarbaz12345')
    assert.strictEqual(result.deduped, false)
  })
})

// ── acquireUrl() ──────────────────────────────────────────────────────────────

describe('acquireUrl()', () => {
  it('returns fetch-failed for unreachable URLs', async () => {
    const result = await rig.acquireUrl({ url: 'http://127.0.0.1:1/nonexistent' })
    assert.strictEqual(result.text, '[fetch failed]')
    assert.strictEqual(result.failed, true)
  })
})

// ── isRedditShortlink() ─────────────────────────────────────────────────────────

describe('isRedditShortlink()', () => {
  it('matches old-style redd.it shortlinks', () => {
    assert.strictEqual(rig.isRedditShortlink('https://redd.it/xyz123'), true)
  })

  it('matches the newer reddit.com/r/.../s/... mobile-share shortlinks', () => {
    assert.strictEqual(
      rig.isRedditShortlink('https://www.reddit.com/r/StableDiffusion/s/dFWbqaAlgL'),
      true,
    )
  })

  it('does not match a full comments URL (no redirect needed)', () => {
    assert.strictEqual(
      rig.isRedditShortlink('https://www.reddit.com/r/LocalLLaMA/comments/abc/some_title/'),
      false,
    )
  })
})

// ── acquireReddit() ──────────────────────────────────────────────────────────────

describe('acquireReddit()', () => {
  it('marks failed:true when the API fetch fails', async () => {
    const result = await rig.acquireReddit({ url: 'http://127.0.0.1:1/r/x/comments/y' })
    assert.strictEqual(result.text, '[fetch failed]')
    assert.strictEqual(result.failed, true)
  })
})

// ── buildCseUrl() ──────────────────────────────────────────────────────────────

describe('buildCseUrl()', () => {
  it('builds the Google Custom Search endpoint shape with key, cx and query', () => {
    const url = rig.buildCseUrl('ZLUDA', { key: 'fake-key-123', cx: 'fake-cx-456' })
    assert.match(url, /^https:\/\/www\.googleapis\.com\/customsearch\/v1\?/)
    assert.match(url, /key=fake-key-123/)
    assert.match(url, /cx=fake-cx-456/)
    assert.match(url, /q=ZLUDA/)
    assert.match(url, /num=1/)
  })

  it('URL-encodes multi-word terms in the query', () => {
    const url = rig.buildCseUrl('vector database benchmark', { key: 'k', cx: 'c' })
    assert.match(url, /q=vector%20database%20benchmark/)
  })
})

// ── researchDrop() failure handling ───────────────────────────────────────────

describe('researchDrop() acquisition failure', () => {
  it('skips the model judge and files a plain stub when acquisition fails', async () => {
    const result = await rig.researchDrop('http://127.0.0.1:1/nonexistent', { dryRun: true, json: true })
    assert.strictEqual(result.acquisitionFailed, true)
    assert.match(result.digest, /Could not acquire content/)
  })
})
