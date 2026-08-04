'use strict'
const { test } = require('node:test')
const assert   = require('node:assert/strict')
const { parseVRAM, parseBoxOutput, fmtGPU, fmtServices, findBoxesForService, fleetToDisplay, resolveRigHub, fetchFleetRemote, parseDuration, toEpoch, summarize, fmt } = require('../bin/grim-rig')

// ── parseVRAM ─────────────────────────────────────────────────────────────────

test('parseVRAM: parses nvidia-smi CSV output', () => {
  const gpu = parseVRAM('Tesla P40, 20100, 4476, 24576')
  assert.equal(gpu.name,  'Tesla P40')
  assert.equal(gpu.used,  20100)
  assert.equal(gpu.free,  4476)
  assert.equal(gpu.total, 24576)
})

test('parseVRAM: trims whitespace from each field', () => {
  const gpu = parseVRAM(' GeForce RTX 4060 Ti ,  2345 ,  13000 ,  16384 ')
  assert.equal(gpu.name, 'GeForce RTX 4060 Ti')
  assert.equal(gpu.used, 2345)
})

test('parseVRAM: returns null for NO_GPU sentinel', () => {
  assert.equal(parseVRAM('NO_GPU'), null)
})

test('parseVRAM: returns null for empty/missing input', () => {
  assert.equal(parseVRAM(''),        null)
  assert.equal(parseVRAM(undefined), null)
  assert.equal(parseVRAM(null),      null)
})

test('parseVRAM: returns null for malformed input', () => {
  assert.equal(parseVRAM('just one field'), null)
  assert.equal(parseVRAM('a,b,c'),          null) // only 3 fields
})

// ── parseBoxOutput ────────────────────────────────────────────────────────────

const testBox = { host: 'gpu-box', label: 'gpu-box', services: [{ name: 'ollama' }] }

test('parseBoxOutput: parses gpu + service lines', () => {
  const out = 'Tesla P40, 19600, 4976, 24576\nollama:OK'
  const result = parseBoxOutput(testBox, out)
  assert.equal(result.reachable, true)
  assert.equal(result.gpu.name, 'Tesla P40')
  assert.equal(result.services[0].name, 'ollama')
  assert.equal(result.services[0].up, true)
})

test('parseBoxOutput: marks service down on FAIL', () => {
  const out = 'NO_GPU\nollama:FAIL'
  const result = parseBoxOutput(testBox, out)
  assert.equal(result.gpu, null)
  assert.equal(result.services[0].up, false)
})

test('parseBoxOutput: handles multiple services', () => {
  const box = { host: 'gpu-box', label: 'gpu-box', services: [] }
  const out = 'GeForce RTX 4060 Ti, 2345, 14039, 16384\na1111:OK\ncomfyui:FAIL\nwhisper:OK'
  const result = parseBoxOutput(box, out)
  assert.equal(result.services.length, 3)
  assert.equal(result.services[0].up, true)
  assert.equal(result.services[1].up, false)
  assert.equal(result.services[2].up, true)
})

test('parseBoxOutput: handles empty output gracefully', () => {
  const result = parseBoxOutput(testBox, '')
  assert.equal(result.gpu, null)
  assert.equal(result.services.length, 0)
})

// ── fmtGPU ────────────────────────────────────────────────────────────────────

test('fmtGPU: returns null for null gpu', () => {
  assert.equal(fmtGPU(null), null)
})

test('fmtGPU: formats used/total in GB with percent', () => {
  const s = fmtGPU({ name: 'Tesla P40', used: 20480, free: 4096, total: 24576 })
  assert.match(s, /20\.0\/24\.0 GB/)
  assert.match(s, /83%/)
})

test('fmtGPU: strips NVIDIA vendor prefix', () => {
  const s = fmtGPU({ name: 'NVIDIA GeForce RTX 4060 Ti', used: 1024, free: 15360, total: 16384 })
  assert.ok(!s.includes('NVIDIA '))
  assert.match(s, /GeForce RTX 4060 Ti/)
})

test('fmtGPU: strips AMD vendor prefix', () => {
  const s = fmtGPU({ name: 'AMD Radeon RX 7900', used: 1024, free: 15360, total: 16384 })
  assert.ok(!s.includes('AMD '))
})

// ── fmtServices ───────────────────────────────────────────────────────────────

test('fmtServices: returns null for empty services', () => {
  assert.equal(fmtServices([]), null)
})

test('fmtServices: formats running services with bullet', () => {
  const s = fmtServices([{ name: 'ollama', up: true }])
  assert.match(s, /ollama/)
  assert.match(s, /●/)
})

test('fmtServices: formats stopped services with circle', () => {
  const s = fmtServices([{ name: 'comfyui', up: false }])
  assert.match(s, /○/)
})

test('fmtServices: separates multiple services', () => {
  const s = fmtServices([
    { name: 'a1111', up: true },
    { name: 'whisper', up: false },
  ])
  assert.match(s, /a1111/)
  assert.match(s, /whisper/)
})

// ── findBoxesForService ───────────────────────────────────────────────────────

const rigBoxes = [
  { host: 'box-a', label: 'box-a', aliases: ['box-a'], services: [{ name: 'ollama' }, { name: 'comfyui' }] },
  { host: 'box-b', label: 'box-b', aliases: ['box-b'], services: [{ name: 'a1111' }] },
  { host: 'box-c', label: 'box-c', aliases: ['box-c'], services: [{ name: 'ollama' }] },
  { host: 'client', label: 'client', aliases: ['client'], services: [], skip: true },
]

test('findBoxesForService: returns single matching box', () => {
  const matches = findBoxesForService(rigBoxes, 'a1111', null)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].host, 'box-b')
})

test('findBoxesForService: throws NOT_FOUND when service missing', () => {
  assert.throws(
    () => findBoxesForService(rigBoxes, 'no-such-svc', null),
    e => e.code === 'NOT_FOUND'
  )
})

test('findBoxesForService: throws AMBIGUOUS when service on multiple boxes', () => {
  assert.throws(
    () => findBoxesForService(rigBoxes, 'ollama', null),
    e => e.code === 'AMBIGUOUS'
  )
})

test('findBoxesForService: --box filter resolves ambiguity', () => {
  const matches = findBoxesForService(rigBoxes, 'ollama', 'box-c')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].host, 'box-c')
})

test('findBoxesForService: --box filter throws NOT_FOUND for wrong box', () => {
  assert.throws(
    () => findBoxesForService(rigBoxes, 'ollama', 'box-b'),
    e => e.code === 'NOT_FOUND'
  )
})

test('findBoxesForService: skip=true boxes are excluded', () => {
  assert.throws(
    () => findBoxesForService(rigBoxes, 'anything', 'client'),
    e => e.code === 'NOT_FOUND'
  )
})

// ── fleetToDisplay ────────────────────────────────────────────────────────────

test('fleetToDisplay: maps fleet member to display shape', () => {
  const member = { name: 'chonko', util: 48, vramUsed: 42.3, vramTotal: 48, temp: 68, model: '—', gpu: 'GP102GL [Tesla P40] ×2', up: true }
  const r = fleetToDisplay(member)
  assert.equal(r.host, 'chonko')
  assert.equal(r.label, 'chonko')
  assert.equal(r.reachable, true)
  assert.equal(r.services.length, 0)
  assert.equal(r.gpu.name, 'GP102GL [Tesla P40] ×2')
  assert.equal(r.gpu.total, Math.round(48 * 1024))
  assert.equal(r.gpu.used, Math.round(42.3 * 1024))
  assert.equal(r.gpu.free, Math.round((48 - 42.3) * 1024))
})

test('fleetToDisplay: down box gets null gpu', () => {
  const member = { name: 'dead', util: 0, vramUsed: 0, vramTotal: 0, temp: 0, model: '—', gpu: '—', up: false }
  const r = fleetToDisplay(member)
  assert.equal(r.reachable, false)
  assert.equal(r.gpu, null)
})

test('fleetToDisplay: model becomes note when present', () => {
  const member = { name: 'aid', util: 3, vramUsed: 1.6, vramTotal: 32, temp: 42, model: 'qwen3.6', gpu: 'Navi 48', up: true }
  const r = fleetToDisplay(member)
  assert.equal(r.note, 'qwen3.6')
})

test('fleetToDisplay: empty note when model is —', () => {
  const member = { name: 'superack', util: 0, vramUsed: 7.5, vramTotal: 12, temp: 41, model: '—', gpu: 'GA106', up: true }
  const r = fleetToDisplay(member)
  assert.equal(r.note, '')
})

// ── resolveRigHub ─────────────────────────────────────────────────────────────

test('resolveRigHub: returns explicit rig_hub from lbl-config', () => {
  // On this box lbl-config has rig_hub = http://aid:18081
  const hub = resolveRigHub()
  assert.ok(typeof hub === 'string')
  assert.ok(hub.length > 0)
})

// ── fetchFleetRemote ──────────────────────────────────────────────────────────

test('fetchFleetRemote: returns fleet data from live hub', async () => {
  const hub = resolveRigHub()
  if (!hub) { this.skip() }
  const fleet = await fetchFleetRemote(hub)
  assert.ok(fleet !== null)
  assert.ok(Array.isArray(fleet.boxes))
  assert.ok(fleet.boxes.length > 0)
  assert.ok(fleet.boxes[0].name)
  assert.ok(typeof fleet.boxes[0].up === 'boolean')
})

test('fetchFleetRemote: returns null for unreachable hub', async () => {
  const fleet = await fetchFleetRemote('http://127.0.0.1:1/nonexistent')
  assert.equal(fleet, null)
})

// ── parseDuration ─────────────────────────────────────────────────────────────

test('parseDuration: parses 10m to seconds', () => {
  assert.equal(parseDuration('10m'), 600)
})

test('parseDuration: parses 2h to seconds', () => {
  assert.equal(parseDuration('2h'), 7200)
})

test('parseDuration: parses 1d to seconds', () => {
  assert.equal(parseDuration('1d'), 86400)
})

test('parseDuration: parses 30s to seconds', () => {
  assert.equal(parseDuration('30s'), 30)
})

test('parseDuration: throws for invalid format', () => {
  assert.throws(() => parseDuration('foo'), /invalid duration/)
})

// ── toEpoch ───────────────────────────────────────────────────────────────────

test('toEpoch: parses ISO string to epoch seconds', () => {
  const t = toEpoch('2026-08-03T19:00:00Z')
  assert.ok(typeof t === 'number')
  assert.ok(t > 0)
})

test('toEpoch: passes through epoch seconds', () => {
  const epoch = 1785783600
  assert.equal(toEpoch(String(epoch)), epoch)
})

// ── summarize ─────────────────────────────────────────────────────────────────

test('summarize: computes min/max/avg/last from points', () => {
  const pts = [{ v: 10 }, { v: 20 }, { v: 30 }]
  const s = summarize(pts)
  assert.equal(s.min, 10)
  assert.equal(s.max, 30)
  assert.equal(s.avg, 20)
  assert.equal(s.last, 30)
})

test('summarize: returns nulls for empty input', () => {
  const s = summarize([])
  assert.equal(s.min, null)
  assert.equal(s.max, null)
  assert.equal(s.avg, null)
  assert.equal(s.last, null)
})

test('summarize: filters null/NaN values', () => {
  const pts = [{ v: 10 }, { v: null }, { v: NaN }, { v: 40 }]
  const s = summarize(pts)
  assert.equal(s.min, 10)
  assert.equal(s.max, 40)
  assert.equal(s.avg, 25)
})

// ── fmt ───────────────────────────────────────────────────────────────────────

test('fmt: formats integers', () => {
  assert.equal(fmt(42), '42')
})

test('fmt: formats floats to 2 decimals', () => {
  assert.equal(fmt(42.5), '42.50')
})

test('fmt: returns — for null', () => {
  assert.equal(fmt(null), '—')
})
