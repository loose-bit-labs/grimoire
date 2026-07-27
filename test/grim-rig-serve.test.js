'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')

const rig = require('../bin/grim-rig.js')

// ── helpers ──────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    }).on('error', reject)
  })
}

// ── serviceType normalization ────────────────────────────────────────────────

describe('serviceType()', () => {
  it('maps common aliases to canonical types', () => {
    assert.strictEqual(rig.serviceType('ollama'), 'ollama')
    assert.strictEqual(rig.serviceType('comfyui'), 'comfyui')
    assert.strictEqual(rig.serviceType('comfy'), 'comfyui')
    assert.strictEqual(rig.serviceType('a1111'), 'a1111')
    assert.strictEqual(rig.serviceType('automatic1111'), 'a1111')
    assert.strictEqual(rig.serviceType('llamacpp'), 'llama_cpp')
  })

  it('returns null for unknown service types', () => {
    assert.strictEqual(rig.serviceType('whisper'), null)
    assert.strictEqual(rig.serviceType('trellis'), null)
    assert.strictEqual(rig.serviceType('piper'), null)
  })
})

// ── metricsUrl() ─────────────────────────────────────────────────────────────

describe('metricsUrl()', () => {
  it('builds correct endpoint per service type', () => {
    assert.strictEqual(rig.metricsUrl('http://127.0.0.1:11434', 'ollama'), 'http://127.0.0.1:11434/api/ps')
    assert.strictEqual(rig.metricsUrl('http://127.0.0.1:8188', 'comfyui'), 'http://127.0.0.1:8188/system_stats')
    assert.strictEqual(rig.metricsUrl('http://127.0.0.1:7860', 'a1111'), 'http://127.0.0.1:7860/sdapi/v1/memory')
    assert.strictEqual(rig.metricsUrl('http://127.0.0.1:8080', 'llama_cpp'), 'http://127.0.0.1:8080/slots')
  })

  it('returns null for unknown types', () => {
    assert.strictEqual(rig.metricsUrl('http://x:1', 'whisper'), null)
  })
})

// ── toPrometheusText() ───────────────────────────────────────────────────────

describe('toPrometheusText()', () => {
  it('produces valid Prometheus text with host metrics only', () => {
    const snapshot = {
      host: {
        hostname: 'test-box',
        cpuPercent: 42.5,
        memUsedMb: 8192,
        memTotalMb: 16384,
        diskUsedPercent: 55,
        gpu: null,
      },
      services: [],
      lastUpdated: '2026-07-23T00:00:00.000Z',
    }
    const text = rig.toPrometheusText(snapshot)
    assert.ok(text.includes('# HELP gen_host_cpu_percent'))
    assert.ok(text.includes('# TYPE gen_host_cpu_percent gauge'))
    assert.ok(text.includes('gen_host_cpu_percent{node="test-box"} 42.5'))
    assert.ok(text.includes('gen_host_mem_used_mb{node="test-box"} 8192'))
    assert.ok(text.includes('gen_host_mem_total_mb{node="test-box"} 16384'))
    assert.ok(text.includes('gen_host_disk_used_percent{node="test-box"} 55'))
    // No GPU metrics when gpu is null
    assert.ok(!text.includes('gen_gpu'))
  })

  it('includes GPU metrics when present', () => {
    const snapshot = {
      host: {
        hostname: 'gpu-box',
        cpuPercent: 10,
        memUsedMb: 4096,
        memTotalMb: 8192,
        diskUsedPercent: 30,
        gpu: {
          vendor: 'AMD',
          model: 'Radeon 9700',
          vramTotalMb: 32768,
          vramUsedMb: 2048,
          gpuPercent: 15,
          tempC: 48,
        },
      },
      services: [],
      lastUpdated: null,
    }
    const text = rig.toPrometheusText(snapshot)
    assert.ok(text.includes('gen_gpu_vram_total_mb{node="gpu-box"} 32768'))
    assert.ok(text.includes('gen_gpu_vram_used_mb{node="gpu-box"} 2048'))
    assert.ok(text.includes('gen_gpu_util_percent{node="gpu-box"} 15'))
    assert.ok(text.includes('gen_gpu_temp_c{node="gpu-box"} 48'))
  })

  it('includes service metrics with up/down and models', () => {
    const snapshot = {
      host: {
        hostname: 'box',
        cpuPercent: 0, memUsedMb: 0, memTotalMb: 0, diskUsedPercent: 0, gpu: null,
      },
      services: [
        { name: 'ollama', up: true, type: 'ollama', models: [{ name: 'llama3', vram: 4096, loaded: true }], queue: 0, running: 1 },
        { name: 'a1111', up: false, type: 'a1111', models: [], queue: 0, running: 0 },
      ],
      lastUpdated: null,
    }
    const text = rig.toPrometheusText(snapshot)
    // ollama up
    assert.ok(text.includes('gen_service_up{node="box",service="ollama"} 1'))
    // ollama model
    assert.ok(text.includes('gen_model_loaded{node="box",service="ollama",model="llama3"} 1'))
    assert.ok(text.includes('gen_model_vram_mb{node="box",service="ollama",model="llama3"} 4096'))
    assert.ok(text.includes('gen_requests_running{node="box",service="ollama"} 1'))
    // a1111 down
    assert.ok(text.includes('gen_service_up{node="box",service="a1111"} 0'))
    assert.ok(text.includes('gen_queue_pending{node="box",service="a1111"} 0'))
  })
})

// ── serve() HTTP server ──────────────────────────────────────────────────────

describe('serve()', () => {
  it('/status returns JSON, /metrics returns Prometheus text, 404 for unknown', async () => {
    const port = 19876
    const { server, stop, getSnapshot } = rig.serve({
      port,
      interval: 10,
      listen: '127.0.0.1',
      boxes: [{ host: 'x', label: 'x', aliases: ['x'], services: [] }],
    })

    try {
      await new Promise(r => server.once('listening', r))

      // /status
      const statusRes = await httpGet(`http://127.0.0.1:${port}/status`)
      assert.strictEqual(statusRes.status, 200)
      const json = JSON.parse(statusRes.body)
      assert.ok(json.host)
      assert.ok(json.services)
      assert.ok(Array.isArray(json.services))

      // /metrics
      const metricsRes = await httpGet(`http://127.0.0.1:${port}/metrics`)
      assert.strictEqual(metricsRes.status, 200)
      assert.strictEqual(metricsRes.headers['content-type'], 'text/plain; charset=utf-8')
      const metricLines = metricsRes.body.split('\n').filter(l => l.match(/^[a-z_]+{/))
      assert.ok(metricLines.length > 0, 'expected at least one metric line')

      // 404
      const notFound = await httpGet(`http://127.0.0.1:${port}/unknown`)
      assert.strictEqual(notFound.status, 404)
    } finally {
      await stop()
    }
  })

  it('server stays alive across multiple polls with dead services', async () => {
    const port = 19877
    const { server, stop, getSnapshot } = rig.serve({
      port,
      interval: 1,
      listen: '127.0.0.1',
      boxes: [{ host: 'survivor', label: 'survivor', aliases: ['survivor'], services: [
        { name: 'a1111', port: 17861 },
        { name: 'comfyui', port: 18189 },
        { name: 'ollama', port: 11144 },
      ]}],
    })

    try {
      await new Promise(r => server.once('listening', r))
      // Wait for a few poll cycles
      await new Promise(r => setTimeout(r, 3500))

      // Server should still respond (not crashed by dead service polls)
      const statusRes = await httpGet(`http://127.0.0.1:${port}/status`)
      assert.strictEqual(statusRes.status, 200)
      const json = JSON.parse(statusRes.body)
      assert.ok(json.host)
      // Services may or may not be populated (depends on timing), but server is alive
      assert.ok(Array.isArray(json.services))
    } finally {
      await stop()
    }
  })

  it('scrubs DISPLAY and XAUTHORITY from process.env at startup', async () => {
    const origDisplay = process.env.DISPLAY
    const origXauth = process.env.XAUTHORITY
    try {
      process.env.DISPLAY = 'localhost:99.0'
      process.env.XAUTHORITY = '/nonexistent/.Xauthority'
      const port = 19879
      const { server, stop } = rig.serve({
        port,
        interval: 10,
        listen: '127.0.0.1',
        boxes: [{ host: 'x', label: 'x', aliases: ['x'], services: [] }],
      })
      await new Promise(r => server.once('listening', r))
      assert.strictEqual(process.env.DISPLAY, undefined, 'DISPLAY should be scrubbed')
      assert.strictEqual(process.env.XAUTHORITY, undefined, 'XAUTHORITY should be scrubbed')
      await stop()
    } finally {
      if (origDisplay !== undefined) process.env.DISPLAY = origDisplay
      else delete process.env.DISPLAY
      if (origXauth !== undefined) process.env.XAUTHORITY = origXauth
      else delete process.env.XAUTHORITY
    }
  })

  it('loadBoxesGraceful returns [] when rig.json is absent', () => {
    const { config } = require('../lib/env')
    const origRoot = config.root
    try {
      // Mutate config.root to a dir without rig.json
      config.root = os.tmpdir()
      const boxes = rig.loadBoxesGraceful()
      assert.ok(Array.isArray(boxes), 'should return an array')
      assert.strictEqual(boxes.length, 0, 'should be empty when rig.json absent')
    } finally {
      config.root = origRoot
    }
  })
})

// ── serveDashboard() ─────────────────────────────────────────────────────────

describe('serveDashboard()', () => {
  it('/cluster returns HTML, /fleet returns JSON, /status and /metrics return 404', async () => {
    const port = 19880
    const { server, stop } = rig.serveDashboard({
      port,
      listen: '127.0.0.1',
      boxes: [{ host: 'x', label: 'x', aliases: ['x'], services: [] }],
    })

    try {
      await new Promise(r => server.once('listening', r))

      // /cluster — HTML
      const clusterRes = await httpGet(`http://127.0.0.1:${port}/cluster`)
      assert.strictEqual(clusterRes.status, 200)
      assert.ok(clusterRes.headers['content-type']?.includes('text/html'))

      // /fleet — JSON
      const fleetRes = await httpGet(`http://127.0.0.1:${port}/fleet`)
      assert.strictEqual(fleetRes.status, 200)
      const fleetJson = JSON.parse(fleetRes.body)
      assert.ok(fleetJson.boxes)
      assert.ok(Array.isArray(fleetJson.boxes))

      // /status — 404 (dashboard has no local snapshot)
      const statusRes = await httpGet(`http://127.0.0.1:${port}/status`)
      assert.strictEqual(statusRes.status, 404)

      // /metrics — 404 (dashboard has no poller)
      const metricsRes = await httpGet(`http://127.0.0.1:${port}/metrics`)
      assert.strictEqual(metricsRes.status, 404)
    } finally {
      await stop()
    }
  })
})

// ── buildSnapshot() ──────────────────────────────────────────────────────────

describe('buildSnapshot()', () => {
  it('returns host metrics with real data when rig.json has matching box', async () => {
    const hostname = os.hostname().toLowerCase()
    const boxes = [{
      host: 'nonexistent',
      label: 'nonexistent',
      aliases: ['nonexistent'],
      services: [],
    }, {
      host: hostname,
      label: hostname,
      aliases: [hostname],
      services: [
        { name: 'ollama', port: 11143 }, // dead port
      ],
    }]

    const snapshot = await rig.buildSnapshot(boxes)

    assert.strictEqual(snapshot.host.hostname, hostname)
    assert.ok(snapshot.host.memTotalMb > 0, 'should have real mem total')
    assert.ok(snapshot.host.diskUsedPercent >= 0, 'disk percent should be non-negative')
    // ollama service should be present but down (dead port)
    const ollamaSvc = snapshot.services.find(s => s.name === 'ollama')
    assert.ok(ollamaSvc, 'ollama service should be in snapshot')
    assert.strictEqual(ollamaSvc.up, false, 'dead service should be down')
    assert.strictEqual(ollamaSvc.type, 'ollama')
  })

  it('returns empty services when no local box matches', async () => {
    const boxes = [{
      host: 'nowhere',
      label: 'nowhere',
      aliases: ['nowhere'],
      services: [{ name: 'ollama', port: 11434 }],
    }]
    const snapshot = await rig.buildSnapshot(boxes)
    assert.strictEqual(snapshot.services.length, 0)
  })

  it('dead services yield up: false with zero metrics', async () => {
    const hostname = os.hostname().toLowerCase()
    const boxes = [{
      host: hostname,
      label: hostname,
      aliases: [hostname],
      services: [
        { name: 'a1111', port: 17862 },
        { name: 'comfyui', port: 18190 },
        { name: 'ollama', port: 11145 },
      ],
    }]

    const snapshot = await rig.buildSnapshot(boxes)
    assert.strictEqual(snapshot.services.length, 3)
    for (const svc of snapshot.services) {
      assert.strictEqual(svc.up, false, `${svc.name} should be down`)
      assert.strictEqual(svc.queue, 0)
      assert.strictEqual(svc.running, 0)
      assert.strictEqual(svc.models.length, 0)
    }
  })
})

// ── getFleet() ────────────────────────────────────────────────────────────────

describe('getFleet()', () => {
  let fleetServer

  beforeEach(async () => {
    const hostname = os.hostname().toLowerCase()
    const { server, stop, getSnapshot } = rig.serve({
      port: 18081,
      interval: 1,
      listen: '127.0.0.1',
      boxes: [{ host: hostname, label: hostname, aliases: [hostname], services: [] }],
    })
    await new Promise(r => server.once('listening', r))
    // Wait for first poll to populate real GPU/mem data (buildSnapshot calls si.graphics, rocm-smi, etc. — can take ~6s)
    // Poll getSnapshot until lastUpdated is set rather than guessing a fixed delay
    for (let i = 0; i < 30; i++) {
      if (getSnapshot().lastUpdated) break
      await new Promise(r => setTimeout(r, 500))
    }
    fleetServer = { server, stop }
  })

  afterEach(async () => {
    if (fleetServer) await fleetServer.stop()
  })

  it('returns correct shape with down boxes', async () => {
    const boxes = [{
      host: 'nowhere',
      label: 'nowhere',
      aliases: ['nowhere'],
      services: [],
    }]
    const fleet = await rig.getFleet(boxes)
    assert.ok(fleet.boxes)
    assert.ok(Array.isArray(fleet.boxes))
    assert.strictEqual(fleet.boxes.length, 1)
    assert.strictEqual(fleet.boxes[0].name, 'nowhere')
    assert.strictEqual(fleet.boxes[0].up, false)
  })

  it('returns up:true with real data for local box', async () => {
    const hostname = os.hostname().toLowerCase()
    const boxes = [{
      host: hostname,
      label: hostname,
      aliases: [hostname],
      services: [],
    }, {
      host: 'nonexistent',
      label: 'nonexistent',
      aliases: ['nonexistent'],
      services: [],
    }]
    const fleet = await rig.getFleet(boxes)
    assert.ok(fleet.boxes)

    // Local box should be up (agent running on 127.0.0.1:18081)
    const local = fleet.boxes.find(b => b.name === hostname)
    assert.ok(local, 'local box should be in fleet')
    assert.strictEqual(local.up, true, 'local box should be up')
    assert.ok(local.vramTotal > 0, 'should have real VRAM total')

    // Nonexistent box should be down
    const remote = fleet.boxes.find(b => b.name === 'nonexistent')
    assert.ok(remote, 'nonexistent box should be in fleet')
    assert.strictEqual(remote.up, false, 'nonexistent box should be down')
  })
})
