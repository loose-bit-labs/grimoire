'use strict'

/**
 * test/model-ask.test.js — call-time endpoint resolution + resolveModel floor (phase 87)
 *
 * Regression target: the 2026-08-28 research-drain OOM. aid's
 * ~/.config/lbl-config.json had decayed to a 2-key stub; model-ask's private
 * reader (no fallback) froze CODING_BASE = null at module load, text tasks
 * fell to a text-model-less Ollama, and the unguarded resolveModel('default')
 * recursion ran until V8 FATAL. What must hold now:
 *   - a stub cache cannot hide the repo floor's use.coding → meinherz:11311
 *   - ask() resolves endpoints per call — no refreshEndpoints() required
 *   - an env var still beats both cache and floor
 *   - resolveModel terminates when every installed model scores 0, yet still
 *     returns the installed default model when one scores (mage's case #0404)
 *
 * Isolation:
 *   - LBL_CACHE_PATH / LBL_META_PATH / LOCAL_CONFIG_PATH → per-test temp files
 *   - os.tmpdir()/grimoire-models-cache.json → backed up / restored per test so
 *     getInstalledModels() sees exactly the installed set being asserted
 *   - require.cache purged for bin/model-ask per test (module-load state:
 *     STATIC_FALLBACK, _memCache, .env bootstrap)
 *   - axios.get/post stubbed — an unrouted URL throws; no test may hit the network
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const axios = require('axios')

// ── fixtures ─────────────────────────────────────────────────────────────────

// The decayed stub, as found on aid 2026-08-28.
const STUB_CACHE = { use: { grimoire: 'grimoire' }, endpoints: { grimoire: 'http://stub:3663' } }  // nohost — test fixture
// The repo floor: what config/lbl-config.json defines for the two routing keys.
const FLOOR = {
  use:       { coding: 'mh_llama', ollama: 'chonko_ollama' },
  endpoints: { mh_llama: 'http://meinherz:11311', chonko_ollama: 'http://chonko:11434' },  // nohost — test fixture
}

const MODELS_CACHE = path.join(os.tmpdir(), 'grimoire-models-cache.json')

function makeTestEnv() {
  const dir = path.join(os.tmpdir(), 'grim-p87-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  const cache = path.join(dir, 'lbl-config.json')
  const meta  = path.join(dir, 'lbl-config.json.meta')
  const floor = path.join(dir, 'floor-lbl-config.json')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cache, JSON.stringify(STUB_CACHE, null, 2) + '\n')
  fs.writeFileSync(floor, JSON.stringify(FLOOR, null, 2) + '\n')
  return { dir,
    setEnv() {
      process.env.LBL_CACHE_PATH = cache
      process.env.LBL_META_PATH  = meta
      process.env.LOCAL_CONFIG_PATH = floor
    },
    cleanup() { try { fs.rmSync(this.dir, { recursive: true, force: true }) } catch {} }
  }
}

function setInstalled(models) {
  let backup = null
  try { backup = fs.readFileSync(MODELS_CACHE, 'utf8') } catch {}
  fs.writeFileSync(MODELS_CACHE, JSON.stringify({ time: Date.now(), models }))
  return function restore() {
    if (backup === null) { try { fs.unlinkSync(MODELS_CACHE) } catch {} }
    else fs.writeFileSync(MODELS_CACHE, backup)
  }
}

/** Stub axios.get/post. An unrouted URL throws — network is impossible in tests. */
function stubAxios(routes = {}) {
  const calls = []
  const origGet = axios.get, origPost = axios.post
  const match = (url) => {
    for (const [key, resp] of Object.entries(routes)) {
      if (url.endsWith(key)) return resp
    }
    throw new Error(`stubAxios: unrouted URL ${url} — network is impossible in tests`)
  }
  axios.get  = async (url) => { calls.push(['get', url]);  return match(url) }
  axios.post = async (url) => { calls.push(['post', url]); return match(url) }
  return { calls,
    urls: (method) => calls.filter(([m]) => !method || m === method).map(([, u]) => u),
    restore() { axios.get = origGet; axios.post = origPost } }
}

/** Fresh module against the current env: rebuilds STATIC_FALLBACK, clears _memCache. */
function freshModelAsk() {
  delete require.cache[require.resolve('../bin/model-ask')]
  return require('../bin/model-ask')
}

/**
 * The .env bootstrap (env.js + model-ask) can (re)set OLLAMA_HOST /
 * LLM_CODING_HOST at require time — scrub after the require so the test
 * controls the resolution inputs.
 */
function scrubEnv() {
  delete process.env.OLLAMA_HOST
  delete process.env.LLM_CODING_HOST
}

const ENV_KEYS = ['LBL_CACHE_PATH', 'LBL_META_PATH', 'LOCAL_CONFIG_PATH', 'OLLAMA_HOST', 'LLM_CODING_HOST']
async function withEnv(apply, fn) {
  const saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  apply()
  try { return await fn() }
  finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

// ── ask() endpoint resolution ─────────────────────────────────────────────────

describe('ask() endpoint resolution (phase 87)', () => {
  it('routes a text task to the floor coding base — no refreshEndpoints() call', async () => {
    const env = makeTestEnv()
    await withEnv(() => env.setEnv(), async () => {
      const m = freshModelAsk()
      scrubEnv()
      const ax = stubAxios({
        'http://meinherz:11311/v1/models':           { data: { data: [{ id: 'mh-test-model' }] } },  // nohost — test fixture
        'http://meinherz:11311/v1/chat/completions': { data: { choices: [{ message: { content: 'ok' } }] } },  // nohost — test fixture
      })
      try {
        const out = await m.ask({ prompt: 'hello', task: 'extraction' })
        assert.strictEqual(out, 'ok')
        assert.deepStrictEqual(ax.urls('get'),  ['http://meinherz:11311/v1/models'])  // nohost — test fixture
        assert.deepStrictEqual(ax.urls('post'), ['http://meinherz:11311/v1/chat/completions'])  // nohost — test fixture
        assert.ok(!ax.urls().some(u => u.includes('/api/')), 'must not fall to the Ollama branch')
        assert.ok(!ax.urls().some(u => u.includes('/config/lbl')), 'must work without refreshEndpoints()')
      } finally { ax.restore() }
    })
    env.cleanup()
  })

  it('an env var override still wins over cache and floor', async () => {
    const env = makeTestEnv()
    await withEnv(() => env.setEnv(), async () => {
      const m = freshModelAsk()
      scrubEnv()
      process.env.LLM_CODING_HOST = 'http://override:1234'  // nohost — test fixture
      const ax = stubAxios({
        'http://override:1234/v1/models':           { data: { data: [{ id: 'ov-model' }] } },  // nohost — test fixture
        'http://override:1234/v1/chat/completions': { data: { choices: [{ message: { content: 'ov-ok' } }] } },  // nohost — test fixture
      })
      try {
        const out = await m.ask({ prompt: 'hello', task: 'linking' })
        assert.strictEqual(out, 'ov-ok')
        assert.deepStrictEqual(ax.urls('get'), ['http://override:1234/v1/models'])  // nohost — test fixture
      } finally { ax.restore() }
    })
    env.cleanup()
  })

  it('Ollama tasks resolve the floor ollama base at call time', async () => {
    const env = makeTestEnv()
    let restoreInstalled = null
    await withEnv(() => env.setEnv(), async () => {
      restoreInstalled = setInstalled(['llava:latest'])
      const m = freshModelAsk()
      scrubEnv()
      const ax = stubAxios({
        'http://chonko:11434/api/ps':       { data: { models: [] } },  // nohost — test fixture
        'http://chonko:11434/api/generate': { data: { response: 'img-ok' } },  // nohost — test fixture
      })
      try {
        const out = await m.ask({ prompt: 'describe', task: 'vision' })
        assert.strictEqual(out, 'img-ok')
        assert.deepStrictEqual(ax.urls('get'),  ['http://chonko:11434/api/ps'])  // nohost — test fixture
        assert.deepStrictEqual(ax.urls('post'), ['http://chonko:11434/api/generate'])  // nohost — test fixture
      } finally { ax.restore() }
    })
    if (restoreInstalled) restoreInstalled()
    env.cleanup()
  })
})

// ── resolveModel floor ────────────────────────────────────────────────────────

describe('resolveModel() floor (phase 87)', () => {
  it('terminates when every installed model scores 0 — the drain OOM regression', async () => {
    const env = makeTestEnv()
    let restoreInstalled = null
    await withEnv(() => env.setEnv(), async () => {
      // chonko's actual installed set: vision + embedding only, both score 0
      // for every text task (including 'default').
      restoreInstalled = setInstalled(['llava:latest', 'nomic-embed-text:latest'])
      const m = freshModelAsk()
      scrubEnv()
      const ax = stubAxios({})   // any network attempt fails the test
      try {
        const t0 = Date.now()
        const r = await m.resolveModel('extraction')
        const elapsed = Date.now() - t0
        assert.ok(elapsed < 5000, `must terminate quickly (took ${elapsed}ms) — the old guard recursed until OOM`)
        // Floor has no models section → STATIC_FALLBACK.default's literal.
        assert.strictEqual(r.model, 'gemma4:26b')
        assert.strictEqual(ax.calls.length, 0, 'served from the models-cache file — no network')
      } finally { ax.restore() }
    })
    if (restoreInstalled) restoreInstalled()
    env.cleanup()
  })

  it('a scoring installed default model still wins over the static table', async () => {
    const env = makeTestEnv()
    let restoreInstalled = null
    await withEnv(() => env.setEnv(), async () => {
      // qwen3.5:27b scores 0 for extraction (no extraction key) but 7 for
      // default — the guard must degrade minimally: one recursion, and the
      // installed model wins, not STATIC_FALLBACK.default.
      restoreInstalled = setInstalled(['qwen3.5:27b'])
      const m = freshModelAsk()
      scrubEnv()
      const ax = stubAxios({})
      try {
        const r = await m.resolveModel('extraction')
        assert.strictEqual(r.model, 'qwen3.5:27b', 'installed model — not the static-table entry')
        assert.strictEqual(r.thinking, true)
        assert.strictEqual(r.score, 7)
        assert.strictEqual(ax.calls.length, 0)
      } finally { ax.restore() }
    })
    if (restoreInstalled) restoreInstalled()
    env.cleanup()
  })
})
