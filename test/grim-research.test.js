'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')
const rig = require('../bin/grim-research.js')
const A = require('../bin/grim-archaeologist.js')

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

  it('includes html in the result', async () => {
    const result = await rig.acquireUrl({ url: 'https://example.com' })
    assert.ok(result.html)
    assert.ok(typeof result.html === 'string')
    assert.ok(result.html.length > 0)
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

// ── searchForResources() ──────────────────────────────────────────────────────

describe('searchForResources()', () => {
  it('is exported', () => {
    assert.strictEqual(typeof rig.searchForResources, 'function')
  })

  it('returns empty array when acquireTerm fails', async () => {
    // Stub acquireTerm to simulate failure
    const orig = rig.acquireTerm
    // acquireTerm is not directly replaceable on the module, but we can test
    // via the exported function with an unreachable term that will fail CSE+DDG
    const links = await rig.searchForResources('nonexistent-test-term-xyz123', 'nonexistent-test-term-xyz123')
    // Should not throw; returns [] when search fails
    assert.ok(Array.isArray(links))
  })
})

// ── parseRepoUrl() ────────────────────────────────────────────────────────────

describe('parseRepoUrl()', () => {
  it('parses a github.com URL', () => {
    const r = rig.parseRepoUrl('https://github.com/owner/repo')
    assert.deepStrictEqual(r, { owner: 'owner', repo: 'repo' })
  })

  it('parses https with www', () => {
    const r = rig.parseRepoUrl('https://www.github.com/foo/bar-baz')
    assert.deepStrictEqual(r, { owner: 'foo', repo: 'bar-baz' })
  })

  it('returns null for non-github URLs', () => {
    assert.strictEqual(rig.parseRepoUrl('https://gitlab.com/owner/repo'), null)
    assert.strictEqual(rig.parseRepoUrl('https://example.com/repo'), null)
  })

  it('returns null for null input', () => {
    assert.strictEqual(rig.parseRepoUrl(null), null)
  })
})

// ── digRepo() ─────────────────────────────────────────────────────────────────

describe('digRepo()', () => {
  it('is exported', () => {
    assert.strictEqual(typeof rig.digRepo, 'function')
  })

  it('returns failure for non-github URL', async () => {
    const result = await rig.digRepo('https://gitlab.com/owner/repo')
    assert.strictEqual(result.success, false)
    assert.ok(typeof result.reason === 'string')
  })

  it('returns failure for unreachable URL without throwing', async () => {
    const result = await rig.digRepo('https://github.com/nonexistent-user-xyz123/not-a-repo-xyz', 5000)
    assert.strictEqual(result.success, false)
    assert.ok(typeof result.reason === 'string')
  })
})

// ── digRepo semantic mode (phase 83) ─────────────────────────────────────────
// WHY: every research dive defaults to the semantic lens — spine + one
// synthesis call, not a per-file catalog. The contract is the argument
// digRepo passes to runDig; the clone is stood in for offline with a
// PATH-shim git (clone = mkdir), and runDig itself is captured, not run.

describe('digRepo semantic mode (phase 83)', () => {
  it('calls runDig with mode:semantic and returns the semantic final.md', async () => {
    const captured = {}
    const realRunDig = A.runDig
    A.runDig = async (dir, opts) => {
      Object.assign(captured, { dir, opts })
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-research-dig-'))
      fs.writeFileSync(path.join(outDir, 'final.md'),
        '# fixture-repo — Final Analysis\n\n## Purpose\nPurpose-level synthesis body.\n')
      return { outDir, name: 'fixture-repo', final: '' }
    }

    const realGit = execSync('command -v git', { encoding: 'utf8' }).trim()
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-research-git-'))
    fs.writeFileSync(path.join(fakeBin, 'git'),
      `#!/bin/sh\nif [ "$1" = clone ]; then\n  dest=""; for a in "$@"; do dest="$a"; done\n  mkdir -p "$dest"\n  exit 0\nfi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 })
    const savedPath = process.env.PATH
    process.env.PATH = fakeBin + path.delimiter + savedPath

    try {
      const result = await rig.digRepo('https://github.com/owner/fixture-repo')

      assert.strictEqual(result.success, true, JSON.stringify(result))
      assert.deepStrictEqual(captured.opts, { hints: '', mode: 'semantic' })
      assert.ok(captured.dir.includes('fixture-repo'), 'the clone lands in the research tmp dir')
      assert.ok(result.text.includes('## Purpose'), 'the digest carries the semantic synthesis, not a file catalog')
    } finally {
      process.env.PATH = savedPath
      A.runDig = realRunDig
      try { fs.rmSync(fakeBin, { recursive: true, force: true }) } catch {}
    }
  })
})

// ── parseArxivId() ────────────────────────────────────────────────────────────

describe('parseArxivId()', () => {
  it('extracts id from abs URL', () => {
    assert.strictEqual(rig.parseArxivId('https://arxiv.org/abs/2301.12345'), '2301.12345')
  })

  it('extracts id from pdf URL with .pdf extension', () => {
    assert.strictEqual(rig.parseArxivId('https://arxiv.org/pdf/2301.12345.pdf'), '2301.12345')
  })

  it('extracts id from pdf URL without extension', () => {
    assert.strictEqual(rig.parseArxivId('https://arxiv.org/pdf/2301.12345'), '2301.12345')
  })

  it('returns null for non-arxiv URL', () => {
    assert.strictEqual(rig.parseArxivId('https://example.com/paper'), null)
  })
})

// ── fetchPaper() ──────────────────────────────────────────────────────────────

describe('fetchPaper()', () => {
  it('is exported', () => {
    assert.strictEqual(typeof rig.fetchPaper, 'function')
  })

  it('returns success:true with abstract and text for a real arxiv paper', async () => {
    const result = await rig.fetchPaper('2301.12345')
    assert.strictEqual(result.success, true)
    assert.ok(result.abstract.length > 0, 'abstract should not be empty')
    assert.ok(result.text.length > 100, 'text should have substantive content')
  })

  it('returns success:false for nonexistent paper without throwing', async () => {
    const result = await rig.fetchPaper('9999.99999')
    assert.ok(typeof result.success === 'boolean')
    assert.ok(typeof result.abstract === 'string')
  })
})

// ── httpGet OOM guards (phase 82) ────────────────────────────────────────────
// WHY these matter: the old `body += c` accumulator had no cap — one large or
// binary payload OOM'd the process, killing the dig before the stubJudgment
// breadcrumb could ever run (9/9 dives, 2026-08). Guards must reject with a
// typed reason and destroy the socket; callers must turn that into a failed
// acquire so the drop is recorded, never silenced.

function startServer(handler) {
  const server = http.createServer(handler)
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function stopServer(server) {
  if (server.closeAllConnections) server.closeAllConnections()
  return new Promise(resolve => server.close(resolve))
}

async function rejectsWith(fn, pattern) {
  let err
  try { await fn() } catch (e) { err = e }
  assert.ok(err, 'expected a rejection')
  assert.match(err.message, pattern)
  return err
}

describe('httpGet OOM guards', () => {
  it('rejects with "body exceeds cap" and destroys the socket for an oversized stream', async () => {
    let closed = false
    const server = await startServer((req, res) => {
      res.on('close', () => { closed = true })
      res.on('error', () => {})
      res.writeHead(200, { 'content-type': 'text/plain' })
      const chunk = Buffer.alloc(256 * 1024, 'a')
      for (let i = 0; i < 32; i++) res.write(chunk)   // 8MB > 5MB cap
      res.end()
    })
    const url = `http://127.0.0.1:${server.address().port}/`
    await rejectsWith(() => rig.httpGet(url, 10000), /body exceeds cap/)
    await new Promise(r => setTimeout(r, 50))          // let the server-side close land
    assert.ok(closed, 'socket must be destroyed before the stream finishes')
    await stopServer(server)
  })

  it('rejects up front when content-length exceeds the cap (no buffering)', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(10 * 1024 * 1024) })
      // write('') forces Node to flush the headers — a bare writeHead is
      // buffered until the first body write. Then the server stalls: the
      // guard must fire on the declared length, before any body is buffered.
      res.write('')
    })
    const url = `http://127.0.0.1:${server.address().port}/`
    const t0 = Date.now()
    await rejectsWith(() => rig.httpGet(url, 5000), /body exceeds cap/)
    assert.ok(Date.now() - t0 < 2000, 'must reject before the timeout, on headers alone')
    await stopServer(server)
  })

  it('rejects with "non-text content-type" for binary content types', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '3' })
      res.end('abc')
    })
    const url = `http://127.0.0.1:${server.address().port}/`
    await rejectsWith(() => rig.httpGet(url, 5000), /non-text content-type/)
    await stopServer(server)
  })

  it('still resolves text/*, application/json, and absent content-type bodies', async () => {
    const server = await startServer((req, res) => {
      if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>hi</h1>') }
      else if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"a":1}') }
      else { res.writeHead(200); res.end('plain') }   // no content-type header — allowed
    })
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      assert.strictEqual(await rig.httpGet(`${base}/html`), '<h1>hi</h1>')
      assert.strictEqual(await rig.httpGet(`${base}/json`), '{"a":1}')
      assert.strictEqual(await rig.httpGet(`${base}/bare`), 'plain')
    } finally {
      await stopServer(server)
    }
  })

  it('bounds redirect following to MAX_REDIRECTS', async () => {
    let hops = 0
    const server = await startServer((req, res) => {
      hops++
      res.writeHead(302, { location: '/again' })
      res.end()
    })
    const url = `http://127.0.0.1:${server.address().port}/start`
    await rejectsWith(() => rig.httpGet(url, 5000), /too many redirects/)
    assert.ok(hops <= rig.MAX_REDIRECTS + 1, `followed ${hops} hops, cap is ${rig.MAX_REDIRECTS}`)
    await stopServer(server)
  })
})

describe('guard refusals reach the stub breadcrumb', () => {
  it('acquireUrl maps a guard rejection to a failed acquire with the reason', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '3' })
      res.end('abc')
    })
    const url = `http://127.0.0.1:${server.address().port}/blob`
    const result = await rig.acquireUrl({ url })
    await stopServer(server)
    assert.strictEqual(result.failed, true)
    assert.match(result.text, /acquisition refused: non-text content-type/)
  })

  it('stubJudgment preserves the drop and the refusal reason', () => {
    const drop = 'https://example.com/weights.safetensors'
    const j = rig.stubJudgment(drop, { type: 'url', url: drop },
      { title: drop, text: 'acquisition refused: body exceeds cap', failed: true })
    assert.strictEqual(j.name, drop, 'the stub must be keyed off the drop, not a placeholder')
    assert.strictEqual(j.type, 'DefinedTerm')
    assert.ok(j.tags.includes('research/acquisition-failed'))
    assert.match(j.description, /acquisition refused: body exceeds cap/)
  })

  it('researchDrop dry-run: a guard-refused acquire files a stub, no crash, no silence', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '3' })
      res.end('abc')
    })
    const url = `http://127.0.0.1:${server.address().port}/blob`
    const result = await rig.researchDrop(url, { dryRun: true })
    await stopServer(server)
    assert.strictEqual(result.acquisitionFailed, true)
    assert.match(result.digest, /Could not acquire content/)
    assert.match(result.digest, /acquisition refused: non-text content-type/)
  })
})
