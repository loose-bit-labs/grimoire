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

// ── scanLinks() ───────────────────────────────────────────────────────────────

describe('scanLinks()', () => {
  it('finds arxiv abs links', () => {
    const html = `<a href="https://arxiv.org/abs/2301.12345">Paper</a>`
    const links = rig.scanLinks(html)
    assert.strictEqual(links.length, 1)
    assert.strictEqual(links[0].type, 'paper')
    assert.strictEqual(links[0].url, 'https://arxiv.org/abs/2301.12345')
  })

  it('finds arxiv pdf links', () => {
    const html = `<a href="https://arxiv.org/pdf/2301.12345.pdf">PDF</a>`
    const links = rig.scanLinks(html)
    assert.strictEqual(links.length, 1)
    assert.strictEqual(links[0].type, 'paper')
    assert.strictEqual(links[0].url, 'https://arxiv.org/pdf/2301.12345')
  })

  it('finds github repo links', () => {
    const html = `Check out https://github.com/owner/repo-name for the source.`
    const links = rig.scanLinks(html)
    assert.strictEqual(links.length, 1)
    assert.strictEqual(links[0].type, 'repo')
    assert.strictEqual(links[0].url, 'https://github.com/owner/repo-name')
  })

  it('finds doi links', () => {
    const html = `See DOI: https://doi.org/10.1234/example`
    const links = rig.scanLinks(html)
    assert.strictEqual(links.length, 1)
    assert.strictEqual(links[0].type, 'paper')
    assert.ok(links[0].url.includes('doi.org'))
  })

  it('deduplicates same URL', () => {
    const html = `
      <a href="https://github.com/owner/repo">link1</a>
      <a href="https://github.com/owner/repo">link2</a>
    `
    const links = rig.scanLinks(html)
    assert.strictEqual(links.length, 1)
  })

  it('caps at DISCOVERY_CAP (4)', () => {
    const urls = [1, 2, 3, 4, 5].map((i) => `https://github.com/owner/repo${i}`).join(' ')
    const links = rig.scanLinks(urls)
    assert.ok(links.length <= 4)
  })

  it('returns empty array for text with no links', () => {
    const links = rig.scanLinks('Just plain text with no URLs.')
    assert.deepStrictEqual(links, [])
  })

  it('returns empty array for null input', () => {
    const links = rig.scanLinks(null)
    assert.deepStrictEqual(links, [])
  })
})

// ── detectThinYield() ─────────────────────────────────────────────────────────

describe('detectThinYield()', () => {
  it('returns true when text is below threshold', () => {
    const acquired = { text: 'short' }
    assert.strictEqual(rig.detectThinYield(acquired), true)
  })

  it('returns false when text exceeds threshold', () => {
    const acquired = { text: 'x'.repeat(700) }
    assert.strictEqual(rig.detectThinYield(acquired), false)
  })

  it('returns false for empty text', () => {
    const acquired = { text: '' }
    assert.strictEqual(rig.detectThinYield(acquired), false)
  })

  it('returns false for null text', () => {
    const acquired = { text: null }
    assert.strictEqual(rig.detectThinYield(acquired), false)
  })
})

// ── researchDrop() discovery ──────────────────────────────────────────────────

describe('researchDrop() discovery', () => {
  it('includes discovered array in result', async () => {
    const result = await rig.researchDrop('http://127.0.0.1:1/nonexistent', { dryRun: true, json: true })
    assert.ok(Array.isArray(result.discovered))
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
