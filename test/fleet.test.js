'use strict'

/**
 * fleet.test.js — the merged fleet roster (phase 86).
 *
 * WHY these matter: the registry is the single source of the box LIST and
 * rig.json is only a service-check overlay. A regression here means either a
 * newly-registered box vanishes from `grim rig` + the dashboards (the drift
 * this phase eliminates), or a client box without GRIMOIRE_ROOT loses its
 * roster to a `local KB required` throw.
 */

const { test } = require('node:test')
const assert   = require('node:assert/strict')
const fs       = require('node:fs')
const os       = require('node:os')
const path     = require('node:path')
const http     = require('node:http')
const { loadFleet, mergeFleet, readOverlay } = require('../lib/fleet')

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeKbDir(t, entities) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-kb-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  if (entities) {
    fs.mkdirSync(path.join(dir, 'entities'), { recursive: true })
    entities.forEach((e, i) => {
      fs.writeFileSync(path.join(dir, 'entities', `host-${i}.json`), JSON.stringify(e))
    })
  }
  return dir
}

const ent = (name, extra = {}) => ({
  name,
  tags: ['hardware/inventory', `host/${name}`],
  network: { addresses: [{ iface: 'eth0', ip: '192.168.0.10', prefix: 24 }] },
  ...extra,
})

const registry = [ent('aid'), ent('blip'), ent('chonko')]

function writeRig(t, dir, rig) {
  const p = path.join(dir, 'rig.json')
  fs.writeFileSync(p, JSON.stringify(rig, null, 2) + '\n')
  t.after(() => fs.rmSync(p, { force: true }))
  return p
}

// ── mergeFleet (pure) ─────────────────────────────────────────────────────────

test('mergeFleet: registry host with no overlay entry gets services: []', () => {
  const fleet = mergeFleet(registry, [])
  assert.deepEqual(fleet.map(b => b.host), ['aid', 'blip', 'chonko'])
  for (const b of fleet) {
    assert.deepEqual(b.services, [])
    assert.deepEqual(b.aliases, [b.host]) // registry names carry no aliases
    assert.equal(b.label, b.host)
  }
})

test('mergeFleet: overlay attaches services/label/note by host match', () => {
  const overlay = [
    { host: 'aid', label: 'aid (hub)', aliases: ['aid', 'p40'], services: [{ name: 'a1111', port: 7860 }] },
  ]
  const fleet = mergeFleet(registry, overlay)
  const aid = fleet.find(b => b.host === 'aid')
  assert.equal(aid.label, 'aid (hub)')
  assert.deepEqual(aid.aliases, ['aid', 'p40'])
  assert.equal(aid.services.length, 1)
  assert.equal(aid.services[0].name, 'a1111')
  // the other registry hosts are untouched
  assert.deepEqual(fleet.find(b => b.host === 'blip').services, [])
})

test('mergeFleet: overlay matches a registry host via an alias, union preserved', () => {
  const overlay = [{ host: 'p40', aliases: ['p40', 'aid'], services: [{ name: 'comfyui' }] }]
  const fleet = mergeFleet([ent('aid')], overlay)
  assert.equal(fleet.length, 1)
  assert.equal(fleet[0].host, 'aid')          // registry name wins as host
  assert.deepEqual(fleet[0].aliases.sort(), ['aid', 'p40'])
  assert.equal(fleet[0].services.length, 1)
})

test('mergeFleet: unregistered overlay entry is still included (fallback)', () => {
  const overlay = [{ host: 'ghostbox', label: 'ghost', services: [{ name: 'ollama' }], skip: true }]
  const fleet = mergeFleet(registry, overlay)
  assert.equal(fleet.length, 4)
  const ghost = fleet.find(b => b.host === 'ghostbox')
  assert.equal(ghost.label, 'ghost')
  assert.equal(ghost.skip, true)
  assert.equal(ghost.services.length, 1)
})

test('mergeFleet: deterministic order — sorted by host, overlay entries included', () => {
  const overlay = [{ host: 'zeta', services: [] }]
  const fleet = mergeFleet([ent('zeta'), ent('alpha')], overlay)
  assert.deepEqual(fleet.map(b => b.host), ['alpha', 'zeta'])
  assert.equal(fleet.length, 2) // zeta matched the overlay, not duplicated
})

// ── readOverlay ───────────────────────────────────────────────────────────────

test('readOverlay: absent file → [] (overlay is optional)', () => {
  assert.deepEqual(readOverlay('/nonexistent/rig.json'), [])
  assert.deepEqual(readOverlay(null), [])
})

test('readOverlay: malformed JSON → [] (warns, does not throw)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ov-'))
  try {
    const p = path.join(dir, 'rig.json')
    fs.writeFileSync(p, '{ not json')
    assert.deepEqual(readOverlay(p), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── loadFleet — local mode ────────────────────────────────────────────────────

test('loadFleet (local): registry hosts + rig.json overlay, no rig.json entry needed', async t => {
  const kb = makeKbDir(t, registry)
  const rig = writeRig(t, kb, [
    { host: 'aid', aliases: ['aid', 'p40'], services: [{ name: 'a1111', port: 7860 }] },
    { host: 'chonko', services: [{ name: 'ollama', port: 11434 }] },
  ])
  const fleet = await loadFleet({ root: kb, host: null }, rig)
  assert.deepEqual(fleet.map(b => b.host), ['aid', 'blip', 'chonko'])
  assert.equal(fleet.find(b => b.host === 'blip').services.length, 0) // registry-only box
  assert.equal(fleet.find(b => b.host === 'aid').services.length, 1)  // overlay matched
})

test('loadFleet (local): no rig.json at all → roster still derives, all services: []', async t => {
  const kb = makeKbDir(t, registry)
  const fleet = await loadFleet({ root: kb, host: null })
  assert.equal(fleet.length, 3)
  assert.ok(fleet.every(b => b.services.length === 0))
})

test('loadFleet (local): root without entities dir + no overlay → [] (graceful, no throw)', async t => {
  const dir = makeKbDir(t, null) // no entities/ subdir
  const fleet = await loadFleet({ root: dir, host: null })
  assert.deepEqual(fleet, [])
})

test('loadFleet (local): overlay-only entry survives an empty registry', async t => {
  const dir = makeKbDir(t, null)
  const rig = writeRig(t, dir, [{ host: 'orphan', services: [{ name: 'ollama' }] }])
  const fleet = await loadFleet({ root: dir, host: null }, rig)
  assert.deepEqual(fleet.map(b => b.host), ['orphan'])
})

// ── loadFleet — client mode (no GRIMOIRE_ROOT) ────────────────────────────────

function stubServer(t, handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  return new Promise(resolve => {
    server.once('listening', () => resolve(server))
  }).then(server => {
    t.after(() => new Promise(r => server.close(r)))
    return { server, url: `http://127.0.0.1:${server.address().port}` }
  })
}

test('loadFleet (client): no root → roster via GET /api/hosts/inventory, never `local KB required`', async () => {
  const { url } = await stubServer(test, (req, res) => {
    assert.equal(req.url, '/api/hosts/inventory')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify([ent('aid'), ent('tbona')]))
  })
  const fleet = await loadFleet({ root: null, host: url })
  assert.deepEqual(fleet.map(b => b.host), ['aid', 'tbona'])
  assert.ok(fleet.every(b => b.services.length === 0))
})

test('loadFleet (client): server 500 → degrades to overlay only, no throw', async () => {
  const { url } = await stubServer(test, (req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' })
    res.end('no root on server')
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cl-'))
  try {
    const rig = path.join(dir, 'rig.json')
    fs.writeFileSync(rig, JSON.stringify([{ host: 'fallback-box', services: [{ name: 'ollama' }] }]))
    const fleet = await loadFleet({ root: null, host: url }, rig)
    assert.deepEqual(fleet.map(b => b.host), ['fallback-box'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('loadFleet (client): no root, no host, no overlay → [] (never throws `local KB required`)', async () => {
  const fleet = await loadFleet({ root: null, host: null })
  assert.deepEqual(fleet, [])
})

test('loadFleet (client): unreachable server → degrades to overlay only', async () => {
  // port 1 on loopback: connection refused, no server involved
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cl2-'))
  try {
    const rig = path.join(dir, 'rig.json')
    fs.writeFileSync(rig, JSON.stringify([{ host: 'solo', services: [] }]))
    const fleet = await loadFleet({ root: null, host: 'http://127.0.0.1:1' }, rig)
    assert.deepEqual(fleet.map(b => b.host), ['solo'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
