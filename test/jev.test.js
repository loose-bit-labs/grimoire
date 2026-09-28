'use strict'

/**
 * jev.test.js — phase 93: lib/jev.js (askJev) + bin/grim-jev.js (`grim jev ask`).
 * WHY these matter: this client reads a real API key from disk and sends it
 * to a real external service — a swallowed missing-key error would silently
 * ask with `Bearer undefined`, and a swallowed non-ok response would hide a
 * bad judgment behind a truthy-looking resolved promise. fetch is mocked
 * (no real network call); the key file is a temp fixture, never the user's
 * real keys.json.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs   = require('node:fs')
const os   = require('node:os')
const path = require('node:path')

const { askJev } = require('../lib/jev')
const { main: jevMain } = require('../bin/grim-jev')

function tmpKeysFile(contents) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-keys-')), 'keys.json')
  fs.writeFileSync(p, JSON.stringify(contents))
  return p
}

describe('askJev', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('throws a clear, named error when keys.json has no typesafe field', async () => {
    const keysPath = tmpKeysFile({ gemini: 'unrelated' })
    global.fetch = async () => { throw new Error('should not be called') }
    await assert.rejects(
      () => askJev({ a: 1 }, { q: {} }, { keysPath }),
      /jev: no 'typesafe' field/
    )
  })

  it('throws a clear error when the keys file itself is missing', async () => {
    global.fetch = async () => { throw new Error('should not be called') }
    await assert.rejects(
      () => askJev({}, {}, { keysPath: '/nonexistent/keys.json' }),
      /jev: could not read keys file/
    )
  })

  it('throws on a non-ok response, with the truncated body in the message', async () => {
    const keysPath = tmpKeysFile({ typesafe: 'test-key' })
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'x'.repeat(400),
    })
    await assert.rejects(
      async () => askJev({}, {}, { keysPath }),
      (err) => {
        assert.match(err.message, /^typesafe 500: x+$/)
        assert.equal(err.message.length, 'typesafe 500: '.length + 300)
        return true
      }
    )
  })

  it('POSTs {state, model, questions} with a Bearer auth header and returns the parsed JSON', async () => {
    const keysPath = tmpKeysFile({ typesafe: 'secret-key' })
    let seen
    global.fetch = async (url, opts) => {
      seen = { url, opts }
      return { ok: true, json: async () => ({ answers: { yes: true }, usage: { tokens: 42 } }) }
    }
    const out = await askJev({ s: 1 }, { q: {} }, { keysPath })
    assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone')
    assert.equal(seen.opts.headers.Authorization, 'Bearer secret-key')
    assert.deepStrictEqual(JSON.parse(seen.opts.body), { state: { s: 1 }, model: 'jev-latest', questions: { q: {} } })
    assert.deepStrictEqual(out, { answers: { yes: true }, usage: { tokens: 42 } })
  })
})

describe('grim jev ask (bin/grim-jev.js)', () => {
  it('writes the artifact file and prints answers to stdout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-cli-'))
    const inputPath = path.join(dir, 'input.json')
    fs.writeFileSync(inputPath, JSON.stringify({ state: { s: 1 }, questions: { q: {} } }))
    const outPath = path.join(dir, 'out.json')

    const fakeResponse = { answers: { verdict: 'yes' }, usage: { tokens: 7 } }
    let askCalledWith
    const fakeAsk = async (state, questions, opts) => {
      askCalledWith = { state, questions, opts }
      return fakeResponse
    }

    let stdout = ''
    let stderr = ''
    const origLog = console.log
    const origErr = console.error
    console.log = (s) => { stdout += s + '\n' }
    console.error = (s) => { stderr += s + '\n' }
    try {
      await jevMain(['ask', inputPath, '--out', outPath], { ask: fakeAsk })
    } finally {
      console.log = origLog
      console.error = origErr
    }

    assert.deepStrictEqual(askCalledWith.state, { s: 1 })
    assert.ok(fs.existsSync(outPath), 'artifact file was written')
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')), fakeResponse)
    assert.match(stdout, /"verdict": "yes"/)
    assert.match(stderr, /usage:.*tokens.*7/)
  })

  it('usage on no/unknown verb, exit non-zero', () => {
    const { spawnSync } = require('node:child_process')
    const CLI = path.join(__dirname, '..', 'bin', 'grim-jev.js')
    const none = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
    assert.equal(none.status, 1)
    assert.match(none.stderr, /usage:/)
  })
})
