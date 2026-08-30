#!/usr/bin/env node
'use strict'

/**
 * model-ask.js — Grimoire AI routing wrapper
 *
 * Routes tasks to the best available Ollama model by querying `ollama list`
 * and scoring installed models against capability profiles.
 * Model list is cached (in-memory for server, file for CLI, 5-min TTL).
 *
 * Commands specify tasks, never model names:
 *   extraction   Structured JSON, entity extraction
 *   linking      Orphan linking, fast bulk
 *   synthesis    Deep holistic analysis (archaeologist final pass)
 *   dreaming     Long rest, graph introspection (thinking model preferred)
 *   reflection   Diary, journaling, conversational
 *   rumination   Noise floor, background periodic
 *   vision       Image understanding (llava)
 *   embedding    Semantic vectors (always nomic-embed-text)
 *   default      General purpose fallback
 *
 * CLI:
 *   node model-ask.js "extract entities from this text" --task extraction
 *   echo "some text" | node model-ask.js --task reflection
 *   node model-ask.js --routes          Show resolved routing table
 */

const fs       = require('node:fs')
const path     = require('node:path')
const os       = require('node:os')
const axios    = require('axios')
const minimist = require('minimist')
const readline = require('node:readline')
const { refreshLblCache, lblEndpoint, lblConfig } = require('../lib/env')

// Bootstrap .env
if (!process.env.OLLAMA_HOST) {
  const envFile = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
}

function _lblModel(task) { return lblConfig().models?.[task] ?? null }

// Endpoints resolve at call time — env var > lib/env.js merge-floor (repo
// config under the user cache). A decayed or stale cache can no longer pin a
// dead base for the process lifetime (phase 87: the 2026-08-28 drain OOM).
// OpenAI-compatible llama-server for text/chat tasks (use.coding → endpoint);
// Ollama keeps vision + embedding (llava, nomic-embed live there).
function ollamaBase() { return process.env.OLLAMA_HOST     || lblEndpoint('ollama') || null }
function codingBase()  { return process.env.LLM_CODING_HOST || lblEndpoint('coding') || null }

// Warm the local cache from the server's canonical config (refreshLblCache in
// lib/env.js). An optimization, not a dependency — every call above re-resolves
// through lib/env.js regardless of whether this ever ran.
async function refreshEndpoints() { return refreshLblCache() }
const OPENAI_TASKS = new Set(['extraction', 'linking', 'synthesis', 'dreaming', 'reflection', 'rumination', 'default'])

// ── Capability profiles ───────────────────────────────────────────────────────
// Matched in order — first pattern wins. Scores are per task type (0-10).
// thinking: true = model uses chain-of-thought; format:json breaks these.
// size_gb: approximate VRAM footprint — used to deprioritize models that won't fit.

const CAPABILITY_PROFILES = [
  // ── Benchmarked on the GPU host via Comparitron (2026-04-26) ──────────────────
  // gemma4:31b — batch/overnight tier (5 t/s). Best ceiling across all categories.
  {
    match:    /^gemma4:31b/,
    thinking: false,
    size_gb:  20,
    scores:   { dreaming: 10, synthesis: 10, reflection: 8, extraction: 8, linking: 6, rumination: 4, default: 7 },
  },
  // gemma4:26b — interactive workhorse (43 t/s). 85.2 overall, archaeology 87.7. Best value overall.
  {
    match:    /^gemma4/,
    thinking: false,
    size_gb:  16,
    scores:   { extraction: 10, linking: 9, reflection: 9, synthesis: 8, dreaming: 7, rumination: 7, default: 9 },
  },
  // qwen3.6:27b — best ceiling for reasoning + synthesis (12 t/s). Negative self-bias = well-calibrated.
  {
    match:    /^qwen3\.6/,
    thinking: true,
    size_gb:  18,
    scores:   { synthesis: 10, dreaming: 9, reflection: 8, extraction: 7, linking: 5, rumination: 4, default: 7 },
  },
  // qwen3.5:27b — 82.7 overall (12 t/s). Tops coding/reasoning; weak on structured (61.2) — skip extraction.
  {
    match:    /^qwen3\.5:27b/,
    thinking: true,
    size_gb:  18,
    scores:   { synthesis: 9, dreaming: 8, reflection: 8, rumination: 5, default: 7 },
  },
  // qwen3.5:9b — 78.6 overall (34 t/s). Archaeology 90.0. Fast and cheap for bulk/noise floor.
  {
    match:    /^qwen3\.5:9b/,
    thinking: true,
    size_gb:  6,
    scores:   { rumination: 8, linking: 7, reflection: 6, extraction: 5, default: 5 },
  },
  // qwen3 catch-all
  {
    match:    /^qwen3/,
    thinking: true,
    size_gb:  18,
    scores:   { dreaming: 8, synthesis: 8, reflection: 7, extraction: 6, linking: 5, rumination: 5, default: 6 },
  },
  // Models below qwen3.5:9b (78.6 overall) are intentionally excluded from routing.
  // devstral-small-2 (76.3, self-bias +9.8), deepseek-r1 (71-72), deepseek-coder-v2 (63.0),
  // phi4-reasoning:plus (54.2, self-bias +35.3) — all benchmarked below quality threshold on the GPU host.
  // ── Legacy profiles ──────────────────────────────────────────────────────────
  {
    match:    /^qwen2\.5-coder:14b/,
    thinking: false,
    size_gb:  9,
    scores:   { extraction: 8, linking: 7, synthesis: 6, rumination: 5, reflection: 4, default: 7 },
  },
  {
    match:    /^qwen2\.5-coder:7b/,
    thinking: false,
    size_gb:  5,
    scores:   { linking: 7, extraction: 5, rumination: 6, default: 5 },
  },
  {
    match:    /^qwen2\.5:14b/,
    thinking: false,
    size_gb:  9,
    scores:   { reflection: 7, synthesis: 6, extraction: 7, linking: 6, rumination: 5, default: 6 },
  },
  {
    match:    /^qwen2\.5:7b/,
    thinking: false,
    size_gb:  5,
    scores:   { linking: 6, extraction: 5, reflection: 5, rumination: 5, default: 5 },
  },
  {
    match:    /^qwen2\.5/,
    thinking: false,
    size_gb:  5,
    scores:   { linking: 5, extraction: 4, default: 4 },
  },
  {
    match:    /^llama3/,
    thinking: false,
    size_gb:  5,
    scores:   { reflection: 6, synthesis: 5, linking: 5, rumination: 4, default: 5 },
  },
  {
    match:    /^glm/,
    thinking: false,
    size_gb:  19,
    scores:   { extraction: 2, reflection: 2, synthesis: 2, default: 2 },
  },
  {
    match:    /^llava/,
    thinking: false,
    size_gb:  5,
    scores:   { vision: 10 },
  },
  {
    match:    /^nomic-embed/,
    thinking: false,
    size_gb:  0.3,
    scores:   { embedding: 10 },
  },
  {
    match:    /^phi3/,
    thinking: false,
    size_gb:  2.5,
    scores:   { linking: 4, rumination: 4, reflection: 3, default: 3 },
  },
]

// Embedding is specialized — always pinned, never resolved dynamically
const EMBEDDING_MODEL = 'nomic-embed-text'

// Fallback when Ollama is unreachable
const STATIC_FALLBACK = {
  extraction:  { model: _lblModel('fast')        || 'gemma4:26b',   thinking: false },
  linking:     { model: _lblModel('fast')        || 'gemma4:26b',   thinking: false },
  dreaming:    { model: _lblModel('slow')        || 'qwen3.6:27b',  thinking: true  },
  synthesis:   { model: _lblModel('synthesis')   || 'qwen3.6:27b',  thinking: true  },
  reflection:  { model: _lblModel('fast')        || 'gemma4:26b',   thinking: false },
  rumination:  { model: _lblModel('rumination')  || 'qwen3.5:9b',   thinking: true  },
  vision:      { model: _lblModel('vision')      || 'llava:latest',  thinking: false },
  embedding:   { model: EMBEDDING_MODEL,                             thinking: false },
  default:     { model: _lblModel('default')     || 'gemma4:26b',   thinking: false },
}

// ── Model list cache ──────────────────────────────────────────────────────────

const CACHE_TTL  = 5 * 60 * 1000
const CACHE_FILE = path.join(os.tmpdir(), 'grimoire-models-cache.json')

let _memCache     = null
let _memCacheTime = 0

// ── Loaded-models cache (from /api/ps) ────────────────────────────────────────
// Cached for 30s so repeated ask() calls don't hammer /api/ps.
let _loadedCache  = null
let _loadedTime   = 0

async function getInstalledModels() {
  // In-memory (server / repeated calls)
  if (_memCache && Date.now() - _memCacheTime < CACHE_TTL) return _memCache

  // File cache (CLI invocations)
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (Date.now() - cached.time < CACHE_TTL) {
      _memCache     = cached.models
      _memCacheTime = cached.time
      return _memCache
    }
  } catch {}

  // Fetch from Ollama
  try {
    const res    = await axios.get(`${ollamaBase()}/api/tags`, { timeout: 5000 })
    const models = (res.data.models || []).map(m => m.name)
    _memCache     = models
    _memCacheTime = Date.now()
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ time: _memCacheTime, models })) } catch {}
    return models
  } catch {
    return []
  }
}

function profileFor(modelName) {
  return CAPABILITY_PROFILES.find(p => p.match.test(modelName))
}

function scoreFor(modelName, task) {
  return profileFor(modelName)?.scores[task] ?? 0
}

// ── Model resolution ──────────────────────────────────────────────────────────

async function resolveModel(task) {
  if (task === 'embedding') return STATIC_FALLBACK.embedding

  const installed = await getInstalledModels()
  if (!installed.length) return STATIC_FALLBACK[task] || STATIC_FALLBACK.default

  let best      = null
  let bestScore = -1

  for (const name of installed) {
    const score = scoreFor(name, task)
    if (score > bestScore) { bestScore = score; best = name }
  }

  if (!best || bestScore === 0) {
    if (task === 'default') return STATIC_FALLBACK.default   // default itself scored 0 → static, stop
    return resolveModel('default')                            // recurse ONCE; a scoring default model still wins
  }

  const profile   = profileFor(best)
  const thinking  = profile?.thinking ?? false
  return { model: best, thinking, score: bestScore }
}

// ── Route table (for display / export) ───────────────────────────────────────

const ALL_TASKS = ['extraction', 'linking', 'synthesis', 'dreaming', 'reflection', 'rumination', 'vision', 'embedding', 'default']

async function buildRouteTable() {
  const table = {}
  await Promise.all(ALL_TASKS.map(async task => { table[task] = await resolveModel(task) }))
  return table
}

// ── OpenAI-compat backend (llama-server) ─────────────────────────────────────

let _oaiModel     = null
let _oaiModelBase = null

async function getCodingModel(base) {
  if (_oaiModel && _oaiModelBase === base) return _oaiModel
  const res  = await axios.get(`${base}/v1/models`, { timeout: 5000 })
  _oaiModel     = res.data?.data?.[0]?.id || null
  _oaiModelBase = base
  if (!_oaiModel) throw new Error(`no model listed at ${base}/v1/models`)
  return _oaiModel
}

async function askOpenAI({ prompt, task, system, json, timeout, maxTokens }) {
  const base  = codingBase()
  const model = await getCodingModel(base)
  // Thinking only for tasks that benefit from it (mirrors STATIC_FALLBACK intent);
  // enable_thinking is honored by Qwen3.x chat templates, ignored by others.
  const thinking = STATIC_FALLBACK[task]?.thinking === true

  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  let user = prompt
  if (json) user += '\n\nRespond with valid JSON only. No markdown, no prose.'
  messages.push({ role: 'user', content: user })

  const body = {
    model,
    messages,
    stream:      false,
    max_tokens:  maxTokens ?? 4096,
    chat_template_kwargs: { enable_thinking: thinking },
  }

  process.stderr.write(`  [ask] ${model} @ ${base} (openai) task=${task} think=${thinking} promptTokens≈${Math.ceil(user.length / 4)} timeout=${timeout}ms\n`)
  const t0 = Date.now()

  const response = await axios.post(
    `${base}/v1/chat/completions`,
    body,
    { headers: { 'Content-Type': 'application/json' }, timeout }
  )

  const raw = response.data?.choices?.[0]?.message?.content || ''
  process.stderr.write(`  [ask] done in ${Date.now() - t0}ms — ${raw.length} chars\n`)
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// ── ask() ─────────────────────────────────────────────────────────────────────

async function ask({ prompt, task = 'default', model, system, json = false, timeout = 120000, images, maxTokens, keepAlive }) {
  const coding = codingBase()
  const ollama = ollamaBase()
  // Text/chat tasks go to the coding llama-server when configured (lbl use.coding).
  // Explicit --model requests and vision/embedding stay on Ollama.
  if (coding && !model && !images?.length && OPENAI_TASKS.has(task)) {
    return askOpenAI({ prompt, task, system, json, timeout, maxTokens })
  }

  let resolved
  if (model) {
    const profile = profileFor(model)
    resolved = { model, thinking: profile?.thinking ?? false }
  } else {
    resolved = await resolveModel(task)
  }

  const { model: resolvedModel, thinking: isThinking } = resolved

  // Time-based keep_alive (default 30m) instead of -1 (never unload).
  // Prevents VRAM clog during long batches (archaeology digs, council runs).
  const ka = keepAlive ?? '30m'

  const body = { prompt, model: resolvedModel, stream: false, keep_alive: ka }
  if (system)  body.system = system
  if (images?.length) body.images = images
  const modelCanThink = profileFor(resolvedModel)?.thinking === true
  if (!isThinking && modelCanThink) body.options = { think: false }
  // Always cap generation — uncapped concurrent runs (council) have OOM'd before.
  body.options = { ...body.options, num_predict: maxTokens ?? 4096 }

  if (json && isThinking) {
    body.prompt = prompt + '\n\nRespond with valid JSON only. No markdown, no prose.'
  } else if (json) {
    body.format = 'json'
  }

  const promptTokenEst = Math.ceil((body.prompt || '').length / 4)

  // Cached /api/ps check — avoid hammering the Ollama API on every call.
  const now = Date.now()
  let isLoaded = false
  if (!_loadedCache || now - _loadedTime > 30_000) {
    try {
      const ps = await axios.get(`${ollama}/api/ps`, { timeout: 3000 })
      _loadedCache  = (ps.data.models || []).map(m => m.name)
      _loadedTime   = now
    } catch { _loadedCache = []; _loadedTime = now }
  }
  isLoaded = _loadedCache.some(n => n === resolvedModel || n.startsWith(resolvedModel.split(':')[0]))
  if (!isLoaded) process.stderr.write(`  [ask] COLD LOAD — ${resolvedModel} not in VRAM (loaded: ${_loadedCache.join(', ') || 'none'})\n`)

  process.stderr.write(`  [ask] ${resolvedModel} task=${task} think=${isThinking} promptTokens≈${promptTokenEst} timeout=${timeout}ms\n`)
  const t0 = Date.now()

  const response = await axios.post(
    `${ollama}/api/generate`,
    body,
    { headers: { 'Content-Type': 'application/json' }, timeout }
  )

  const elapsed = Date.now() - t0
  const raw = response.data.response || ''
  process.stderr.write(`  [ask] done in ${elapsed}ms — ${raw.length} chars\n`)
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

/**
 * Compact loaded models — evict all models from Ollama's VRAM.
 * Call after long batch runs (archaeology, council) to free VRAM.
 */
async function compact() {
  const base = ollamaBase()
  try {
    const ps = await axios.get(`${base}/api/ps`, { timeout: 3000 })
    const names = (ps.data.models || []).map(m => m.name)
    if (names.length === 0) return
    // Evict each loaded model. Ollama 0.5+ supports /api/evict with model list.
    await axios.post(`${base}/api/evict`, { models: names })
    process.stderr.write(`  [ask] compact — evicted ${names.length} model(s)\n`)
  } catch {
    // Ollama may not have /api/evict (older versions). Best-effort.
  }
}

async function askJSON(opts) {
  const raw = await ask({ ...opts, json: true })
  try {
    return JSON.parse(raw)
  } catch {
    const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    return JSON.parse(stripped)
  }
}

module.exports = { ask, askJSON, resolveModel, buildRouteTable, getInstalledModels, compact, refreshEndpoints, ollamaBase, codingBase, ALL_TASKS }

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = minimist(process.argv.slice(2), {
    boolean: ['routes'],
    alias: { t: 'task', m: 'model', s: 'system', r: 'routes' },
    default: { task: 'default' },
  })

  async function main() {
    await refreshEndpoints()

    if (args.routes) {
      const table = await buildRouteTable()
      const installed = await getInstalledModels()
      console.log(`\n  Grimoire model router  (${ollamaBase()})\n`)
      console.log(`  Installed: ${installed.length} model${installed.length === 1 ? '' : 's'}\n`)
      const width = Math.max(...ALL_TASKS.map(t => t.length))
      for (const task of ALL_TASKS) {
        const r = table[task]
        const flags = [r.thinking ? 'thinking' : '', r.score ? `score:${r.score}` : ''].filter(Boolean).join(', ')
        console.log(`  ${task.padEnd(width + 2)} → ${r.model}${flags ? `  (${flags})` : ''}`)
      }
      console.log()
      return
    }

    let prompt = args._.join(' ').trim()
    if (!prompt) {
      prompt = await new Promise(resolve => {
        const lines = []
        readline.createInterface({ input: process.stdin, terminal: false })
          .on('line',  l => lines.push(l))
          .on('close', () => resolve(lines.join('\n')))
      })
    }

    if (!prompt.trim()) {
      console.error(`Usage: model-ask.js <prompt> [--task ${ALL_TASKS.join('|')}]`)
      console.error('       model-ask.js --routes   Show resolved routing table')
      process.exit(1)
    }

    const result = await ask({ prompt, task: args.task, model: args.model, system: args.system })
    console.log(result)
  }

  main().catch(e => { console.error(e.message); process.exit(1) })
}
