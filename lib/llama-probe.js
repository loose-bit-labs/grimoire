'use strict'

/**
 * lib/llama-probe.js — active perf probe for a llama.cpp server.
 *
 * The Rig's poller reads /slots for liveness (busy slots, KV occupancy), but a
 * llama-server started without `--metrics` exposes no throughput anywhere: an
 * idle /slots has no timings, and the Anthropic /v1/messages endpoint returns
 * only token counts. The one place a llama.cpp build ALWAYS reports server-side
 * timings is the native /completion response. So this probe fires one tiny
 * generation and reads the `timings` block back — prefill (prompt) tokens/sec
 * and decode (predicted) tokens/sec — without needing any server flag.
 *
 * Everything here is pure over HTTP: probeLlama() gathers a normalized snapshot,
 * probeToProm() renders Prometheus text, renderProbe() renders a terminal view.
 * Percentiles (p50/p95/p99) are a Grafana concern — quantile_over_time() over
 * the decode/prefill gauges this streams; a single sample can't hold a quantile.
 *
 * Probe etiquette: skip the synthetic generation when every slot is already
 * processing (never add load to a busy box); the liveness fields still return.
 */

const http = require('node:http')

const DEFAULT_PORT = 11311

// A bare host → its llama base URL; a full URL passes through untouched.
function normalizeTarget(target, port = DEFAULT_PORT) {
  const t = String(target || '').trim()
  if (/^https?:\/\//.test(t)) return t.replace(/\/+$/, '')
  if (t.includes(':')) return `http://${t}`          // host:port given
  return `http://${t}:${port}`
}

// The short label of a host from its base URL (the Prometheus `node`).
function nodeOf(base) {
  try { return new URL(base).hostname } catch { return String(base) }
}

// A gguf path/name → a readable model id (basename, drop shard + .gguf).
function cleanModel(name) {
  if (!name) return null
  return String(name).split('/').pop()
    .replace(/-\d{5}-of-\d{5}/i, '')
    .replace(/\.gguf$/i, '')
}

const round1 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 10) / 10

function httpJson(method, url, body, timeoutMs = 8000) {
  const u = new URL(url)
  const payload = body == null ? null : JSON.stringify(body)
  const opts = {
    hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
    headers: { accept: 'application/json' },
  }
  if (payload != null) {
    opts.headers['content-type'] = 'application/json'
    opts.headers['content-length'] = Buffer.byteLength(payload)
  }
  return new Promise((resolve, reject) => {
    const req = http.request(opts, res => {
      const c = []
      res.on('data', d => c.push(d))
      res.on('end', () => {
        const txt = Buffer.concat(c).toString('utf8')
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} from ${url}`))
        try { resolve(JSON.parse(txt)) } catch (e) { reject(new Error(`bad JSON from ${url}: ${e.message}`)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms querying ${url}`)))
    if (payload != null) req.write(payload)
    req.end()
  })
}

// Reduce a /slots array into the liveness fields we report. Pure — unit-tested
// against captured fixtures so the shape assumptions are pinned.
function reduceSlots(slots) {
  const out = { nSlots: null, nCtx: null, activeSlots: null, kvPercent: null }
  if (!Array.isArray(slots) || slots.length === 0) return out
  out.nSlots = slots.length
  out.nCtx = slots[0].n_ctx || null
  out.activeSlots = slots.filter(s => s.is_processing).length
  const used = slots.reduce((a, s) => a + (s.n_prompt_tokens || 0), 0)
  const cap = out.nCtx ? out.nCtx * out.nSlots : 0
  out.kvPercent = cap ? round1((100 * used) / cap) : null
  return out
}

// Pull the throughput fields out of a /completion `timings` block. Pure.
function timingsOf(completion) {
  const t = completion && completion.timings
  if (!t) return { prefillTps: null, decodeTps: null, promptN: null, predictedN: null }
  return {
    prefillTps: round1(t.prompt_per_second),
    decodeTps:  round1(t.predicted_per_second),
    promptN:    t.prompt_n ?? null,
    predictedN: t.predicted_n ?? null,
  }
}

/**
 * Probe one llama-server. Read-only by default for liveness; fires a single
 * tiny /completion for throughput unless `probe:false` or the box is saturated.
 *
 * @returns normalized snapshot (all fields present; null where unavailable)
 */
async function probeLlama(target, opts = {}) {
  const {
    port = DEFAULT_PORT, nPredict = 16, prompt = 'The quick brown fox',
    timeoutMs = 8000, probe = true, _http = httpJson,
  } = opts
  const base = normalizeTarget(target, port)
  const node = nodeOf(base)
  const out = {
    base, node, up: false, model: null,
    nCtx: null, nSlots: null, activeSlots: null, kvPercent: null,
    prefillTps: null, decodeTps: null, promptN: null, predictedN: null,
  }

  try {
    const h = await _http('GET', `${base}/health`, null, Math.min(timeoutMs, 3000))
    out.up = !!(h && h.status === 'ok')
  } catch { return out }                      // unreachable → down, nothing else to read
  if (!out.up) return out

  try {
    const m = await _http('GET', `${base}/v1/models`, null, timeoutMs)
    out.model = cleanModel(m?.data?.[0]?.id || m?.models?.[0]?.name)
  } catch { /* model name best-effort */ }

  try { Object.assign(out, reduceSlots(await _http('GET', `${base}/slots`, null, timeoutMs))) }
  catch { /* liveness best-effort */ }

  const saturated = out.nSlots != null && out.activeSlots >= out.nSlots
  if (probe && !saturated) {
    try {
      const c = await _http('POST', `${base}/completion`,
        { prompt, n_predict: nPredict, stream: false, cache_prompt: false }, timeoutMs)
      Object.assign(out, timingsOf(c))
    } catch { /* throughput best-effort — liveness still returned */ }
  }
  return out
}

// ── renderers ────────────────────────────────────────────────────────────────

const esc = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' }
const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR
const paint = (s, c) => useColor() ? `${esc[c]}${s}${esc.reset}` : s

// A |▓▓▓░░░| KV-occupancy bar, colored by pressure.
function kvBar(percent, width = 12) {
  if (percent == null) return ' '.repeat(width + 2)
  const fill = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  const bar = '▓'.repeat(fill) + '░'.repeat(width - fill)
  const c = percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green'
  return paint(bar, c)
}

const tps = v => v == null ? paint('  —  ', 'dim') : `${String(v).padStart(5)} t/s`

// One probe result → a two-line terminal block.
function renderOne(r) {
  if (!r.up) return `  ${paint('✗', 'red')} ${r.node.padEnd(10)} ${paint('down', 'red')}`
  const ctx = r.nCtx ? `${r.nCtx}` : '?'
  const model = r.model || paint('unknown model', 'dim')
  const head = `  ${paint('●', 'green')} ${paint(r.node.padEnd(10), 'bold')} ${model}`
  const cfg  = `     ${paint(`ctx ${ctx} × ${r.nSlots ?? '?'} slots`, 'dim')}  ` +
    `kv ${kvBar(r.kvPercent)} ${r.kvPercent == null ? '' : r.kvPercent + '%'}  ` +
    `${r.activeSlots ?? 0}/${r.nSlots ?? '?'} busy`
  const perf = `     prefill ${tps(r.prefillTps)}   decode ${tps(r.decodeTps)}`
  return [head, cfg, perf].join('\n')
}

function renderProbe(results) {
  return results.map(renderOne).join('\n\n') + '\n'
}

// Prometheus exposition text. Metrics are namespaced gen_llama_probe_* so they
// never collide with the serve poller's gen_llama_* series. Percentiles are a
// Grafana quantile_over_time() over these gauges.
function probeToProm(results) {
  const L = []
  const g = (name, help) => { L.push(`# HELP ${name} ${help}`); L.push(`# TYPE ${name} gauge`) }
  const lbl = r => `node="${r.node}",model="${r.model || 'unknown'}"`
  const emit = (name, r, v) => { if (v != null) L.push(`${name}{${lbl(r)}} ${v}`) }

  g('gen_llama_probe_up', 'Whether the llama-server answered /health ok (1/0)')
  for (const r of results) L.push(`gen_llama_probe_up{${lbl(r)}} ${r.up ? 1 : 0}`)
  g('gen_llama_probe_ctx_tokens', 'Context window size per slot in tokens')
  for (const r of results) emit('gen_llama_probe_ctx_tokens', r, r.nCtx)
  g('gen_llama_probe_slots_total', 'Configured parallel slots')
  for (const r of results) emit('gen_llama_probe_slots_total', r, r.nSlots)
  g('gen_llama_probe_active_slots', 'Slots currently processing')
  for (const r of results) emit('gen_llama_probe_active_slots', r, r.activeSlots)
  g('gen_llama_probe_kv_used_percent', 'KV cache occupancy across all slots (%)')
  for (const r of results) emit('gen_llama_probe_kv_used_percent', r, r.kvPercent)
  g('gen_llama_probe_prefill_tps', 'Prompt (prefill) throughput, tokens/sec')
  for (const r of results) emit('gen_llama_probe_prefill_tps', r, r.prefillTps)
  g('gen_llama_probe_decode_tps', 'Decode (generation) throughput, tokens/sec')
  for (const r of results) emit('gen_llama_probe_decode_tps', r, r.decodeTps)
  return L.join('\n') + '\n'
}

module.exports = {
  probeLlama, reduceSlots, timingsOf, cleanModel, normalizeTarget, nodeOf,
  renderProbe, renderOne, probeToProm, kvBar, DEFAULT_PORT,
}
