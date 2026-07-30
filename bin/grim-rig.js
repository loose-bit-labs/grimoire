#!/usr/bin/env node
'use strict'

/**
 * grim-rig.js — Homelab AI service monitor (sensor layer)
 *
 * Shows VRAM headroom and service status across all boxes at a glance.
 * Phase 1 is read-only. Phase 2 (not built) adds start/stop control.
 *
 * Design principle: sensors before control plane — don't build the switch
 * until you can see what it's switching.
 *
 * CLI:
 *   grim rig                             Show all boxes (default: status)
 *   grim rig status [--json]             Machine-readable output
 *   grim rig up <service> [--box <name>] systemctl start
 *   grim rig down <service> [--box]      systemctl stop
 *
 * ── Config ────────────────────────────────────────────────────────────────────
 * Box inventory lives in $GRIMOIRE_ROOT/rig.json — NOT in this file.
 * Copy rig.example.json from the engine root and edit it locally.
 * That file is never committed to the engine repo.
 *
 * ── Service checks ────────────────────────────────────────────────────────────
 * HTTP probe: `curl -sf --max-time N <url>` — up if curl exits 0
 * pgrep:      `pgrep -f <pattern>` — up if any matching process exists
 *
 * ── SSH ───────────────────────────────────────────────────────────────────────
 * BatchMode=yes means key-based auth only — no interactive prompts.
 * Local detection: if hostname matches box.aliases, runs bash directly.
 *
 * Each service in rig.json may include a "unit" field to override the systemctl
 * unit name (defaults to service name). Requires passwordless sudo or root SSH.
 */

const { exec }   = require('node:child_process')
const fs         = require('node:fs')
const os         = require('node:os')
const path       = require('node:path')
const minimist   = require('minimist')
const { config } = require('../lib/env')

const LOCAL_HOSTNAME = os.hostname().toLowerCase()

/**
 * Fetch a JSON endpoint with timeout. Returns parsed object or throws.
 */
function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    http.get(url, { signal: AbortSignal.timeout(timeoutMs) }, res => {
      clearTimeout(timer)
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(new Error(`invalid JSON: ${e.message}`)) }
      })
    }).on('error', e => { clearTimeout(timer); reject(e) })
  })
}

// ── Load box config ───────────────────────────────────────────────────────────

function loadBoxes() {
  const configPath = config.root ? path.join(config.root, 'rig.json') : null

  if (!configPath || !fs.existsSync(configPath)) {
    const examplePath = path.join(__dirname, '..', 'rig.example.json')
    console.error('grim rig: no box config found.')
    console.error(`  Expected: ${configPath || '$GRIMOIRE_ROOT/rig.json'}`)
    console.error(`  Copy ${examplePath} → ${configPath || '$GRIMOIRE_ROOT/rig.json'} and edit it.`)
    process.exit(1)
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    console.error(`grim rig: failed to parse rig.json — ${e.message}`)
    process.exit(1)
  }
}

/**
 * Load box config gracefully — returns [] instead of exiting when missing.
 * Used by serve() so the agent boots without rig.json (client boxes).
 */
function loadBoxesGraceful() {
  const configPath = config.root ? path.join(config.root, 'rig.json') : null

  if (!configPath || !fs.existsSync(configPath)) {
    if (configPath) {
      process.stderr.write(`grim rig: no box config at ${configPath} — running with empty service list\n`)
    } else {
      process.stderr.write('grim rig: $GRIMOIRE_ROOT not set — running with empty service list\n')
    }
    return []
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    process.stderr.write(`grim rig: failed to parse rig.json — ${e.message} — running with empty service list\n`)
    return []
  }
}

// ── Script execution — local or SSH ──────────────────────────────────────────
//
// If we're on the target box (hostname matches aliases), run bash locally.
// Otherwise, pipe the script to `ssh host bash`.
//
// Piping to bash stdin avoids all quote-escaping nightmares.
// SSH BatchMode=yes: fail immediately if key auth isn't available (no prompts).

function runScript(box, script, timeout = 12000) {
  const isLocal = (box.aliases || []).includes(LOCAL_HOSTNAME)
  return new Promise(resolve => {
    const cmd  = isLocal ? 'bash' : `ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${box.host} bash`
    const proc = exec(cmd, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout + stderr).trim() })
    })
    proc.stdin.end(script)
  })
}

// ── Build check script for a box ──────────────────────────────────────────────
//
// Each line of output corresponds to one check:
//   Line 0:   VRAM — raw nvidia-smi CSV or "NO_GPU"
//   Line 1+:  "servicename:OK" or "servicename:FAIL"

function buildScript(box) {
  const lines = [
    // VRAM: output raw CSV (name, used_MiB, free_MiB, total_MiB) or NO_GPU
    `nvidia-smi --query-gpu=name,memory.used,memory.free,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo NO_GPU`,
    // Services: each outputs "name:OK" or "name:FAIL"
    ...box.services.map(s => `{ ${s.check}; } && echo "${s.name}:OK" || echo "${s.name}:FAIL"`),
  ]
  return lines.join('\n')
}

// ── Parse box output ──────────────────────────────────────────────────────────

function parseVRAM(line) {
  if (!line || line === 'NO_GPU') return null
  const parts = line.split(',').map(s => s.trim())
  if (parts.length < 4) return null
  const used  = parseInt(parts[1])
  const free  = parseInt(parts[2])
  const total = parseInt(parts[3])
  if (isNaN(used) || isNaN(total)) return null
  return { name: parts[0], used, free, total }
}

function parseBoxOutput(box, out) {
  const lines    = out.split('\n').filter(Boolean)
  const gpu      = parseVRAM(lines[0])
  const services = []

  for (const line of lines.slice(1)) {
    const m = line.match(/^(.+):(OK|FAIL)$/)
    if (m) services.push({ name: m[1], up: m[2] === 'OK' })
  }

  return { host: box.host, label: box.label, note: box.note, reachable: true, gpu, services }
}

// ── Check one box (parallel-safe) ─────────────────────────────────────────────

async function checkBox(box) {
  const script      = buildScript(box)
  const { ok, out } = await runScript(box, script)

  if (!ok && !out) {
    return { host: box.host, label: box.label, note: box.note, reachable: false, gpu: null, services: [] }
  }

  return parseBoxOutput(box, out)
}

// ── Service control (Phase 2) ─────────────────────────────────────────────────
//
// Finds which box(es) run the named service and issues systemctl start/stop.
// If a service exists on multiple boxes, --box is required.
// Each service may optionally declare a `unit` field in rig.json; defaults to name.

// Pure helper — returns matches or throws { code, message } for CLI to handle.
function findBoxesForService(boxes, serviceName, boxFilter) {
  const matches = boxes.filter(b => {
    if (b.skip) return false
    if (boxFilter && b.host !== boxFilter && b.label !== boxFilter) return false
    return (b.services || []).some(s => s.name === serviceName)
  })

  if (matches.length === 0) {
    const where = boxFilter ? ` on box '${boxFilter}'` : ''
    throw { code: 'NOT_FOUND', message: `service '${serviceName}' not found${where}` }
  }

  if (matches.length > 1 && !boxFilter) {
    const names = matches.map(b => b.label).join(', ')
    throw { code: 'AMBIGUOUS', message: `'${serviceName}' found on multiple boxes: ${names} — use --box` }
  }

  return matches
}

async function controlService(action, serviceName, { box: boxFilter } = {}) {
  const boxes = loadBoxes()

  let matches
  try {
    matches = findBoxesForService(boxes, serviceName, boxFilter)
  } catch (e) {
    console.error(`grim rig: ${e.message}`)
    if (e.code === 'NOT_FOUND') console.error(`Run 'grim rig status' to see available services.`)
    process.exit(1)
  }

  const results = await Promise.all(matches.map(async box => {
    const svc = box.services.find(s => s.name === serviceName)
    const ctl = svc.scope === 'user' ? 'systemctl --user' : 'systemctl'
    const unit = svc.unit || serviceName
    const script = action === 'start'
      ? (svc.start || `${ctl} start ${unit}`)
      : (svc.stop  || `${ctl} stop ${unit}`)
    const { ok, out } = await runScript(box, script)
    return { box: box.label, ok, out }
  }))

  for (const r of results) {
    const mark = r.ok ? '✓' : '✗'
    const tail = r.out ? `\n     ${r.out.split('\n').join('\n     ')}` : ''
    console.log(`  ${mark}  ${r.box}  ${action} ${serviceName}${tail}`)
  }

  if (results.some(r => !r.ok)) process.exit(1)
}

// ── Display ───────────────────────────────────────────────────────────────────

const UP   = '●'
const DOWN = '○'
const DASH = '—'

function fmtGPU(gpu) {
  if (!gpu) return null
  const gb    = n => (n / 1024).toFixed(1)
  const pct   = Math.round(gpu.used / gpu.total * 100)
  // Strip verbose vendor prefixes for compact display
  const name  = gpu.name.replace(/^NVIDIA /, '').replace(/^AMD /, '')
  return `${name}  ${gb(gpu.used)}/${gb(gpu.total)} GB  ${pct}%`
}

function fmtServices(services) {
  if (!services.length) return null
  return services.map(s => `${s.name} ${s.up ? UP : DOWN}`).join('  ·  ')
}

function display(results, elapsed) {
  const time = new Date().toTimeString().slice(0, 8)
  const BAR  = '─'.repeat(62)

  console.log(`\n  GRIMOIRE RIG  ${BAR.slice(14)}  ${time}\n`)

  for (const r of results) {
    const label  = r.label.padEnd(10)
    if (!r.reachable) {
      console.log(`  ${label}  unreachable`)
      continue
    }

    const gpuStr = fmtGPU(r.gpu)
    const svcStr = fmtServices(r.services)

    const parts = [label]
    if (gpuStr) parts.push(gpuStr.padEnd(38))
    else        parts.push(DASH.padEnd(38))
    if (svcStr) parts.push(svcStr)
    else if (r.note) parts.push(`(${r.note})`)
    else        parts.push(DASH)

    console.log(`  ${parts.join('  ')}`)
  }

  console.log(`\n  ${UP} running  ${DOWN} stopped    ${elapsed}ms\n`)
}

// ── Status command ────────────────────────────────────────────────────────────

async function status({ json = false } = {}) {
  const t0    = Date.now()
  const boxes = loadBoxes()

  const results = await Promise.all(boxes.filter(b => !b.skip).map(checkBox))
  const elapsed = Date.now() - t0

  if (json) {
    console.log(JSON.stringify({ boxes: results, elapsed }, null, 2))
    return
  }

  display(results, elapsed)
}

// ── Serve — resident telemetry agent ──────────────────────────────────────────

const http      = require('node:http')
const si        = require('systeminformation')

// Well-known ports per service type (used when rig.json doesn't specify one)
const WELL_KNOWN_PORT = { ollama: 11434, llama_cpp: 8080, a1111: 7860, comfyui: 8188 }

/**
 * Normalize a service name from rig.json to a canonical type.
 * Handles common aliases: "comfy" → "comfyui", "a1111" → "a1111", etc.
 */
function serviceType(name) {
  const n = name.toLowerCase().replace(/[-_]/g, '')
  if (n === 'comfyui' || n === 'comfy') return 'comfyui'
  if (n === 'a1111' || n === 'automatic1111' || n === 'auto1111') return 'a1111'
  if (n === 'ollama') return 'ollama'
  if (n === 'llamacpp' || n === 'llamaserver') return 'llama_cpp'
  return null // unknown type — falls back to generic up/down discovery
}

/**
 * Build the metrics endpoint URL for a known service type.
 */
function metricsUrl(base, type) {
  switch (type) {
    case 'ollama':     return `${base}/api/ps`
    case 'llama_cpp':  return `${base}/slots`
    case 'a1111':      return `${base}/sdapi/v1/memory`
    case 'comfyui':    return `${base}/system_stats`
    default:           return null
  }
}

/**
 * Parse rocm-smi text output for GPU%, VRAM%, and temp.
 * Returns { gpuPct, vramPct, temp } or null on failure.
 */
function parseRocmSmi(text) {
  try {
    // Match the data line: Device Node IDs Temp Power ... VRAM% GPU%
    const line = text.split('\n').find(l => l.match(/^\d+\s+\d+\s+0x/))
    if (!line) return null
    // Extract temp: number followed by °C
    const tempMatch = line.match(/(\d+(?:\.\d+)?)°C/)
    // GPU% is the last numeric value before any formatting codes
    const clean = line.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').trim()
    const nums = clean.match(/(\d+(?:\.\d+)?)%/g)
    if (!nums || nums.length < 2) return null
    // Last % is GPU%, second-to-last is VRAM%
    const gpuPct = parseFloat(nums[nums.length - 1])
    const vramPct = parseFloat(nums[nums.length - 2])
    const temp = tempMatch ? parseFloat(tempMatch[1]) : null
    if (isNaN(gpuPct)) return null
    return { gpuPct, vramPct: isNaN(vramPct) ? null : vramPct, temp: isNaN(temp) ? null : temp }
  } catch {
    return null
  }
}

/**
 * AMD VRAM-used fallback — nvidia-smi covers NVIDIA's used-VRAM lookup, but AMD
 * has no equivalent in selectAllComputeGpus. rocm-smi's own VRAM% (parseRocmSmi)
 * is the only source for it, so derive used-MB from total * that percentage.
 */
function _amdVramUsedMb(vramTotalMb, gpuFallback) {
  if (!vramTotalMb || gpuFallback?.vramPct == null) return null
  return Math.round(vramTotalMb * gpuFallback.vramPct / 100)
}

/**
 * Pick the real compute GPU from systeminformation's controller list, dropping
 * BMC / integrated display chips (Matrox, ASPEED, small-VRAM Intel iGPUs).
 *
 * Heuristics (combine, don't rely on one):
 *   - vendor is NVIDIA or AMD → keep
 *   - vram < 256 MB → drop (BMC chips are ~16–64 MB)
 *   - if smiVram is set, trust it for vramTotalMb over si.graphics()
 *
 * Returns the selected controller or null.
 */
function selectComputeGpu(graphics, smiVram) {
  if (!graphics || !graphics.controllers || !graphics.controllers.length) return null
  // Prefer NVIDIA/AMD vendors; drop BMC display chips
  const discrete = graphics.controllers.filter(c => {
    const vendor = (c.vendor || '').toLowerCase()
    const isDiscreteVendor = vendor.includes('nvidia') || vendor.includes('amd')
    const hasRealVram = (c.vram || 0) >= 256 * 1024 * 1024 // 256 MB in KB
    return isDiscreteVendor || hasRealVram
  })
  // Fallback: pick highest-VRAM controller if none matched discrete heuristics
  const candidates = discrete.length > 0 ? discrete : graphics.controllers.slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))
  const chosen = candidates[0]
  if (!chosen) return null
  // When smi reports a real compute GPU VRAM, trust it over si.graphics()
  if (smiVram && smiVram > 0) {
    return { ...chosen, vram: smiVram }
  }
  return chosen
}

/**
 * Run rocm-smi and parse GPU metrics. Graceful degradation.
 */
async function getGpuMetricsFallback() {
  return new Promise(resolve => {
    const { exec } = require('node:child_process')
    exec('rocm-smi 2>&1', { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      resolve(parseRocmSmi(stdout))
    })
  })
}

/**
 * Parse `nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits`
 * output — a single "util, temp" CSV line, e.g. "12, 45".
 */
function parseNvidiaSmi(text) {
  try {
    const line = text.split('\n')[0].trim()
    const parts = line.split(',').map(s => s.trim())
    if (parts.length < 2) return null
    const gpuPct = parseFloat(parts[0])
    const temp = parseFloat(parts[1])
    if (isNaN(gpuPct)) return null
    return { gpuPct, temp: isNaN(temp) ? null : temp }
  } catch {
    return null
  }
}

/**
 * Run nvidia-smi and parse GPU metrics. Graceful degradation.
 */
async function getGpuMetricsFallbackNvidia() {
  return new Promise(resolve => {
    const { exec } = require('node:child_process')
    exec('nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>&1', { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      resolve(parseNvidiaSmi(stdout))
    })
  })
}

/**
 * Parse `nvidia-smi --query-gpu=index,memory.total,memory.used,utilization.gpu,
 * temperature.gpu --format=csv,noheader,nounits` output.
 *
 * nounits strips all unit suffixes (MiB, %) — each line is plain comma-separated
 * numbers, e.g. "1, 24576, 21276, 0, 57". Non-matching lines are skipped.
 *
 * Returns [{ index, memoryTotal, memoryUsed, util, temp }] or [] on empty input.
 */
function parseSmiGpus(stdout) {
  if (!stdout || !stdout.trim()) return []
  const gpus = []
  for (const line of stdout.trim().split('\n')) {
    const m = /^(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)$/.exec(line.trim())
    if (m) gpus.push({
      index: parseInt(m[1], 10),
      memoryTotal: parseInt(m[2], 10),
      memoryUsed: parseInt(m[3], 10),
      util: parseInt(m[4], 10),
      temp: parseInt(m[5], 10),
    })
  }
  return gpus
}

/**
 * Query nvidia-smi for per-GPU memory totals/usage, utilization%, and temp.
 * Graceful degradation: missing nvidia-smi / exec error → [].
 */
async function getSmiGpus() {
  return new Promise(resolve => {
    const { exec } = require('node:child_process')
    exec('nvidia-smi --query-gpu=index,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>&1', { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([])
      resolve(parseSmiGpus(stdout))
    })
  })
}

/**
 * Select all compute GPUs from systeminformation's controller list, dropping BMC
 * / integrated display chips. Cross-reference with nvidia-smi per-GPU VRAM when
 * available (smi is the compute-truth source for VRAM totals).
 *
 * Returns [{ vendor, model, vram, vramUsed, index }] or [].
 */
function selectAllComputeGpus(graphics, smiGpus) {
  if (!graphics || !graphics.controllers || !graphics.controllers.length) return []
  // Filter: NVIDIA/AMD vendor, or vram >= 256 MB
  const discrete = graphics.controllers.filter(c => {
    const vendor = (c.vendor || '').toLowerCase()
    const isDiscreteVendor = vendor.includes('nvidia') || vendor.includes('amd')
    const hasRealVram = (c.vram || 0) >= 256 * 1024 * 1024 // 256 MB in KB
    return isDiscreteVendor || hasRealVram
  })
  const candidates = discrete.length > 0 ? discrete : graphics.controllers.slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))
  // Cross-reference with nvidia-smi for per-GPU VRAM
  const smiMap = {}
  for (const s of (smiGpus || [])) smiMap[s.index] = s
  return candidates.map((c, i) => {
    const smi = smiMap[i]
    if (smi) {
      return { vendor: c.vendor, model: c.model, vram: smi.memoryTotal, vramUsed: smi.memoryUsed, util: smi.util, temp: smi.temp, index: i }
    }
    return { vendor: c.vendor, model: c.model, vram: c.vram, vramUsed: c.memoryUsed, util: undefined, temp: undefined, index: i }
  })
}

/**
 * Query nvidia-smi for per-process GPU memory usage.
 * Returns [{ pid, usedMiB, name }] or [] on failure / no NVIDIA GPU.
 * Graceful degradation: missing nvidia-smi or non-NVIDIA GPU → [].
 */
async function getComputeApps() {
  return new Promise(resolve => {
    const { exec } = require('node:child_process')
    exec('nvidia-smi --query-compute-apps=pid,used_memory,name --format=csv,noheader 2>&1', { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) return resolve([])
      const apps = []
      for (const line of stdout.trim().split('\n')) {
        const m = /^(\d+),\s*(\d+)\s*MiB,\s*(.+)$/.exec(line.trim())
        if (m) apps.push({ pid: parseInt(m[1], 10), usedMiB: parseInt(m[2], 10), name: m[3].trim() })
      }
      resolve(apps)
    })
  })
}

/**
 * Poll a single service's metrics endpoint.
 * Returns { up, models, vram, queue, running } or null on failure.
 */
async function pollService(url, type, timeout = 2000) {
  return new Promise(resolve => {
    const { get } = require('node:http')
    const timer = setTimeout(() => { resolve(null) }, timeout)
    get(url, { signal: AbortSignal.timeout(timeout) }, res => {
      clearTimeout(timer)
      if (res.statusCode !== 200) return resolve(null)
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          resolve(parseServiceMetrics(data, type))
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

/**
 * Parse raw JSON response into normalized service metrics.
 */
function parseServiceMetrics(data, type) {
  switch (type) {
    case 'ollama': {
      const models = []
      if (data.models) {
        for (const m of data.models) {
          models.push({ name: m.model, vram: m.total_vram || 0, loaded: true })
        }
      } else if (data.models === undefined) {
        // /api/ps may return { "models": [...] } or just {}
        // Also check top-level for single-model response
        if (data.model) {
          models.push({ name: data.model, vram: data.total_vram || 0, loaded: true })
        }
      }
      return { models, queue: 0, running: models.length }
    }
    case 'comfyui': {
      // system_stats returns { GPU: [{ ... }] } or { memory: {...}, ... }
      const models = []
      const queue = data.queue_pending || 0
      const running = data.queue_running || 0
      if (data.GPU) {
        for (const g of data.GPU) {
          if (g.allocated && g.total) {
            models.push({ name: g.name || 'gpu', vram: g.allocated, loaded: true })
          }
        }
      }
      return { models, vramUsed: data.GPU?.[0]?.allocated, vramTotal: data.GPU?.[0]?.total, queue, running }
    }
    case 'a1111': {
      // /sdapi/v1/memory returns { vram: { total, allocated, swapped } }
      const models = []
      const vram = data.vram || {}
      return { models, vramUsed: vram.allocated, vramTotal: vram.total, queue: 0, running: 0 }
    }
    case 'llama_cpp': {
      // /slots returns array of slot objects
      const slots = Array.isArray(data) ? data : []
      const models = []
      let running = 0
      let queue = 0
      let activeSlots = 0
      let totalPromptTokens = 0
      let totalDecoded = 0
      for (const s of slots) {
        if (s.prompt) {
          models.push({ name: s.prompt?.slice(0, 60) || 'unknown', vram: 0, loaded: true })
          running++
        } else if (s.idling) {
          // idle slot — may have a model loaded
          if (s.model_path) {
            models.push({ name: s.model_path.split('/').pop() || 'unknown', vram: 0, loaded: true })
          }
        }
        if (s.is_processing) activeSlots++
        totalPromptTokens += s.n_prompt_tokens || 0
        totalDecoded += s.next_token?.[0]?.n_decoded || 0
      }
      return { models, queue, running, activeSlots, totalPromptTokens, totalDecoded }
    }
    default:
      return { models: [], queue: 0, running: 0 }
  }
}

/**
 * Discover running systemd --user services locally, no rig.json config needed.
 * Mirrors ~/bin/all-my-user-services.sh (unit list) + `ss -ltnp` (port lookup).
 * Graceful degradation: any failure (no systemctl, no ss, timeout) → [].
 */
function discoverLocalServices() {
  const { execSync } = require('node:child_process')
  let unitLines
  try {
    unitLines = execSync('systemctl --user list-units --type=service --state=running --no-legend --plain', { timeout: 3000 }).toString().split('\n')
  } catch {
    return []
  }

  let ssOut = ''
  try {
    ssOut = execSync('ss -ltnp', { timeout: 3000 }).toString()
  } catch { /* graceful degradation — services still reported, just no port */ }

  const services = []
  for (const line of unitLines) {
    const m = line.trim().match(/^(\S+)\.service\s/)
    if (!m) continue
    const name = m[1]
    // Only report units that map to a known generation-service type —
    // Discord bots, world servers, etc. aren't gen-hotspots signal.
    if (!serviceType(name)) continue

    const pid = _mainPid(name)
    if (!pid) continue
    const port = _listeningPort(ssOut, pid)
    if (!port) continue

    services.push({ name, port })
  }
  return services
}

function _mainPid(unitName) {
  const { execSync } = require('node:child_process')
  try {
    const pid = execSync(`systemctl --user show ${unitName}.service -p MainPID --value`, { timeout: 2000 }).toString().trim()
    return pid && pid !== '0' ? pid : null
  } catch {
    return null
  }
}

function _listeningPort(ssOut, pid) {
  const line = ssOut.split('\n').find(l => l.includes(`pid=${pid},`))
  if (!line) return null
  const m = line.match(/:(\d+)\s+\S+:\*/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Build the snapshot of host + service metrics.
 * Called by the poller loop; never blocks HTTP responses.
 */
async function buildSnapshot(boxes) {
  const hostname = os.hostname().toLowerCase()

  // Find local box entry
  const localBox = boxes.find(b => {
    if (b.skip) return false
    return (b.aliases || []).includes(hostname) || b.host === hostname || b.label === hostname
  })

  // rig.json service lists are optional — no config means auto-discover
  // whatever's actually running via systemd, so boxes never go stale.
  const declared = localBox?.services || []
  const svcList = declared.length > 0 ? declared : discoverLocalServices()

  const services = []
  for (const svc of svcList) {
    const type = serviceType(svc.name)
    if (!type) continue // unknown service type — skip metrics

    const port = svc.port || WELL_KNOWN_PORT[type] || 0
    if (!port) continue

    const endpoint = metricsUrl(`http://127.0.0.1:${port}`, type)
    if (!endpoint) continue

    const svcMetrics = await pollService(endpoint, type, 200)
    services.push({
      name: svc.name,
      up: svcMetrics !== null,
      type,
      models: svcMetrics?.models || [],
      vramUsed: svcMetrics?.vramUsed,
      vramTotal: svcMetrics?.vramTotal,
      queue: svcMetrics?.queue || 0,
      running: svcMetrics?.running || 0,
      activeSlots: svcMetrics?.activeSlots || 0,
      totalPromptTokens: svcMetrics?.totalPromptTokens || 0,
      totalDecoded: svcMetrics?.totalDecoded || 0,
    })
  }

  // Host metrics
  let cpuLoad = 0
  let memUsed = 0
  let memTotal = 0
  let gpuInfo = null
  let gpuFallback = null
  let allGpus = []

  try {
    const [load, mem, graphics] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.graphics().catch(() => null),
    ])

    if (load) cpuLoad = load.currentLoad
    // mem.used is raw total-free — counts reclaimable buff/cache as "used",
    // which on a box with a large page cache (e.g. LLM weights) reads as
    // near-100% even when actual pressure is low. mem.available (matches
    // `free`'s "available" column) is the real signal; fall back to mem.used
    // if a platform doesn't report it.
    if (mem) { memUsed = mem.available != null ? mem.total - mem.available : mem.used; memTotal = mem.total }
    // Collect all real compute GPUs, not just index 0
    const smiGpus = await getSmiGpus().catch(() => [])
    allGpus = selectAllComputeGpus(graphics, smiGpus)
    gpuInfo = allGpus[0] || null
    gpuFallback = allGpus.length > 0 && (allGpus[0].vendor || '').includes('AMD')
      ? await getGpuMetricsFallback().catch(() => null)
      : allGpus.length > 0 && (allGpus[0].vendor || '').includes('NVIDIA')
      ? await getGpuMetricsFallbackNvidia().catch(() => null)
      : null
  } catch { /* graceful degradation — host metrics may be partial */ }

  // Per-process GPU memory consumers (NVIDIA only; [] on AMD / no nvidia-smi)
  const computeApps = await getComputeApps().catch(() => [])

  let diskUsedPct = 0
  try {
    const fs = await si.fsSize().catch(() => [])
    if (fs && fs.length > 0) {
      const root = fs.find(f => f.mount === '/') || fs[0]
      if (root) diskUsedPct = root.use || 0
    }
  } catch { /* graceful degradation */ }

  return {
    host: {
      hostname,
      cpuPercent: Math.round(cpuLoad * 100) / 100,
      memUsedMb: Math.round(memUsed / 1024 / 1024),
      memTotalMb: Math.round(memTotal / 1024 / 1024),
      diskUsedPercent: Math.round(diskUsedPct * 100) / 100,
      gpus: allGpus.map(g => ({
        vendor: g.vendor,
        model: g.model,
        vramTotalMb: g.vram,
        vramUsedMb: g.index === 0 ? (g.vramUsed ?? _amdVramUsedMb(g.vram, gpuFallback)) : (g.vramUsed ?? null),
        // nvidia-smi reports util/temp per GPU — use it directly when present so
        // every card on a multi-GPU box (not just index 0) gets real numbers.
        gpuPercent: g.util ?? (g.index === 0 ? (gpuFallback?.gpuPct ?? (() => {
          const total = g.vram
          if (!total || total < 256) return null
          const used = computeApps.reduce((s, a) => s + a.usedMiB, 0)
          if (used === 0) return null
          const pct = Math.round(used / total * 100)
          return pct > 100 ? null : pct
        })()) : null),
        tempC: g.temp ?? (g.index === 0 ? (g.temperatureGpu || gpuFallback?.temp || null) : null),
        computeApps: g.index === 0 ? computeApps : [],
        index: g.index,
      })),
      gpu: allGpus[0] ? {
        vendor: allGpus[0].vendor,
        model: allGpus[0].model,
        vramTotalMb: allGpus[0].vram,
        vramUsedMb: allGpus[0].vramUsed ?? _amdVramUsedMb(allGpus[0].vram, gpuFallback),
        gpuPercent: gpuFallback?.gpuPct ?? (() => {
          const total = allGpus[0].vram
          if (!total || total < 256) return null
          const used = computeApps.reduce((s, a) => s + a.usedMiB, 0)
          if (used === 0) return null
          const pct = Math.round(used / total * 100)
          return pct > 100 ? null : pct
        })(),
        tempC: allGpus[0].temperatureGpu || gpuFallback?.temp || null,
        computeApps,
      } : null,
    },
    services,
    lastUpdated: new Date().toISOString(),
  }
}

/**
 * Convert snapshot to Prometheus text format.
 */
function toPrometheusText(snapshot) {
  const lines = []
  const h = snapshot.host
  const node = h.hostname

  // Host metrics
  lines.push(`# HELP gen_host_cpu_percent Current CPU utilization percentage`)
  lines.push(`# TYPE gen_host_cpu_percent gauge`)
  lines.push(`gen_host_cpu_percent{node="${node}"} ${h.cpuPercent}`)

  lines.push(`# HELP gen_host_mem_used_mb Used memory in megabytes`)
  lines.push(`# TYPE gen_host_mem_used_mb gauge`)
  lines.push(`gen_host_mem_used_mb{node="${node}"} ${h.memUsedMb}`)

  lines.push(`# HELP gen_host_mem_total_mb Total memory in megabytes`)
  lines.push(`# TYPE gen_host_mem_total_mb gauge`)
  lines.push(`gen_host_mem_total_mb{node="${node}"} ${h.memTotalMb}`)

  lines.push(`# HELP gen_host_disk_used_percent Disk usage percentage`)
  lines.push(`# TYPE gen_host_disk_used_percent gauge`)
  lines.push(`gen_host_disk_used_percent{node="${node}"} ${h.diskUsedPercent}`)

  // GPU metrics — one series per GPU with {gpu="N"} label
  // Backward compat: if gpus array is absent but gpu alias exists, emit unlabeled
  const gpuSeries = h.gpus && h.gpus.length > 0 ? h.gpus : (h.gpu ? [{ ...h.gpu, index: 0 }] : [])
  for (const g of gpuSeries) {
    const label = h.gpus && h.gpus.length > 0 ? `,gpu="${g.index}"` : ''
    lines.push(`# HELP gen_gpu_vram_total_mb Total GPU VRAM in megabytes`)
    lines.push(`# TYPE gen_gpu_vram_total_mb gauge`)
    lines.push(`gen_gpu_vram_total_mb{node="${node}"${label}} ${g.vramTotalMb}`)

    if (g.vramUsedMb != null) {
      lines.push(`# HELP gen_gpu_vram_used_mb Used GPU VRAM in megabytes`)
      lines.push(`# TYPE gen_gpu_vram_used_mb gauge`)
      lines.push(`gen_gpu_vram_used_mb{node="${node}"${label}} ${g.vramUsedMb}`)
    }

    if (g.gpuPercent != null) {
      lines.push(`# HELP gen_gpu_util_percent GPU utilization percentage`)
      lines.push(`# TYPE gen_gpu_util_percent gauge`)
      lines.push(`gen_gpu_util_percent{node="${node}"${label}} ${g.gpuPercent}`)
    }

    if (g.tempC != null) {
      lines.push(`# HELP gen_gpu_temp_c GPU temperature in Celsius`)
      lines.push(`# TYPE gen_gpu_temp_c gauge`)
      lines.push(`gen_gpu_temp_c{node="${node}"${label}} ${g.tempC}`)
    }
  }

  // Service metrics
  for (const svc of snapshot.services) {
    const label = svc.name
    const svcNode = node

    // Service up gauge
    lines.push(`# HELP gen_service_up Whether the service is reachable`)
    lines.push(`# TYPE gen_service_up gauge`)
    lines.push(`gen_service_up{node="${svcNode}",service="${label}"} ${svc.up ? 1 : 0}`)

    // Queue pending
    lines.push(`# HELP gen_queue_pending Pending jobs in service queue`)
    lines.push(`# TYPE gen_queue_pending gauge`)
    lines.push(`gen_queue_pending{node="${svcNode}",service="${label}"} ${svc.queue}`)

    // Running count
    lines.push(`# HELP gen_requests_running Currently running jobs`)
    lines.push(`# TYPE gen_requests_running gauge`)
    lines.push(`gen_requests_running{node="${svcNode}",service="${label}"} ${svc.running}`)

    // Llama-cpp slot telemetry
    if (svc.type === 'llama_cpp') {
      lines.push(`# HELP gen_llama_active_slots Actively processing slots`)
      lines.push(`# TYPE gen_llama_active_slots gauge`)
      lines.push(`gen_llama_active_slots{node="${svcNode}",service="${label}"} ${svc.activeSlots}`)

      lines.push(`# HELP gen_llama_prompt_tokens Total prompt tokens across all slots`)
      lines.push(`# TYPE gen_llama_prompt_tokens gauge`)
      lines.push(`gen_llama_prompt_tokens{node="${svcNode}",service="${label}"} ${svc.totalPromptTokens}`)

      lines.push(`# HELP gen_llama_decoded_tokens Total decoded tokens across all slots`)
      lines.push(`# TYPE gen_llama_decoded_tokens gauge`)
      lines.push(`gen_llama_decoded_tokens{node="${svcNode}",service="${label}"} ${svc.totalDecoded}`)
    }

    // Per-model metrics
    for (const m of svc.models) {
      const modelName = m.name.replace(/"/g, '\\"')
      lines.push(`# HELP gen_model_loaded Whether a model is loaded in this service`)
      lines.push(`# TYPE gen_model_loaded gauge`)
      lines.push(`gen_model_loaded{node="${svcNode}",service="${label}",model="${modelName}"} 1`)

      if (m.vram) {
        lines.push(`# HELP gen_model_vram_mb VRAM used by a loaded model`)
        lines.push(`# TYPE gen_model_vram_mb gauge`)
        lines.push(`gen_model_vram_mb{node="${svcNode}",service="${label}",model="${modelName}"} ${m.vram}`)
      }
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Start the telemetry serve loop.
 * @param {object} opts
/**
 * GET /fleet — server-side fan-out to all rig.json boxes' /status.
 * Returns { boxes: [{name, util, vramUsed, vramTotal, temp, model, gpu, up}] }.
 * A down box → up:false, never fails the whole response.
 */
function httpGetJson(url, timeout = 2000) {
  return new Promise(resolve => {
    const { get } = require('node:http')
    const timer = setTimeout(() => { resolve(null) }, timeout)
    get(url, { signal: AbortSignal.timeout(timeout) }, res => {
      clearTimeout(timer)
      if (res.statusCode !== 200) return resolve(null)
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch { resolve(null) }
      })
    }).on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

/**
 * Reduce a /status response's host.gpus (or legacy host.gpu) into one summary
 * for the fleet view — sum VRAM across every GPU, take the max util/temp (the
 * hottest card is what's worth flagging at a glance), not just GPU 0's numbers.
 * Returns { vramTotal, vramUsed, util, temp, model } in GB / percent / celsius.
 */
function aggregateGpus(host) {
  const gpus = host.gpus && host.gpus.length > 0
    ? host.gpus
    : (host.gpu ? [host.gpu] : [])
  const vramTotal = gpus.reduce((s, g) => s + (g.vramTotalMb || 0), 0) / 1024
  const vramUsed = gpus.reduce((s, g) => s + (g.vramUsedMb || 0), 0) / 1024
  const util = gpus.length > 0 ? Math.max(...gpus.map(g => g.gpuPercent ?? 0)) : 0
  const temp = gpus.length > 0 ? Math.max(...gpus.map(g => g.tempC ?? 0)) : 0
  const model = gpus.length === 0 ? '—' : gpus.length === 1 ? gpus[0].model : `${gpus[0].model} ×${gpus.length}`
  return { vramTotal, vramUsed, util, temp, model }
}

async function getFleet(boxes) {
  const results = []
  for (const box of boxes) {
    if (box.skip) continue
    const boxName = box.label || box.host
    // Find a reachable address for this box
    let addr = null
    if (boxName === LOCAL_HOSTNAME) {
      addr = 'http://127.0.0.1:18081/status'
    } else {
      // Try box host on port 18081
      addr = `http://${boxName}:18081/status`
    }
    if (!addr) continue

    try {
      const data = await httpGetJson(addr, 2000)
      if (!data || !data.host) throw new Error('no host data')

      const { vramTotal, vramUsed, util, temp, model: gpuModel } = aggregateGpus(data.host)

      // Find loaded model from services
      let model = '—'
      for (const svc of (data.services || [])) {
        if (svc.models && svc.models.length > 0) {
          const loaded = svc.models.find(m => m.loaded)
          if (loaded) { model = loaded.name; break }
        }
      }

      results.push({
        name: boxName,
        util,
        vramUsed: Math.round(vramUsed * 10) / 10,
        vramTotal: Math.round(vramTotal * 10) / 10,
        temp,
        model,
        gpu: gpuModel,
        up: true,
      })
    } catch {
      results.push({ name: boxName, util: 0, vramUsed: 0, vramTotal: 0, temp: 0, model: '—', gpu: '—', up: false })
    }
  }
  return { boxes: results }
}

/**
 * Serve a static file from disk.
 */
function serveStatic(filePath, contentType) {
  try {
    const body = fs.readFileSync(filePath, 'utf8')
    return { status: 200, contentType, body }
  } catch {
    return null
  }
}

/**
 * Serve a dashboard-only HTTP server (no poller, no local metrics).
 * Only exposes /cluster (HTML) and /fleet (JSON aggregate).
 * @param {object} opts
 * @param {number} opts.port — HTTP listen port
 * @param {string} opts.listen — bind address
 * @param {object} opts.boxes — loaded rig.json boxes
 * @returns {object} — { server, stop }
 */
function serveDashboard({ port = 3003, listen = '0.0.0.0', boxes }) {
  // HTTP server — no poller, no local snapshot
  const server = http.createServer(async (req, res) => {
    if (req.url === '/cluster' && req.method === 'GET') {
      const htmlPath = path.join(__dirname, '..', 'deploy', 'rig-cluster.html')
      const result = serveStatic(htmlPath, 'text/html; charset=utf-8')
      if (result) {
        res.writeHead(result.status, { 'Content-Type': result.contentType })
        res.end(result.body)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('cluster page not found\n')
      }
      return
    }

    if (req.url === '/fleet' && req.method === 'GET') {
      try {
        const fleet = await getFleet(boxes)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(fleet))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found\n')
  })

  server.on('error', (e) => {
    process.stderr.write(`grim rig serve --dashboard: server error: ${e.message}\n`)
  })

  server.listen(port, listen, () => {
    console.log(`grim rig serve --dashboard: listening on ${listen}:${port}`)
    console.log(`  /cluster — instrument cluster (HTML)`)
    console.log(`  /fleet   — aggregate fleet status (JSON)`)
  })

  return {
    server,
    stop() {
      return new Promise(resolve => server.close(resolve))
    },
  }
}

/**
 * @param {number} opts.port — HTTP listen port
 * @param {number} opts.interval — poll interval in seconds
 * @param {string} opts.listen — bind address
 * @param {object} opts.boxes — loaded rig.json boxes
 * @returns {object} — { server, stop }
 */
function serve({ port = 18081, interval = 5, listen = '127.0.0.1', boxes }) {
  // Scrub X11 env vars so si.graphics() → xrandr fails instantly/silently
  // instead of spamming "X11 connection rejected" on every poll.
  delete process.env.DISPLAY
  delete process.env.XAUTHORITY

  let snapshot = {
    host: { hostname: os.hostname().toLowerCase(), cpuPercent: 0, memUsedMb: 0, memTotalMb: 0, diskUsedPercent: 0, gpu: null },
    services: [],
    lastUpdated: null,
  }

  // Background poller loop
  let running = true
  const poll = async () => {
    while (running) {
      try {
        snapshot = await buildSnapshot(boxes)
      } catch (e) {
        // Never crash the server on poll failure
        process.stderr.write(`grim rig serve: poll error: ${e.message}\n`)
      }
      await new Promise(r => setTimeout(r, interval * 1000))
    }
  }
  poll()

  // HTTP server
  const server = http.createServer(async (req, res) => {
    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(snapshot, null, 2))
      return
    }

    if (req.url === '/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(toPrometheusText(snapshot))
      return
    }

    if (req.url === '/cluster' && req.method === 'GET') {
      const htmlPath = path.join(__dirname, '..', 'deploy', 'rig-cluster.html')
      const result = serveStatic(htmlPath, 'text/html; charset=utf-8')
      if (result) {
        res.writeHead(result.status, { 'Content-Type': result.contentType })
        res.end(result.body)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('cluster page not found\n')
      }
      return
    }

    if (req.url === '/fleet' && req.method === 'GET') {
      try {
        const fleet = await getFleet(boxes)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(fleet))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found\n')
  })

  server.on('error', (e) => {
    process.stderr.write(`grim rig serve: server error: ${e.message}\n`)
  })

  server.listen(port, listen, () => {
    console.log(`grim rig serve: listening on ${listen}:${port}`)
    console.log(`  /status  — JSON snapshot`)
    console.log(`  /metrics — Prometheus text`)
    console.log(`  /cluster — instrument cluster (HTML)`)
    console.log(`  /fleet   — aggregate fleet status (JSON)`)
    console.log(`  poll interval: ${interval}s`)
  })

  return {
    server,
    stop() {
      running = false
      return new Promise(resolve => server.close(resolve))
    },
    // Expose snapshot for testing
    getSnapshot() { return snapshot },
  }
}

module.exports = { status, controlService, findBoxesForService, parseVRAM, parseBoxOutput, fmtGPU, fmtServices, serviceType, metricsUrl, pollService, discoverLocalServices, parseNvidiaSmi, parseRocmSmi, getComputeApps, getSmiGpus, parseSmiGpus, selectComputeGpu, selectAllComputeGpus, buildSnapshot, toPrometheusText, aggregateGpus, getFleet, serveStatic, serve, serveDashboard, loadBoxes, loadBoxesGraceful }

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = minimist(process.argv.slice(3), {
    boolean: ['json', 'help', 'dashboard'],
    string:  ['box'],
    alias:   { j: 'json', h: 'help', b: 'box' },
  })

  const sub = args._[0] || 'status'

  if (args.help || sub === 'help') {
    console.log(`
  Usage: grim rig [status] [--json]
         grim rig up <service> [--box <name>]
         grim rig down <service> [--box <name>]
         grim rig serve [--port 18081] [--interval 5] [--listen 127.0.0.1]
         grim rig serve --dashboard [--port 3003] [--listen 0.0.0.0]

  Subcommands:
    status (default)   Show VRAM + service status for all boxes
    up <service>       systemctl start <service>
    down <service>     systemctl stop <service>
    serve              Start resident telemetry agent (/status + /metrics)
    serve --dashboard  Fleet dashboard front-door (/cluster + /fleet)

  Options:
    --box <name>   Target a specific box (required when service is on multiple boxes)
    --json         Machine-readable status output
    --port <n>     HTTP port for serve (default: 18081) or --dashboard (default: 3003)
    --interval <s> Poll interval in seconds for serve (default: 5)
    --listen <addr> Bind address for serve (default: 127.0.0.1) or --dashboard (default: 0.0.0.0)
    --dashboard    Dashboard mode: no poller, only /cluster + /fleet

  Config:
    $GRIMOIRE_ROOT/rig.json — box inventory (copy from rig.example.json)
    Service control fields:
      "unit": "name"         systemctl unit name (default: service name)
      "scope": "user"        use systemctl --user instead of system
      "start": "cmd"         override: run this command to start
      "stop":  "cmd"         override: run this command to stop
`)
    return
  }

  if (sub === 'status') {
    await status({ json: args.json })
    return
  }

  if (sub === 'gpu') {
    // Fetch GPU snapshot from a box's rig-serve endpoint.
    // `grim rig gpu`          — local box (localhost:18081)
    // `grim rig gpu --box superack` — remote box (superack:18081)
    // `grim rig gpu --json`    — raw JSON (includes computeApps)
    const boxName = args.box
    const host = boxName ? `${boxName}:18081` : 'localhost:18081'
    const url = `http://${host}/status`
    try {
      const data = await fetchJson(url, 5000)
      const gpus = data.host?.gpus || []
      if (args.json) {
        console.log(JSON.stringify({ box: boxName || 'localhost', ...data.host, lastUpdated: data.lastUpdated }, null, 2))
      } else if (gpus.length) {
        for (const g of gpus) {
          console.log(`[${boxName || 'localhost'}] GPU ${g.index}: ${g.vendor} ${g.model}`)
          console.log(`  VRAM   ${g.vramUsedMb ?? '?'} / ${g.vramTotalMb} MiB${g.gpuPercent != null ? `  ${g.gpuPercent}%` : ''}`)
          console.log(`  Temp   ${g.tempC ?? '?'} °C`)
          if (g.computeApps && g.computeApps.length) {
            for (const a of g.computeApps) {
              console.log(`  App    pid ${a.pid}  ${a.usedMiB} MiB  ${a.name}`)
            }
          } else {
            console.log(`  Apps   none`)
          }
        }
      } else {
        console.log(`[${boxName || 'localhost'}] no GPU detected`)
      }
    } catch (e) {
      console.error(`grim rig gpu: cannot reach ${url}: ${e.message}`)
      process.exit(1)
    }
    return
  }

  if (sub === 'serve') {
    const boxes   = loadBoxesGraceful()
    if (args.dashboard) {
      const port    = parseInt(args.port, 10) || 3003
      const listen  = args.listen || '0.0.0.0'
      serveDashboard({ port, listen, boxes })
      return
    }
    const port    = parseInt(args.port, 10) || 18081
    const interval = parseInt(args.interval, 10) || 5
    const listen  = args.listen || '127.0.0.1'
    serve({ port, interval, listen, boxes })
    return
  }

  if (sub === 'up' || sub === 'down') {
    const action      = sub === 'up' ? 'start' : 'stop'
    const serviceName = args._[1]
    if (!serviceName) {
      console.error(`Usage: grim rig ${sub} <service> [--box <name>]`)
      process.exit(1)
    }
    await controlService(action, serviceName, { box: args.box || null })
    return
  }

  console.error(`grim rig: unknown subcommand '${sub}'`)
  console.error(`Run 'grim rig --help' for usage.`)
  process.exit(1)
}

if (require.main === module) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
