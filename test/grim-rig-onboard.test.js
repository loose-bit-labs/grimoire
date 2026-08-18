'use strict'

/**
 * test/grim-rig-onboard.test.js — phase 67: auto-onboard registered host to fleet + telemetry
 *
 * Tests:
 * 1. upsertBox(idempotent) — adds missing box, no-op on repeat, preserves existing
 * 2. reconcileTelemetry(graceful failure) — returns { regenerated, reloaded } without throwing
 * 3. POST /api/hosts/onboard — hermetic (stubbed reconcile, temp rig.json)
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')

const rig = require('../bin/grim-rig.js')

// ── helpers ──────────────────────────────────────────────────────────────────

function createTempRig(boxes) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-'))
  const tmpPath = path.join(tmpDir, 'rig.json')
  fs.writeFileSync(tmpPath, JSON.stringify(boxes, null, 2) + '\n', 'utf8')
  return { path: tmpPath, dir: tmpDir }
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const urlObj = new URL(url)
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }
    const req = http.request(opts, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ── upsertBox ────────────────────────────────────────────────────────────────

describe('upsertBox()', () => {
  let tmp

  beforeEach(() => {
    tmp = createTempRig([
      { host: 'aid', label: 'aid', aliases: ['aid'], services: [] },
      { host: 'chonko', label: 'chonko', aliases: ['chonko'], services: [{ name: 'ollama', port: 11434 }] },
    ])
  })

  afterEach(() => {
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  })

  it('adds a missing box', () => {
    const result = rig.upsertBox(tmp.path, { host: 'superack' })
    assert.strictEqual(result.added, true)
    const rigs = JSON.parse(fs.readFileSync(tmp.path, 'utf8'))
    assert.strictEqual(rigs.length, 3)
    assert.strictEqual(rigs[2].host, 'superack')
    assert.strictEqual(rigs[2].services.length, 0)
    assert.ok(rigs[2].note.startsWith('auto-onboarded'))
  })

  it('is idempotent — second call is no-op', () => {
    rig.upsertBox(tmp.path, { host: 'superack' })
    const result = rig.upsertBox(tmp.path, { host: 'superack' })
    assert.strictEqual(result.added, false)
    const rigs = JSON.parse(fs.readFileSync(tmp.path, 'utf8'))
    assert.strictEqual(rigs.length, 3) // still 3: 2 original + 1 added
  })

  it('matches on host field', () => {
    const result = rig.upsertBox(tmp.path, { host: 'aid', label: 'aid-primary' })
    assert.strictEqual(result.added, false)
  })

  it('preserves existing boxes exactly', () => {
    rig.upsertBox(tmp.path, { host: 'meinherz' })
    const rigs = JSON.parse(fs.readFileSync(tmp.path, 'utf8'))
    assert.strictEqual(rigs[0].host, 'aid')
    assert.strictEqual(rigs[1].host, 'chonko')
    assert.strictEqual(rigs[1].services[0].name, 'ollama')
    assert.strictEqual(rigs[1].services[0].port, 11434)
  })

  it('preserves 2-space formatting', () => {
    const original = fs.readFileSync(tmp.path, 'utf8')
    rig.upsertBox(tmp.path, { host: 'new-box' })
    const updated = fs.readFileSync(tmp.path, 'utf8')
    // Should still parse as valid JSON with 2-space indent
    const parsed = JSON.parse(updated)
    assert.ok(parsed.length === 3)
    assert.ok(updated.includes('  "host"'))
  })
})

// ── reconcileTelemetry (graceful failure) ────────────────────────────────────

describe('reconcileTelemetry()', () => {
  it('returns { regenerated, reloaded } without throwing', async () => {
    // reconcileTelemetry should never throw — Prometheus reachability is env-dependent
    const result = await rig.reconcileTelemetry()
    assert.ok('regenerated' in result, 'should return regenerated flag')
    assert.ok('reloaded' in result, 'should return reloaded flag')
    assert.strictEqual(typeof result.regenerated, 'boolean', 'regenerated should be boolean')
    assert.strictEqual(typeof result.reloaded, 'boolean', 'reloaded should be boolean')
  })
})

// ── POST /api/hosts/onboard (hermetic) ──────────────────────────────────────

describe('POST /api/hosts/onboard', () => {
  let server
  let baseUrl
  let tmp
  let reconcileCalled
  let origReconcile
  let origConfigRoot = undefined

  beforeEach(async () => {
    reconcileCalled = 0
    origReconcile = rig.reconcileTelemetry
    rig.reconcileTelemetry = async () => {
      reconcileCalled++
      return { regenerated: true, reloaded: false }
    }

    tmp = createTempRig([
      { host: 'aid', label: 'aid', aliases: ['aid'], services: [] },
    ])

    // Capture original config.root before patching
    const envMod = require('../lib/env')
    origConfigRoot = envMod.config.root

    // Patch config.root for this test
    Object.defineProperty(envMod, 'config', {
      value: { ...envMod.config, root: path.dirname(tmp.path) },
      writable: true,
      configurable: true,
    })

    // Start a minimal server that serves the onboard endpoint
    const express = require('express')
    const app = express()
    app.use(express.json())

    app.post('/api/hosts/onboard', async (req, res) => {
      const { host, label, aliases } = req.body || {}
      if (!host) return res.status(400).json({ error: 'host is required' })
      try {
        const rigPath = path.join(path.dirname(tmp.path), 'rig.json')
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

    server = app.listen(0)
    await new Promise(r => server.once('listening', r))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    // Restore original config
    const envMod = require('../lib/env')
    Object.defineProperty(envMod, 'config', {
      value: { ...envMod.config, root: origConfigRoot },
      writable: true,
      configurable: true,
    })
    rig.reconcileTelemetry = origReconcile
    fs.rmSync(tmp.dir, { recursive: true, force: true })
    if (server) {
      await new Promise(r => server.close(r))
    }
  })

  it('adds a new box and returns addedToFleet:true', async () => {
    const res = await httpPost(`${baseUrl}/api/hosts/onboard`, { host: 'new-box' })
    assert.strictEqual(res.status, 200)
    const body = JSON.parse(res.body)
    assert.strictEqual(body.addedToFleet, true)
    assert.strictEqual(body.telemetryReloaded, false)
    assert.strictEqual(reconcileCalled, 1)
  })

  it('returns addedToFleet:false on repeat call', async () => {
    await httpPost(`${baseUrl}/api/hosts/onboard`, { host: 'new-box' })
    const res = await httpPost(`${baseUrl}/api/hosts/onboard`, { host: 'new-box' })
    assert.strictEqual(res.status, 200)
    const body = JSON.parse(res.body)
    assert.strictEqual(body.addedToFleet, false)
    // reconcile should NOT be called again
    assert.strictEqual(reconcileCalled, 1)
  })

  it('returns 400 when host is missing', async () => {
    const res = await httpPost(`${baseUrl}/api/hosts/onboard`, {})
    assert.strictEqual(res.status, 400)
    const body = JSON.parse(res.body)
    assert.ok(body.error.includes('host is required'))
  })
})
