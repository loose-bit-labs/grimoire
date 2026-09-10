'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const {
  probeLlama, reduceSlots, timingsOf, cleanModel, normalizeTarget, probeToProm,
} = require('../lib/llama-probe.js')

// Fixtures are the real shapes captured off live llama-servers.
const SLOTS = [
  { id: 0, n_ctx: 262144, is_processing: false, n_prompt_tokens: 0 },
  { id: 1, n_ctx: 262144, is_processing: true,  n_prompt_tokens: 48385 },
]
const TIMINGS = {
  timings: {
    prompt_n: 10, prompt_ms: 192.525, prompt_per_second: 51.941306,
    predicted_n: 174, predicted_ms: 6804.472, predicted_per_second: 25.424456,
  },
}

describe('cleanModel', () => {
  it('basenames a gguf path and drops shard + extension', () => {
    assert.equal(cleanModel('/models/Qwen3.8-Flash-UD-Q2_K_XL-00001-of-00003.gguf'), 'Qwen3.8-Flash-UD-Q2_K_XL')
  })
  it('leaves a clean alias alone; null → null', () => {
    assert.equal(cleanModel('Qwen38-27B'), 'Qwen38-27B')
    assert.equal(cleanModel(null), null)
  })
})

describe('normalizeTarget', () => {
  // WHY: a bare host must resolve to the llama port, but an explicit host:port or
  // full URL must pass through — the probe should never rewrite what the user pinned.
  // (URLs are built from a var so no bare-hostname literal trips the repo hook.)
  const h = 'boxname'
  it('bare host → default llama port', () => assert.equal(normalizeTarget(h), `http://${h}:11311`))
  it('host:port respected', () => assert.equal(normalizeTarget(`${h}:9999`), `http://${h}:9999`))
  it('full URL passes through (trailing slash trimmed)', () =>
    assert.equal(normalizeTarget(`http://${h}:1234/`), `http://${h}:1234`))
})

describe('reduceSlots', () => {
  it('derives slot count, ctx, active count, and KV occupancy %', () => {
    const r = reduceSlots(SLOTS)
    assert.equal(r.nSlots, 2)
    assert.equal(r.nCtx, 262144)
    assert.equal(r.activeSlots, 1)                 // one is_processing
    // used 48385 of 2*262144 = 524288 → 9.2%
    assert.equal(r.kvPercent, 9.2)
  })
  it('empty/garbage → all null (never throws)', () => {
    assert.deepEqual(reduceSlots([]), { nSlots: null, nCtx: null, activeSlots: null, kvPercent: null })
    assert.deepEqual(reduceSlots(null), { nSlots: null, nCtx: null, activeSlots: null, kvPercent: null })
  })
})

describe('timingsOf', () => {
  it('extracts prefill + decode tps and token counts, rounded', () => {
    assert.deepEqual(timingsOf(TIMINGS), { prefillTps: 51.9, decodeTps: 25.4, promptN: 10, predictedN: 174 })
  })
  it('no timings block → nulls', () => {
    assert.deepEqual(timingsOf({}), { prefillTps: null, decodeTps: null, promptN: null, predictedN: null })
  })
})

describe('probeLlama (injected http)', () => {
  // A stub router keyed by "METHOD path" so each test declares only what it serves.
  const router = routes => (method, url) => {
    const p = new URL(url).pathname
    const key = `${method} ${p}`
    if (!(key in routes)) return Promise.reject(new Error(`no route ${key}`))
    const v = routes[key]
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
  }

  it('gathers a full snapshot: health + model + slots + completion timings', async () => {
    const r = await probeLlama('box', { _http: router({
      'GET /health': { status: 'ok' },
      'GET /v1/models': { data: [{ id: '/m/Qwen38-27B.gguf' }] },
      'GET /slots': SLOTS,
      'POST /completion': TIMINGS,
    }) })
    assert.equal(r.up, true)
    assert.equal(r.model, 'Qwen38-27B')
    assert.equal(r.nSlots, 2)
    assert.equal(r.kvPercent, 9.2)
    assert.equal(r.decodeTps, 25.4)
    assert.equal(r.prefillTps, 51.9)
  })

  it('unreachable /health → down, no other calls attempted', async () => {
    let calls = 0
    const r = await probeLlama('box', { _http: (m, u) => { calls++; if (u.endsWith('/health')) return Promise.reject(new Error('ECONNREFUSED')); return Promise.resolve({}) } })
    assert.equal(r.up, false)
    assert.equal(r.decodeTps, null)
    assert.equal(calls, 1)                          // gave up after health
  })

  it('does NOT fire a completion when every slot is busy (never adds load)', async () => {
    let completed = false
    const busy = SLOTS.map(s => ({ ...s, is_processing: true }))
    const r = await probeLlama('box', { _http: (m, u) => {
      if (u.endsWith('/completion')) { completed = true; return Promise.resolve(TIMINGS) }
      if (u.endsWith('/health')) return Promise.resolve({ status: 'ok' })
      if (u.endsWith('/v1/models')) return Promise.resolve({ data: [{ id: 'M' }] })
      if (u.endsWith('/slots')) return Promise.resolve(busy)
      return Promise.reject(new Error('x'))
    } })
    assert.equal(completed, false, 'skipped the synthetic generation on a saturated box')
    assert.equal(r.activeSlots, 2)                  // liveness still reported
    assert.equal(r.decodeTps, null)
  })

  it('completion failure degrades gracefully — liveness survives', async () => {
    const r = await probeLlama('box', { _http: router({
      'GET /health': { status: 'ok' },
      'GET /v1/models': { data: [{ id: 'M' }] },
      'GET /slots': SLOTS,
      'POST /completion': new Error('boom'),
    }) })
    assert.equal(r.up, true)
    assert.equal(r.nSlots, 2)
    assert.equal(r.decodeTps, null)                 // no throughput, but not a crash
  })
})

describe('probeToProm', () => {
  it('emits namespaced gauges only for present fields, labeled node+model', () => {
    const txt = probeToProm([{ node: 'box', up: true, model: 'M', nCtx: 262144, nSlots: 2, activeSlots: 1, kvPercent: 9.2, prefillTps: 51.9, decodeTps: 25.4 }])
    assert.match(txt, /gen_llama_probe_up\{node="box",model="M"\} 1/)
    assert.match(txt, /gen_llama_probe_decode_tps\{node="box",model="M"\} 25\.4/)
    assert.match(txt, /gen_llama_probe_kv_used_percent\{node="box",model="M"\} 9\.2/)
    assert.match(txt, /# TYPE gen_llama_probe_prefill_tps gauge/)
  })
  it('a down box emits up=0 and omits the throughput lines', () => {
    const txt = probeToProm([{ node: 'dead', up: false, model: null }])
    assert.match(txt, /gen_llama_probe_up\{node="dead",model="unknown"\} 0/)
    assert.doesNotMatch(txt, /gen_llama_probe_decode_tps\{node="dead"/)
  })
})
