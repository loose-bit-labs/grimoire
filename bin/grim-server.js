#!/usr/bin/env node
'use strict'

/**
 * grim-server.js — The Grimoire Server
 *
 * Exposes the KB to the LAN via HTTP REST API + MCP endpoint.
 * Binds to 0.0.0.0 so clients on other hosts can reach it via the configured endpoint
 * (endpoints.grimoire in ~/.config/lbl-config.json).
 *
 * Routes:
 *   GET  /health                 → status + graph stats
 *   GET  /api/graph              → full graph.json (for lib/graph.js remote mode)
 *   GET  /api/oracle             → search (?q=&tag=&type=&depth=&limit=)
 *   GET  /api/divine             → health report
 *   GET  /api/session/briefing   → load briefing
 *   POST /api/session/save       → save session
 *   POST /api/tome/recall        → recall entity
 *   POST /api/tome/remember      → create entity
 *   POST /api/tome/relate        → add relationship
 *   POST /api/tome/annotate      → annotate entity
 *   POST /api/tome/forget        → delete entity by id
 *   POST /api/scribe             → rebuild graph index + bust cache
 *   POST /api/crawl                      → extract entities from text/code, write to KB
 *   POST /noise-floor/think             → add thought to stream
 *   GET  /noise-floor/context           → get recent thoughts
 *   POST /api/archaeology/upload        → upload dig artifact (overview/files/final)
 *   GET  /api/archaeology/backlog       → list pending/stale/integrated entries
 *   POST /api/archaeology/:slug/integrate → mark KB pass complete
 *   GET  /api/archaeology/:slug/:file   → fetch artifact content
 *   GET  /config/lbl                    → canonical lbl-config.json (?path=dot.path for a single value)
 *   POST /mcp                           → MCP Streamable HTTP transport
 *
 * Run on the KB host: node bin/grim-server.js
 */

const fs      = require('node:fs')
const os      = require('node:os')
const path    = require('node:path')
const express = require('express')
const cors    = require('cors')

const { loadGraph }      = require('../lib/graph')
const { runChecks, computeScore } = require('./grim-divine')
const { search, enrichWithContext } = require('./grim-oracle')
const { loadBriefing, saveSession } = require('./grim-session')
const { recall, remember, update, relate, annotate, forget } = require('./grim-tome')
const { crawlText } = require('./grim-crawl')
const { config, requireMode } = require('../lib/env')
const { scanHostEntities, buildHostsOutput } = require('./grim-host')
const { scanProjects, projectStatus, toPrometheus, ACTIVE_SEC, IDLE_SEC } = require('../lib/hmm')
const rig = require('../bin/grim-rig')
const http = require('node:http')
const { semanticSearch, indexReady } = require('../lib/vectors')

requireMode('local')

const app  = express()
const PORT = config.port

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, '..', 'public')))

// ── Graph cache (reload every 30s or on-demand) ───────────────────────────────

let _graphCache     = null
let _graphCachedAt  = 0
const CACHE_TTL_MS  = 30_000

async function getGraph(force = false) {
  const now = Date.now()
  if (!force && _graphCache && (now - _graphCachedAt) < CACHE_TTL_MS) return _graphCache
  _graphCache    = await loadGraph()
  _graphCachedAt = now
  return _graphCache
}

// ── Noise Floor (thought stream) ──────────────────────────────────────────────

const NOISE_FILE = path.join(config.root, 'noise-floor.json')

function loadThoughts() {
  try { return JSON.parse(fs.readFileSync(NOISE_FILE, 'utf8')) } catch { return [] }
}

function saveThoughts(thoughts) {
  fs.writeFileSync(NOISE_FILE, JSON.stringify(thoughts.slice(-500), null, 2))
}

// ── lbl-config (config authority) ─────────────────────────────────────────────

const LBL_CONFIG_PATH = path.join(__dirname, '..', 'config', 'lbl-config.json')

function loadLblConfig() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(LBL_CONFIG_PATH, 'utf8'))
  } catch (e) {
    throw new Error(`Invalid lbl-config.json at ${LBL_CONFIG_PATH}: ${e.message}`)
  }
  if (!parsed.endpoints || !parsed.use) {
    throw new Error(`Invalid lbl-config.json at ${LBL_CONFIG_PATH}: missing top-level 'endpoints' or 'use' object`)
  }
  return parsed
}

function dotGet(obj, dotPath) {
  return dotPath.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj)
}

loadLblConfig() // fail loud on boot if config/lbl-config.json is missing/invalid

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const graph = await getGraph()
    const m     = graph._meta || {}
    res.json({ status: 'ok', entities: m.entityCount, edges: m.edgeCount, builtAt: m.builtAt })
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message })
  }
})

app.get('/api/graph', async (req, res) => {
  try {
    const graph = await getGraph(req.query.fresh === '1')
    res.json(graph)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/scribe', async (req, res) => {
  try {
    const { scribeAll } = require('./grim-scribe')
    const { graph, vectors } = await scribeAll({ force: req.body?.force ?? false })
    _graphCache    = null
    _graphCachedAt = 0
    await getGraph()
    res.json({ ok: true, entities: Object.keys(graph.entities).length, edges: graph._meta?.edgeCount ?? 0, vectors })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/oracle', async (req, res) => {
  try {
    const graph = await getGraph()
    const query = req.query.q || null
    const limit = Number(req.query.limit || 20)
    let semanticHits = []
    if (query && !req.query['no-semantic']) {
      try {
        if (await indexReady()) semanticHits = await semanticSearch(query, limit * 2)
      } catch { /* degraded */ }
    }
    const results = search(graph, {
      query,
      tag:   req.query.tag  || null,
      type:  req.query.type || null,
      depth: Number(req.query.depth || 0),
      limit,
      semanticHits,
    })
    res.json(results)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/hosts — the /etc/hosts block, so clients (no GRIMOIRE_ROOT) can run
// `grim host gen-hosts --apply` by fetching it here. Same generator as the CLI,
// so remote output is byte-identical to aid's local output.
app.get('/api/hosts', async (req, res) => {
  try {
    const hosts  = scanHostEntities(config.root)
    res.type('text/plain').send(buildHostsOutput(hosts))
  } catch (e) {
    res.status(500).type('text/plain').send(`# error: ${e.message}\n`)
  }
})

// GET /api/hosts/inventory — host entities as JSON, so clients (no GRIMOIRE_ROOT)
// can run `grim host list` by fetching the raw entities and rendering them
// identically to the local path. Same source (scanHostEntities), so remote bytes
// == local bytes.
app.get('/api/hosts/inventory', async (req, res) => {
  if (!config.root) {
    return res.status(503).json({ error: 'no local KB root — server not configured for inventory' })
  }
  try {
    const hosts = scanHostEntities(config.root)
    res.json(hosts)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/hosts/onboard — auto-add a registered host to rig.json + reconcile telemetry
app.post('/api/hosts/onboard', async (req, res) => {
  if (!config.root) {
    return res.status(501).json({ error: 'onboard requires local KB root (aid server only)' })
  }
  const { host, label, aliases } = req.body || {}
  if (!host) {
    return res.status(400).json({ error: 'host is required' })
  }
  try {
    const rigPath = path.join(config.root, 'rig.json')
    const upsert = rig.upsertBox(rigPath, { host, label, aliases })
    let telemetryReloaded = false
    if (upsert.added) {
      const tel = await rig.reconcileTelemetry()
      telemetryReloaded = tel.reloaded
    }
    res.json({ host, addedToFleet: upsert.added, telemetryReloaded })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/divine', async (req, res) => {
  try {
    const graph   = await getGraph()
    const results = runChecks(graph)
    const scoring = computeScore(results)
    res.json({ ...results, ...scoring })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/session/briefing', async (req, res) => {
  try {
    const briefing = await loadBriefing()
    res.json(briefing)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/session/save', async (req, res) => {
  try {
    const result = await saveSession(req.body)
    _graphCache = null // invalidate cache
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tome/recall', async (req, res) => {
  try {
    const { query, depth = 1 } = req.body
    if (!query) return res.status(400).json({ error: 'query required' })
    const results = await recall(query, { depth })
    res.json(results)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tome/remember', async (req, res) => {
  try {
    const { type, ...rest } = req.body
    const body = type ? { '@type': type, ...rest } : req.body
    const result = await remember(body)
    _graphCache = null
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tome/update', async (req, res) => {
  try {
    const { id, ...patches } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const result = await update(id, patches)
    _graphCache = null
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tome/relate', async (req, res) => {
  try {
    const { fromId, toId, relationType } = req.body
    if (!fromId || !toId || !relationType) return res.status(400).json({ error: 'fromId, toId, relationType required' })
    const result = await relate(fromId, toId, relationType)
    _graphCache = null
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tome/annotate', async (req, res) => {
  try {
    const { entityId, note } = req.body
    if (!entityId || !note) return res.status(400).json({ error: 'entityId and note required' })
    const result = await annotate(entityId, note)
    _graphCache = null
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tome/forget', async (req, res) => {
  try {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const result = await forget(id)
    _graphCache = null
    res.json(result)
  } catch (e) {
    if (e.message.includes('not found')) return res.json({ ok: false, reason: 'not_found' })
    res.status(500).json({ error: e.message })
  }
})

app.get('/config/lbl', (req, res) => {
  try {
    const cfg = loadLblConfig()
    if (!req.query.path) return res.json(cfg)
    const value = dotGet(cfg, req.query.path)
    if (value === undefined) return res.status(404).json({ error: `path not found: ${req.query.path}` })
    res.json({ path: req.query.path, value })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── HMM Tracking (Track Q) ────────────────────────────────────────────────────

const HMM_POLL_SEC = 10 // SSE poll interval

/**
 * Fetch HMM data from a single box's rig agent.
 * Returns { host, up, projects } — down box → up:false, projects:[].
 */
async function fetchBoxHmm(boxName) {
  const port = config.ports?.grim_rig || 18081
  const isLocal = boxName === os.hostname().toLowerCase() ||
    (rig.loadBoxesGraceful().find(b => b.label === boxName)?.aliases || []).includes(os.hostname().toLowerCase())
  const addr = isLocal ? `http://127.0.0.1:${port}/hmm` : `http://${boxName}:${port}/hmm`
  try {
    const data = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 3000)
      http.get(addr, { signal: AbortSignal.timeout(3000) }, res => {
        clearTimeout(timer)
        if (res.statusCode !== 200) return resolve(null)
        let body = ''
        res.on('data', c => { body += c })
        res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
      }).on('error', () => { clearTimeout(timer); resolve(null) })
    })
    if (!data || !data.host) return { host: boxName, up: false, projects: [] }
    return { host: boxName, up: true, projects: data.projects || [] }
  } catch {
    return { host: boxName, up: false, projects: [] }
  }
}

/**
 * Fan out over rig.json boxes, merge into { boxes: [{ host, up, projects }] }.
 * Down boxes are included as up:false — never 500.
 */
async function fetchFleetHmm() {
  const boxes = rig.loadBoxesGraceful()
  const results = await Promise.allSettled(
    boxes.filter(b => !b.skip).map(b => fetchBoxHmm(b.label || b.host))
  )
  const boxesOut = results.map(r => r.status === 'fulfilled' ? r.value : { host: '?', up: false, projects: [] })
  // If no boxes configured, fall back to local scan
  if (boxesOut.length === 0) {
    const root = path.join(os.homedir(), 'src', 'me')
    const projects = scanProjects(root).map(p => projectStatus(p, Math.floor(Date.now() / 1000)))
    return { boxes: [{ host: os.hostname().toLowerCase(), up: true, projects }] }
  }
  return { boxes: boxesOut }
}

// Shared state for SSE: last emitted snapshot
let _hmmLastSnapshot = null
let _hmmPollTimer = null

function _startHmmPoll() {
  if (_hmmPollTimer) return
  _hmmPollTimer = setInterval(async () => {
    try {
      const snapshot = await fetchFleetHmm()
      const serialized = JSON.stringify(snapshot)
      if (_hmmLastSnapshot !== serialized) {
        _hmmLastSnapshot = serialized
        // Broadcast to all connected SSE clients
        for (const client of ((_hmmSSEClients || []).slice())) {
          try { client.write(`data: ${serialized}\n\n`) } catch { /* dead client, cleaned up on close */ }
        }
      }
    } catch { /* poll error — next tick retries */ }
  }, HMM_POLL_SEC * 1000)
  // Unref so it doesn't keep the process alive
  _hmmPollTimer.unref()
}

let _hmmSSEClients = []

app.get('/api/hmm', async (req, res) => {
  try {
    const data = await fetchFleetHmm()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * Pure lookup: pick a single project's detail out of a fleet snapshot.
 * Returns null if the host is unknown/down or the project isn't found —
 * no network, no side effects, so it's directly unit-testable.
 */
function pickProjectDetail(fleetData, host, project) {
  const box = (fleetData.boxes || []).find(b => b.host === host)
  if (!box || !box.up) return null
  const proj = (box.projects || []).find(p => p.project === project)
  if (!proj) return null
  return { host, ...proj }
}

app.get('/api/hmm/:host/:project', async (req, res) => {
  try {
    const { host, project } = req.params
    const data = await fetchFleetHmm()
    const detail = pickProjectDetail(data, host, project)
    if (!detail) return res.status(404).json({ error: `project not found: ${host}/${project}` })
    res.json(detail)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/hmm/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  _hmmSSEClients = _hmmSSEClients || []
  _hmmSSEClients.push(res)
  // Send current snapshot immediately
  if (_hmmLastSnapshot) {
    try { res.write(`data: ${_hmmLastSnapshot}\n\n`) } catch { /* ignore */ }
  }
  req.on('close', () => {
    _hmmSSEClients = (_hmmSSEClients || []).filter(c => c !== res)
  })
})

_startHmmPoll()

app.get('/hall', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'guild-hall.html')
  try {
    const body = fs.readFileSync(htmlPath, 'utf8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('hall not found\n')
  }
})

// ── Noise Floor ───────────────────────────────────────────────────────────────

app.post('/api/crawl', async (req, res) => {
  try {
    const { text, source = 'api', language = null, dryRun = false, noNer = false } = req.body
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' })
    const result = await crawlText({ text, source, language, dryRun, noNer })
    if (!dryRun && result.entitiesCreated > 0) {
      _graphCache    = null
      _graphCachedAt = 0
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Archaeology ───────────────────────────────────────────────────────────────

const ARCH_ROOT = path.join(config.root, 'archaeology')

function archStatusPath(slug) { return path.join(ARCH_ROOT, slug, 'status.json') }

function loadArchStatus(slug) {
  try { return JSON.parse(fs.readFileSync(archStatusPath(slug), 'utf8')) } catch { return null }
}

function saveArchStatus(slug, data) {
  fs.writeFileSync(archStatusPath(slug), JSON.stringify(data, null, 2))
}

function archBacklog() {
  if (!fs.existsSync(ARCH_ROOT)) return []
  return fs.readdirSync(ARCH_ROOT)
    .filter(d => fs.statSync(path.join(ARCH_ROOT, d)).isDirectory())
    .map(slug => {
      const dir    = path.join(ARCH_ROOT, slug)
      const status = loadArchStatus(slug)
      const hasFinal = fs.existsSync(path.join(dir, 'final.md'))
      const hasOvr   = fs.existsSync(path.join(dir, 'overview.md'))
      return {
        slug,
        status:       status?.status || (hasFinal ? 'pending' : hasOvr ? 'dig-in-progress' : 'empty'),
        uploadedAt:   status?.uploadedAt,
        integratedAt: status?.integratedAt,
        hasFinal,
      }
    })
}

// Upload a single artifact file for a slug
app.post('/api/archaeology/upload', (req, res) => {
  const { slug, filename, content } = req.body
  if (!slug || !filename || content == null) return res.status(400).json({ error: 'slug, filename, content required' })

  const safeSlug = slug.replace(/[^a-z0-9_-]/gi, '_')
  const dir = path.join(ARCH_ROOT, safeSlug)

  // Files can be nested (e.g. "files/foo.js.md") — create subdirs
  const dest = path.join(dir, filename)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content, 'utf8')

  // Update status when final.md arrives
  if (filename === 'final.md') {
    const hash    = require('node:crypto').createHash('sha256').update(content).digest('hex').slice(0, 12)
    const current = loadArchStatus(safeSlug)
    const wasIntegrated = current?.status === 'integrated'
    const changed = current?.finalHash && current.finalHash !== hash
    saveArchStatus(safeSlug, {
      status:       wasIntegrated && changed ? 'stale' : current?.status === 'integrated' ? 'integrated' : 'pending',
      uploadedAt:   new Date().toISOString(),
      integratedAt: current?.integratedAt || null,
      finalHash:    hash,
    })
  }

  res.json({ ok: true, path: path.relative(ARCH_ROOT, dest) })
})

// List backlog
app.get('/api/archaeology/backlog', (req, res) => {
  res.json({ backlog: archBacklog() })
})

// Mark a slug as integrated (called after KB pass completes)
app.post('/api/archaeology/:slug/integrate', (req, res) => {
  const { slug } = req.params
  const current  = loadArchStatus(slug)
  if (!current) return res.status(404).json({ error: 'not found' })
  saveArchStatus(slug, { ...current, status: 'integrated', integratedAt: new Date().toISOString() })
  res.json({ ok: true })
})

// Get a specific artifact (so Claude can read final.md remotely)
app.get('/api/archaeology/:slug/:filename(*)', (req, res) => {
  const { slug, filename } = req.params
  const filePath = path.join(ARCH_ROOT, slug, filename)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' })
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'))
})

// An "addressed to" thought (e.g. "mage -> minion: ...") looks like a directed
// message, but the noise floor is a broadcast with no recipient concept — flag
// it rather than silently letting the sender think it was delivered.
const ADDRESSED_PATTERN = /^\s*[\w-]+\s*(→|->)\s*[\w-]+\s*:/

app.post('/noise-floor/think', (req, res) => {
  const { text, source = 'unknown', type = 'observation' } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })
  const thoughts = loadThoughts()
  const thought  = { at: new Date().toISOString(), text, source, type }
  thoughts.push(thought)
  saveThoughts(thoughts)
  const response = { ok: true, count: thoughts.length }
  if (ADDRESSED_PATTERN.test(text)) {
    response.warning = 'looks addressed — broadcast has no recipient; use grim mm for directed messages'
  }
  res.json(response)
})

app.get('/noise-floor/context', (req, res) => {
  const thoughts = loadThoughts()
  const limit    = Number(req.query.limit || 30)
  res.json({
    thoughts: thoughts.slice(-limit),
    total:    thoughts.length,
  })
})

// ── MCP (Streamable HTTP transport) ──────────────────────────────────────────

const MCP_VERSION = '2024-11-05'

const MCP_TOOLS = [
  {
    name: 'oracle_search',
    description: 'Search the Grimoire knowledge graph by name, content, tag, or entity type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string',  description: 'Free-text search query' },
        tag:   { type: 'string',  description: 'Filter by tag (e.g. domain/workflow)' },
        type:  { type: 'string',  description: 'Filter by entity type (Person, Project, DefinedTerm, Event, SoftwareApplication)' },
        depth: { type: 'number',  description: 'Relationship traversal depth, default 0' },
        limit: { type: 'number',  description: 'Max results, default 10' },
      },
    },
  },
  {
    name: 'tome_recall',
    description: 'Recall a specific entity by name or ID with its full details and relationships.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Entity name, ID, or description fragment' },
        depth: { type: 'number', description: 'How many relationship hops to expand, default 1' },
      },
    },
  },
  {
    name: 'tome_remember',
    description: 'Create a new entity in the Grimoire knowledge graph.',
    inputSchema: {
      type: 'object',
      required: ['type', 'name', 'description'],
      properties: {
        type:          { type: 'string', description: 'Person | Project | DefinedTerm | Event | SoftwareApplication | HowTo' },
        name:          { type: 'string' },
        description:   { type: 'string' },
        tags:          { type: 'array', items: { type: 'string' } },
        relationships: { type: 'object', description: 'Typed edges: { "works_on": ["project_id"] }' },
      },
    },
  },
  {
    name: 'tome_update',
    description: 'Update an existing entity in the Grimoire knowledge graph. Only provided fields are changed; omitted fields are preserved.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id:            { type: 'string', description: 'Target entity ID (e.g. project_redux_mmllm)' },
        name:          { type: 'string', description: 'Replace the entity name' },
        description:   { type: 'string', description: 'Replace the entity description' },
        tags:          { type: 'array', items: { type: 'string' }, description: 'Replace the tag array' },
        relationships: { type: 'object', description: 'Merge into existing edges: { "related_to": ["other_id"] }' },
        lastVerified:  { type: 'boolean', description: 'Stamp metadata.lastVerified with today — marks entity as confirmed accurate' },
      },
    },
  },
  {
    name: 'tome_relate',
    description: 'Add a typed relationship edge between two existing entities.',
    inputSchema: {
      type: 'object',
      required: ['fromId', 'toId', 'relationType'],
      properties: {
        fromId:       { type: 'string' },
        toId:         { type: 'string' },
        relationType: { type: 'string', description: 'works_on | depends_on | related_to | collaborates_with | part_of | uses | manages | aspect_of | superseded_by' },
      },
    },
  },
  {
    name: 'load',
    description: 'Load the Grimoire session briefing: identity, interrupted sessions, recent dreams, cheat codes, active goals.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'session_save',
    description: 'Save and close the current session with a summary of what happened.',
    inputSchema: {
      type: 'object',
      required: ['summary'],
      properties: {
        topic:     { type: 'string' },
        summary:   { type: 'string' },
        learned:   { type: 'array', items: { type: 'string' } },
        nextSteps: { type: 'array', items: { type: 'string' } },
        decisions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'divine_health',
    description: 'Get the current health score, grade, and issue breakdown of the knowledge graph.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'noise_floor_think',
    description: 'Add a thought to the Grimoire stream of consciousness.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:   { type: 'string' },
        type:   { type: 'string', description: 'observation | realization | question | focus | decision' },
        source: { type: 'string' },
      },
    },
  },
  {
    name: 'scribe',
    description: 'Rebuild the graph index from entity files on disk and bust the server cache. Use after direct file edits.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'crawl',
    description: 'Extract entities from raw text or source code and write them to the KB. Handles prose (notes, diary) and code (JS, Python, Bash, Java). Extracts concepts, components, leverage points, and expansion vectors.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:     { type: 'string', description: 'Raw text or source code to ingest' },
        source:   { type: 'string', description: 'Filename or label for provenance (e.g. "server.js", "diary-2026-04-18.md")' },
        language: { type: 'string', description: 'Override language detection: javascript | python | bash | java | text' },
        dryRun:   { type: 'boolean', description: 'Preview extracted entities without writing to KB' },
        noNer:    { type: 'boolean', description: 'Skip GLiNER NER pre-pass (faster, prose only)' },
      },
    },
  },
  {
    name: 'config_get',
    description: 'Get the canonical lbl-config.json (shared homelab topology: endpoints, use routing), or a single value at a dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dot-path into the config, e.g. "use.coding"' },
      },
    },
  },
  {
    name: 'grim_features',
    description: 'List feature-request entities from the KB, grouped by project. Use before proposing a new feature to check for duplicates and find the right project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter by project ID (e.g. project_grimoire). Omit for all.' },
        json:    { type: 'boolean', description: 'Return JSON instead of human-readable text' },
      },
    },
  },
]

async function executeMCPTool(name, args) {
  switch (name) {
    case 'oracle_search': {
      const graph   = await getGraph()
      const results = search(graph, {
        query: args.query || null,
        tag:   args.tag   || null,
        type:  args.type  || null,
        depth: Number(args.depth || 0),
        limit: Number(args.limit || 10),
      })
      return { results: results.map(r => {
        enrichWithContext(r, graph)
        return { ...r.entity, _score: r.score, _hops: r.hops, _context: r._context }
      })}
    }

    case 'tome_recall': {
      const results = await recall(args.query, { depth: Number(args.depth || 1) })
      return { results: results.map(r => ({ ...r.entity, _score: r.score, _hops: r.hops })) }
    }

    case 'tome_remember': {
      const { type, ...rest } = args
      const result = await remember({ '@type': type, ...rest })
      _graphCache  = null
      return result
    }

    case 'tome_update': {
      const { id, ...patches } = args
      const result = await update(id, patches)
      _graphCache  = null
      return result
    }

    case 'tome_relate': {
      const result = await relate(args.fromId, args.toId, args.relationType)
      _graphCache  = null
      return result
    }

    case 'load': {
      return await loadBriefing()
    }

    case 'session_save': {
      const result = await saveSession(args)
      _graphCache  = null
      return result
    }

    case 'divine_health': {
      const graph   = await getGraph()
      const results = runChecks(graph)
      const scoring = computeScore(results)
      return { ...results, ...scoring }
    }

    case 'noise_floor_think': {
      const thoughts = loadThoughts()
      thoughts.push({ at: new Date().toISOString(), text: args.text, source: args.source || 'mcp', type: args.type || 'observation' })
      saveThoughts(thoughts)
      return { ok: true }
    }

    case 'scribe': {
      const { scribe } = require('./grim-scribe')
      await scribe()
      _graphCache    = null
      _graphCachedAt = 0
      const graph    = await getGraph()
      return { ok: true, entities: Object.keys(graph.entities).length, edges: graph._meta?.edgeCount ?? 0 }
    }

    case 'crawl': {
      const result = await crawlText({
        text:     args.text,
        source:   args.source   || 'mcp',
        language: args.language || null,
        dryRun:   args.dryRun   ?? false,
        noNer:    args.noNer    ?? false,
      })
      if (!args.dryRun && result.entitiesCreated > 0) {
        _graphCache    = null
        _graphCachedAt = 0
      }
      return result
    }

    case 'config_get': {
      const cfg = loadLblConfig()
      if (!args.path) return cfg
      const value = dotGet(cfg, args.path)
      if (value === undefined) throw new Error(`path not found: ${args.path}`)
      return { path: args.path, value }
    }

    case 'grim_features': {
      const { listFeatures } = require('./grim-features')
      const result = await listFeatures({ project: args.project || null, json: args.json ?? false })
      return typeof result === 'string' ? { text: result } : result
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

app.post('/mcp', async (req, res) => {
  const rpc = req.body

  // Handle batch
  if (Array.isArray(rpc)) {
    const responses = await Promise.all(rpc.map(r => handleRPC(r)))
    const out = responses.filter(Boolean)
    return res.json(out.length === 1 ? out[0] : out)
  }

  const response = await handleRPC(rpc)
  if (response === null) return res.status(202).end()
  res.json(response)
})

async function handleRPC(rpc) {
  const { id, method, params } = rpc

  try {
    switch (method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: {
          protocolVersion: MCP_VERSION,
          capabilities:    { tools: {} },
          serverInfo:      { name: 'grimoire', version: '0.1.0' },
        }}

      case 'notifications/initialized':
        return null // notification, no response

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }

      case 'tools/call': {
        const { name, arguments: args = {} } = params || {}
        const result = await executeMCPTool(name, args)
        return { jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }}
      }

      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    }
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
// Guarded so `require('./grim-server')` (e.g. from tests) never binds the real
// port — only running this file directly starts the listener.

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    try {
      const graph = await getGraph()
      const m     = graph._meta || {}
      const _host = config.host || `http://localhost:${PORT}`
      console.log(`\n  ░ Grimoire online.`)
      console.log(`    http://0.0.0.0:${PORT}  (LAN: ${_host})`)
      console.log(`    MCP endpoint: ${_host.replace(/\/$/, '')}/mcp`)
      console.log(`    Entities: ${m.entityCount || '?'}  Edges: ${m.edgeCount || '?'}`)
      console.log(`    Noise Floor: ${path.relative(process.cwd(), NOISE_FILE)}\n`)
    } catch (e) {
      console.log(`\n  ░ Grimoire online (graph not yet indexed — run grim scribe).`)
      console.log(`    http://0.0.0.0:${PORT}\n`)
    }
  })
}

module.exports = { app, pickProjectDetail }
