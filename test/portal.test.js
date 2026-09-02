'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')

const {
  Portal, PortalProxy, StripImageFilter, LlavaCaptionFilter, FILTER_REGISTRY,
} = require('../bin/grim-portal.js')

// ── helpers ─────────────────────────────────────────────────────────────────
const listen = (server, port = 0) =>
  new Promise(res => server.listen(port, '127.0.0.1', () => res(server.address().port)))

function postJson(url, obj) {
  const u = new URL(url)
  const payload = JSON.stringify(obj)
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString('utf8')))) })
    req.on('error', reject)
    req.write(payload); req.end()
  })
}

const IMG = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
const hasImage = obj => JSON.stringify(obj).includes('"type":"image"')

// ── StripImageFilter ──────────────────────────────────────────────────────────
describe('StripImageFilter', () => {
  it('matches only image blocks', () => {
    const f = new StripImageFilter({})
    assert.equal(f.matches(IMG), true)
    assert.equal(f.matches({ type: 'text', text: 'x' }), false)
  })
  it('replaces an image with a text stub (WHY: a text-only model errors on image blocks)', async () => {
    const f = new StripImageFilter({ stub: '[X]' })
    assert.deepEqual(await f.apply(IMG), { type: 'text', text: '[X]' })
  })
})

// ── PortalProxy.transform — the load-bearing invariant ──────────────────────────
describe('PortalProxy.transform', () => {
  // WHY this matters: the whole point of the portal is that a text-only model
  // NEVER receives an image block. If any path leaks one through, the model 400s
  // and the session is dead. These encode that intent, not just the mechanics.
  it('strips a top-level image and preserves sibling text', async () => {
    const p = new PortalProxy({})   // default pipeline = [strip]
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, IMG] }] }
    const n = await p.transform(body)
    assert.equal(n, 1)
    assert.equal(hasImage(body), false)
    assert.equal(body.messages[0].content[0].text, 'hi')       // text untouched
  })

  it('strips an image nested inside a tool_result (the real source — a tool returning a screenshot)', async () => {
    const p = new PortalProxy({})
    const body = { messages: [{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'shot:' }, IMG] },
    ] }] }
    const n = await p.transform(body)
    assert.equal(n, 1)
    assert.equal(hasImage(body), false)
    assert.equal(body.messages[0].content[0].content[0].text, 'shot:')
  })

  it('also sweeps the system field', async () => {
    const p = new PortalProxy({})
    const body = { system: [{ type: 'text', text: 's' }, IMG], messages: [] }
    const n = await p.transform(body)
    assert.equal(n, 1)
    assert.equal(hasImage(body), false)
  })

  it('leaves an all-text body completely unchanged (no false positives)', async () => {
    const p = new PortalProxy({})
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'just text' }] }] }
    const before = JSON.stringify(body)
    const n = await p.transform(body)
    assert.equal(n, 0)
    assert.equal(JSON.stringify(body), before)
  })
})

// ── caption filter — fail-open contract ─────────────────────────────────────────
describe('LlavaCaptionFilter', () => {
  // WHY: a flaky/absent vision service must degrade, never break the request.
  it('falls back to the strip stub when the endpoint is unreachable', async () => {
    const f = new LlavaCaptionFilter({ endpoint: 'http://127.0.0.1:1', stub: '[STUB]', timeout: 400 })
    const r = await f.apply(IMG)
    assert.deepEqual(r, { type: 'text', text: '[STUB]' })
  })
  it('falls back to the stub when there is no endpoint at all', async () => {
    const f = new LlavaCaptionFilter({ endpoint: null, stub: '[STUB]' })
    assert.deepEqual(await f.apply(IMG), { type: 'text', text: '[STUB]' })
  })
})

// ── filter registry / selection ────────────────────────────────────────────────
describe('filter selection', () => {
  it('registry knows strip and caption', () => {
    assert.deepEqual(Object.keys(FILTER_REGISTRY).sort(), ['caption', 'strip'])
  })
  it('an unknown PORTAL_FILTERS name fails loud (never silently no-ops)', () => {
    assert.throws(() => new Portal({ PORTAL_HOST: 'box', PORTAL_FILTERS: 'bogus' }), /unknown PORTAL_FILTER 'bogus'/)
  })
  it('default pipeline is a single strip filter', () => {
    const p = new Portal({ PORTAL_HOST: 'box' })
    assert.deepEqual(p.proxy.filters.map(f => f.name), ['strip'])
  })
  it('PORTAL_FILTERS composes a pipeline in order', () => {
    const p = new Portal({ PORTAL_HOST: 'box', PORTAL_FILTERS: 'caption,strip' })
    assert.deepEqual(p.proxy.filters.map(f => f.name), ['caption', 'strip'])
  })
})

// ── upstream resolution precedence (no config lookup when overridden) ────────────
describe('Portal upstream resolution', () => {
  // Expected URLs are built from the input host/port vars — never written as a
  // bare http://host:port literal (the repo bans hostnames in source).
  it('PORTAL_UPSTREAM (full URL) wins over everything', () => {
    const host = 'placeholder-a', port = '1234'
    const up = `http://${host}:${port}`
    const p = new Portal({ PORTAL_UPSTREAM: up, PORTAL_HOST: 'placeholder-b' })
    assert.equal(p.upstream, up)
  })
  it('PORTAL_HOST builds a direct URL with the default llama port, no config lookup', () => {
    const host = 'placeholder-a'
    const p = new Portal({ PORTAL_HOST: host })
    assert.equal(p.upstream, `http://${host}:11311`)
    assert.equal(p.host, host)
  })
  it('PORTAL_UPSTREAM_PORT overrides the upstream port', () => {
    const host = 'placeholder-a', port = '9999'
    const p = new Portal({ PORTAL_HOST: host, PORTAL_UPSTREAM_PORT: port })
    assert.equal(p.upstream, `http://${host}:${port}`)
  })
})

// ── model label cleanup ─────────────────────────────────────────────────────────
describe('Portal.cleanLabel', () => {
  const p = new Portal({ PORTAL_HOST: 'box' })
  it('basenames a gguf path and drops the shard suffix + extension', () => {
    assert.equal(
      p.cleanLabel('/home/vgvm/models/Qwen3.8-Flash-Next-UD-Q2_K_XL-00001-of-00003.gguf'),
      'Qwen3.8-Flash-Next-UD-Q2_K_XL')
  })
  it('leaves an already-clean alias alone', () => {
    assert.equal(p.cleanLabel('Qwen38-27B'), 'Qwen38-27B')
  })
})

// ── argv guard (dispatched via `grim portal` vs direct) ─────────────────────────
describe('claudeArgs argv guard', () => {
  it('drops the "portal" subcommand when dispatched through grim.js', () => {
    const saved = process.argv
    try {
      process.argv = ['node', 'grim.js', 'portal', '--resume']
      assert.deepEqual(new Portal({ PORTAL_HOST: 'box' }).claudeArgs, ['--resume'])
      process.argv = ['node', 'grim-portal.js', '--continue']
      assert.deepEqual(new Portal({ PORTAL_HOST: 'box' }).claudeArgs, ['--continue'])
    } finally { process.argv = saved }
  })
})

// ── end-to-end: image never reaches upstream; non-messages passes through ────────
describe('PortalProxy end-to-end (mock upstream)', () => {
  let upstream, proxy, upPort, pxPort, lastSeen

  before(async () => {
    upstream = http.createServer((req, res) => {
      const c = []; req.on('data', d => c.push(d))
      req.on('end', () => {
        lastSeen = { path: req.url, body: c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : null }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(lastSeen))
      })
    })
    upPort = await listen(upstream)
    proxy = new PortalProxy({ port: 0, upstream: `http://127.0.0.1:${upPort}` })
    pxPort = await new Promise(r => { proxy.start(() => r(proxy.server.address().port)) })
  })
  after(() => { proxy.stop(); upstream.close() })

  it('POST /v1/messages: the image is stripped before it reaches upstream', async () => {
    await postJson(`http://127.0.0.1:${pxPort}/v1/messages`,
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, IMG] }] })
    assert.equal(lastSeen.path, '/v1/messages')
    assert.equal(hasImage(lastSeen.body), false)             // proved on the wire, not just in memory
  })

  it('other paths pass through transparently', async () => {
    const r = await postJson(`http://127.0.0.1:${pxPort}/v1/anything`, { hello: 'world' })
    assert.equal(r.path, '/v1/anything')
    assert.deepEqual(r.body, { hello: 'world' })
  })
})
