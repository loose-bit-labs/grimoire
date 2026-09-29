'use strict'

/**
 * bounty-cli.test.js — phase 76: grim bounty CLI (bin/grim-bounty.js). WHY
 * these matter: the CLI is a thin HTTP client over the phase-74 routes — a
 * stale register path (the master plan's /api/bounty/register) or a wrong
 * config field (lib/env has no config.endpoints key; it's config.host)
 * breaks every verb, so the register path and the baseUrl source are
 * asserted in-test (port-0 stub, recorded request path), not by eyeballing.
 * The watch/usage checks spawn the CLI as a child: a deferred watch that
 * hangs or a usage path that doesn't exit non-zero is a regression, and
 * process.exit can't be tested in-process.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')

const CLI = path.join(__dirname, '..', 'bin', 'grim-bounty.js')

let C, server, recordedPath, recordedBody
before(async () => {
  // Port-0 stub: records the request path (the register-path check) and the
  // JSON body (the submit --file content check). The CLI resolves the server
  // via lib/env config.host, captured at lib/env load — so GRIMOIRE_HOST must
  // be set BEFORE requiring the CLI. Trailing slash included: proves
  // baseUrl() trims it.
  server = http.createServer((req, res) => {
    recordedPath = req.url
    let data = ''
    req.on('data', c => data += c)
    req.on('end', () => { if (data) recordedBody = JSON.parse(data) })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise(r => server.listen(0, r))
  process.env.GRIMOIRE_HOST = `http://127.0.0.1:${server.address().port}/`
  process.env.CLAUDE_CODE_SESSION_ID = 'test-hunter'
  C = require('../bin/grim-bounty')
})
after(() => server.close())

describe('grim-bounty CLI', () => {
  it('baseUrl() is config.host with the trailing slash trimmed', () => {
    assert.equal(C.baseUrl(), `http://127.0.0.1:${server.address().port}`)
  })

  it('resolveHunterId prefers --as, then env; neither → friendly throw', () => {
    assert.equal(C.resolveHunterId({ as: 'zed' }), 'zed')
    assert.equal(C.resolveHunterId({}), 'test-hunter')
    const saved = process.env.CLAUDE_CODE_SESSION_ID
    delete process.env.CLAUDE_CODE_SESSION_ID
    try {
      assert.throws(() => C.resolveHunterId({}), /no hunter id/)
    } finally {
      process.env.CLAUDE_CODE_SESSION_ID = saved
    }
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

  it('register POSTs /api/bounty/<hunter>/register (shipped route, not the master plan path)', async () => {
    await C.main(['register'])
    assert.equal(recordedPath, '/api/bounty/test-hunter/register')
  })

  it('submit --file sends the file CONTENT as report (not the path string)', async () => {
    // The board's no-self-approval invariant needs the report to survive on
    // the bounty; a CLI that ships the path string instead of the content
    // leaves the reviewer with a dangling reference to a hunter-local file.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-bsub-'))
    const reportPath = path.join(tmp, 'report.md')
    const content = '# hunter-beta report\n\nphase 96 evidence: tests green, commit abc123\n'
    fs.writeFileSync(reportPath, content)
    try {
      await C.main(['submit', 'b-x', '--epoch', '1', '--file', reportPath])
      assert.equal(recordedPath, '/api/bounty/b-x/submit')
      assert.ok(recordedBody, 'a JSON body was sent')
      assert.equal(recordedBody.report, content)
      assert.notEqual(recordedBody.report, reportPath)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('no/unknown verb → usage on stderr, exit non-zero', () => {
    const none = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
    assert.equal(none.status, 1)
    assert.match(none.stderr, /usage:/)
    const bogus = spawnSync(process.execPath, [CLI, 'bogus'], { encoding: 'utf8' })
    assert.equal(bogus.status, 1)
    assert.match(bogus.stderr, /usage:/)
    // Via the dispatcher, bin/grim.js prepends the command name — a CLI that
    // can't strip it fails EVERY verb with usage.
    const GRIM = path.join(__dirname, '..', 'bin', 'grim.js')
    const noVerb = spawnSync(process.execPath, [GRIM, 'bounty'], { encoding: 'utf8' })
    assert.equal(noVerb.status, 1)
    assert.match(noVerb.stderr, /usage:/)
  })

  it('watch → deferred error, exit non-zero (no hang, no poll loop)', () => {
    const direct = spawnSync(process.execPath, [CLI, 'watch'], { encoding: 'utf8' })
    assert.equal(direct.status, 1)
    assert.match(direct.stderr, /deferred/)
    const GRIM = path.join(__dirname, '..', 'bin', 'grim.js')
    const viaDispatcher = spawnSync(process.execPath, [GRIM, 'bounty', 'watch'], { encoding: 'utf8' })
    assert.equal(viaDispatcher.status, 1)
    assert.match(viaDispatcher.stderr, /deferred/)
  })
})
