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
    assert.strictEqual(rig.serviceType('llama-server'), 'llama_cpp')
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

  it('includes llama_cpp slot telemetry', () => {
    const snapshot = {
      host: { hostname: 'chonko', cpuPercent: 0, memUsedMb: 0, memTotalMb: 0, diskUsedPercent: 0, gpu: null },
      services: [
        { name: 'llama-server', up: true, type: 'llama_cpp', models: [], queue: 0, running: 1, activeSlots: 1, totalPromptTokens: 286274, totalDecoded: 2082 },
      ],
      lastUpdated: null,
    }
    const text = rig.toPrometheusText(snapshot)
    assert.ok(text.includes('gen_llama_active_slots{node="chonko",service="llama-server"} 1'))
    assert.ok(text.includes('gen_llama_prompt_tokens{node="chonko",service="llama-server"} 286274'))
    assert.ok(text.includes('gen_llama_decoded_tokens{node="chonko",service="llama-server"} 2082'))
  })

  it('does not emit llama metrics for non-llama services', () => {
    const snapshot = {
      host: { hostname: 'box', cpuPercent: 0, memUsedMb: 0, memTotalMb: 0, diskUsedPercent: 0, gpu: null },
      services: [
        { name: 'ollama', up: true, type: 'ollama', models: [], queue: 0, running: 1 },
      ],
      lastUpdated: null,
    }
    const text = rig.toPrometheusText(snapshot)
    assert.ok(!text.includes('gen_llama'))
  })
})

// ── serve() HTTP server ──────────────────────────────────────────────────────

describe('serve()', () => {
  it('/status returns JSON, /metrics returns Prometheus text, 404 for unknown', async () => {
    const { server, stop, getSnapshot } = rig.serve({
      port: 0,                       // ephemeral — never collide (EADDRINUSE hang)
      interval: 10,
      listen: '127.0.0.1',
      boxes: [{ host: 'x', label: 'x', aliases: ['x'], services: [] }],
    })

    try {
      await new Promise(r => server.once('listening', r))
      const port = server.address().port

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
    const { server, stop, getSnapshot } = rig.serve({
      port: 0,                       // ephemeral — never collide (EADDRINUSE hang)
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
      const port = server.address().port
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
      const { server, stop } = rig.serve({
        port: 0,                     // ephemeral — never collide (EADDRINUSE hang)
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

  it('loadBoxesGraceful returns [] when rig.json is absent', async () => {
    const { config } = require('../lib/env')
    const origRoot = config.root
    try {
      // Mutate config.root to a dir without rig.json or entities/
      config.root = os.tmpdir()
      const boxes = await rig.loadBoxesGraceful()
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
    const { server, stop } = rig.serveDashboard({
      port: 0,                       // ephemeral — never collide (EADDRINUSE hang)
      listen: '127.0.0.1',
      boxes: [{ host: 'x', label: 'x', aliases: ['x'], services: [] }],
    })

    try {
      await new Promise(r => server.once('listening', r))
      const port = server.address().port

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

// ── discoverLocalServices() ──────────────────────────────────────────────────
// Integration, not mocked — matches this repo's "real system calls over
// mocks" testing style (buildSnapshot() below does the same for si/rocm-smi).

// ── parseNvidiaSmi() ─────────────────────────────────────────────────────────

describe('parseNvidiaSmi()', () => {
  it('parses "util, temp" CSV output', () => {
    assert.deepStrictEqual(rig.parseNvidiaSmi('12, 45\n'), { gpuPct: 12, temp: 45 })
  })

  it('returns null on garbage input', () => {
    assert.strictEqual(rig.parseNvidiaSmi(''), null)
    assert.strictEqual(rig.parseNvidiaSmi('not,a,number'), null)
  })
})

describe('parseRocmSmi()', () => {
  it('parses GPU%, VRAM%, and temp from a real rocm-smi concise-info line', () => {
    const text = [
      '======================================== ROCm System Management Interface ========================================',
      '================================================== Concise Info ==================================================',
      'Device  Node  IDs              Temp    Power  Partitions          SCLK   MCLK   Fan    Perf  PwrCap  VRAM%  GPU%',
      '0       1     0x7551,   17620  41.0°C  11.0W  N/A, N/A, 0         39Mhz  96Mhz  14.9%  auto  300.0W  26%    3%',
      '==================================================================================================================',
    ].join('\n')
    assert.deepStrictEqual(rig.parseRocmSmi(text), { gpuPct: 3, vramPct: 26, temp: 41 })
  })

  it('returns null when the data line is missing', () => {
    assert.strictEqual(rig.parseRocmSmi('no data here'), null)
  })
})

describe('discoverLocalServices()', () => {
  it('returns only known generation-service types, never infra like itself', () => {
    const services = rig.discoverLocalServices()
    assert.ok(Array.isArray(services))
    for (const s of services) {
      assert.strictEqual(typeof s.name, 'string')
      assert.strictEqual(typeof s.port, 'number')
      assert.ok(rig.serviceType(s.name), `${s.name} must map to a known type — infra units aren't gen-hotspots signal`)
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

  it('auto-discovers services when rig.json declares none for the local box', async () => {
    const hostname = os.hostname().toLowerCase()
    const boxes = [{ host: hostname, label: hostname, aliases: [hostname], services: [] }]
    const snapshot = await rig.buildSnapshot(boxes)
    // Whatever's actually running on this box — just must not throw, and
    // must never report the poller's own unit as a monitored service.
    assert.ok(Array.isArray(snapshot.services))
    assert.ok(!snapshot.services.some(s => s.name === 'grim-rig-serve'))
  })

  it('discovers local services when no local box matches', async () => {
    const boxes = [{
      host: 'nowhere',
      label: 'nowhere',
      aliases: ['nowhere'],
      services: [{ name: 'ollama', port: 11434 }],
    }]
    const snapshot = await rig.buildSnapshot(boxes)
    // No local box match → self-discovery runs; services reflect what's actually
    // running on this host via systemctl --user, not the declared ollama on "nowhere"
    assert.ok(Array.isArray(snapshot.services))
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

// ── aggregateGpus() ──────────────────────────────────────────────────────────
// Regression coverage: getFleet() used to read host.gpu (singular, GPU 0 only),
// so a dual-P40 box like chonko would silently drop the second card's VRAM/util/
// temp from the fleet view.

describe('aggregateGpus()', () => {
  it('sums VRAM and takes max util/temp across multiple GPUs', () => {
    const host = {
      gpus: [
        { model: 'Tesla P40', vramTotalMb: 24576, vramUsedMb: 22010, gpuPercent: 0, tempC: 45 },
        { model: 'Tesla P40', vramTotalMb: 24576, vramUsedMb: 21276, gpuPercent: 40, tempC: 57 },
      ],
    }
    const result = rig.aggregateGpus(host)
    assert.strictEqual(result.vramTotal, 48)
    assert.strictEqual(Math.round(result.vramUsed * 10) / 10, 42.3)
    assert.strictEqual(result.util, 40, 'should take the hotter GPU\'s util, not GPU 0\'s')
    assert.strictEqual(result.temp, 57, 'should take the hotter GPU\'s temp, not GPU 0\'s')
    assert.strictEqual(result.model, 'Tesla P40 ×2')
  })

  it('falls back to the legacy singular host.gpu when gpus array is absent', () => {
    const host = { gpu: { model: 'RTX 4060 Ti', vramTotalMb: 15948, vramUsedMb: 15344, gpuPercent: 20, tempC: 50 } }
    const result = rig.aggregateGpus(host)
    assert.strictEqual(result.vramTotal, 15.57421875)
    assert.strictEqual(result.model, 'RTX 4060 Ti')
  })

  it('returns zeroed summary with — model when no GPU is present', () => {
    const result = rig.aggregateGpus({})
    assert.deepStrictEqual(result, { vramTotal: 0, vramUsed: 0, util: 0, temp: 0, model: '—' })
  })
})

describe('getFleet()', () => {
  let fleetServer
  let fleetBaseUrl // ephemeral URL for the test server

  beforeEach(async () => {
    const hostname = os.hostname().toLowerCase()
    const { server, stop, getSnapshot } = rig.serve({
      port: 0,                       // ephemeral — never collide (EADDRINUSE hang)
      interval: 1,
      listen: '127.0.0.1',
      boxes: [{ host: hostname, label: hostname, aliases: [hostname], services: [] }],
    })
    await new Promise(r => server.once('listening', r))
    fleetBaseUrl = `http://127.0.0.1:${server.address().port}`
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
    // Pass baseUrl so getFleet hits the ephemeral test server, not a hardcoded port
    const fleet = await rig.getFleet(boxes, { baseUrl: fleetBaseUrl })
    assert.ok(fleet.boxes)

    // Local box should be up (agent running on ephemeral test server)
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

// ── selectComputeGpu() ───────────────────────────────────────────────────────

describe('selectComputeGpu()', () => {
  it('picks NVIDIA over Matrox BMC chip', () => {
    const graphics = {
      controllers: [
        { vendor: 'Matrox Electronics', model: 'G200eW3', vram: 16777216 },
        { vendor: 'NVIDIA', model: 'Tesla P40', vram: 24576 * 1024 * 1024 },
      ],
    }
    const chosen = rig.selectComputeGpu(graphics, null)
    assert.strictEqual(chosen.vendor, 'NVIDIA')
    assert.strictEqual(chosen.model, 'Tesla P40')
  })

  it('picks highest-VRAM when no discrete vendor', () => {
    const graphics = {
      controllers: [
        { vendor: 'Intel', model: 'UHD 630', vram: 32 * 1024 * 1024 },
        { vendor: 'Intel', model: 'Iris Xe', vram: 8192 * 1024 * 1024 },
      ],
    }
    const chosen = rig.selectComputeGpu(graphics, null)
    assert.strictEqual(chosen.model, 'Iris Xe')
  })

  it('trusts smiVram over si.graphics vram', () => {
    const graphics = {
      controllers: [
        { vendor: 'NVIDIA', model: 'Tesla P40', vram: 20000 * 1024 * 1024 },
      ],
    }
    const chosen = rig.selectComputeGpu(graphics, 24576)
    assert.strictEqual(chosen.vram, 24576)
  })

  it('returns null for empty controllers', () => {
    assert.strictEqual(rig.selectComputeGpu({ controllers: [] }, null), null)
    assert.strictEqual(rig.selectComputeGpu(null, null), null)
  })
})

// ── buildSnapshot self-discovery (no boxes) ──────────────────────────────────

describe('buildSnapshot() self-discovery', () => {
  it('calls discoverLocalServices when boxes is empty', async () => {
    // Use a real call — on this host it returns whatever --user units are running
    const snapshot = await rig.buildSnapshot([])
    assert.ok(Array.isArray(snapshot.services))
    // Should not throw; services may be empty if no matching units are running
    assert.ok(snapshot.host)
    assert.strictEqual(snapshot.host.hostname, os.hostname().toLowerCase())
  })
})

// ── selectAllComputeGpus() ───────────────────────────────────────────────────

// ── parseSmiGpus() ───────────────────────────────────────────────────────────
// Regression coverage for a real bug: the parser required literal "MiB"/"%"
// unit suffixes, but --format=csv,noheader,nounits (as the name says) never
// emits them — the parser silently matched nothing, on every box, always.
// Sample lines are verbatim `nvidia-smi --query-gpu=index,memory.total,
// memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits`
// output captured from a live dual-P40 box.

describe('parseSmiGpus()', () => {
  it('parses real nounits CSV output — no MiB/% suffixes present', () => {
    const stdout = '0, 24576, 22010, 0, 45\n1, 24576, 21276, 0, 57'
    assert.deepStrictEqual(rig.parseSmiGpus(stdout), [
      { index: 0, memoryTotal: 24576, memoryUsed: 22010, util: 0, temp: 45 },
      { index: 1, memoryTotal: 24576, memoryUsed: 21276, util: 0, temp: 57 },
    ])
  })

  it('returns [] for empty or garbage input', () => {
    assert.deepStrictEqual(rig.parseSmiGpus(''), [])
    assert.deepStrictEqual(rig.parseSmiGpus('command not found\n'), [])
  })
})

describe('parseNvtop()', () => {
  it('parses NVIDIA-style device with byte fields -> correct MiB', () => {
    const stdout = JSON.stringify([{
      device_name: 'NVIDIA A100',
      gpu_util: '85%',
      temp: '72C',
      mem_total: '42949672960',
      mem_used: '10737418240',
      fan_speed: '100%',
    }])
    const r = rig.parseNvtop(stdout)
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].index, 0)
    assert.strictEqual(r[0].vram, 40960) // 42949672960 / 1048576
    assert.strictEqual(r[0].vramUsed, 10240) // 10737418240 / 1048576
    assert.strictEqual(r[0].util, 85)
    assert.strictEqual(r[0].temp, 72)
  })

  it('degrades gracefully when mem_util % present but no byte fields', () => {
    const stdout = JSON.stringify([{
      device_name: 'AMD GPU',
      gpu_util: '45%',
      temp: '58C',
      mem_util: '94%',
      fan_speed: null,
      // no mem_total / mem_used / mem_free
    }])
    const r = rig.parseNvtop(stdout)
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].index, 0)
    assert.strictEqual(r[0].vram, null)
    assert.strictEqual(r[0].vramUsed, null)
    assert.strictEqual(r[0].util, 45)
    assert.strictEqual(r[0].temp, 58)
  })

  it('computes memoryUsed from mem_util when mem_total bytes present but mem_used missing', () => {
    const stdout = JSON.stringify([{
      device_name: 'AMD GPU',
      gpu_util: '30%',
      temp: '55C',
      mem_total: '16106127360',
      mem_util: '60%',
      // no mem_used
    }])
    const r = rig.parseNvtop(stdout)
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].vram, 15360) // 16106127360 / 1048576
    assert.strictEqual(r[0].vramUsed, 9216) // 15360 * 0.6
  })

  it('returns [] for empty, garbage, or non-JSON input', () => {
    assert.deepStrictEqual(rig.parseNvtop(''), [])
    assert.deepStrictEqual(rig.parseNvtop('not json'), [])
    assert.deepStrictEqual(rig.parseNvtop('command not found\n'), [])
    assert.deepStrictEqual(rig.parseNvtop('{"not": "array"}'), [])
  })

  it('handles null/missing fields without crashing', () => {
    const stdout = JSON.stringify([{
      device_name: 'Some GPU',
      // all optional fields missing
    }])
    const r = rig.parseNvtop(stdout)
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].util, null)
    assert.strictEqual(r[0].temp, null)
    assert.strictEqual(r[0].vram, null)
    assert.strictEqual(r[0].vramUsed, null)
  })
})

describe('selectAllComputeGpus()', () => {
  it('returns two NVIDIA P40s with smi VRAM', () => {
    const g = { controllers: [
      { vendor: 'NVIDIA', model: 'Tesla P40', vram: 20000 * 1024 * 1024 },
      { vendor: 'NVIDIA', model: 'Tesla P40', vram: 20000 * 1024 * 1024 },
    ]}
    const smi = [{ index: 0, memoryTotal: 24576, memoryUsed: 4096 }, { index: 1, memoryTotal: 24576, memoryUsed: 2048 }]
    const result = rig.selectAllComputeGpus(g, smi)
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].model, 'Tesla P40')
    assert.strictEqual(result[0].vram, 24576)
    assert.strictEqual(result[0].vramUsed, 4096)
    assert.strictEqual(result[0].index, 0)
    assert.strictEqual(result[1].vram, 24576)
    assert.strictEqual(result[1].vramUsed, 2048)
    assert.strictEqual(result[1].index, 1)
  })

  it('carries per-GPU util/temp from smi for every card, not just index 0', () => {
    const g = { controllers: [
      { vendor: 'NVIDIA', model: 'Tesla P40', vram: 20000 * 1024 * 1024 },
      { vendor: 'NVIDIA', model: 'Tesla P40', vram: 20000 * 1024 * 1024 },
    ]}
    const smi = [
      { index: 0, memoryTotal: 24576, memoryUsed: 4096, util: 12, temp: 55 },
      { index: 1, memoryTotal: 24576, memoryUsed: 2048, util: 40, temp: 61 },
    ]
    const result = rig.selectAllComputeGpus(g, smi)
    assert.strictEqual(result[0].util, 12)
    assert.strictEqual(result[0].temp, 55)
    assert.strictEqual(result[1].util, 40)
    assert.strictEqual(result[1].temp, 61, 'second GPU must get its own temp, not the first GPU\'s or null')
  })

  it('filters out Matrox BMC, keeps NVIDIA', () => {
    const g = { controllers: [
      { vendor: 'Matrox Electronics', model: 'G200eW3', vram: 16777216 },
      { vendor: 'NVIDIA', model: 'Tesla P40', vram: 24576 * 1024 * 1024 },
    ]}
    const result = rig.selectAllComputeGpus(g, [{ index: 0, memoryTotal: 24576, memoryUsed: 0 }])
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].model, 'Tesla P40')
  })

  it('returns empty for null/empty input', () => {
    assert.strictEqual(rig.selectAllComputeGpus(null, []).length, 0)
    assert.strictEqual(rig.selectAllComputeGpus({ controllers: [] }, []).length, 0)
  })
})

// ── toPrometheusText with multi-GPU ──────────────────────────────────────────

describe('toPrometheusText() multi-GPU', () => {
  it('emits labeled series for each GPU', () => {
    const snapshot = {
      host: {
        hostname: 'chonko',
        cpuPercent: 10, memUsedMb: 0, memTotalMb: 0, diskUsedPercent: 0,
        gpus: [
          { vendor: 'NVIDIA', model: 'Tesla P40', vramTotalMb: 24576, vramUsedMb: 4096, gpuPercent: 15, tempC: 48, index: 0, computeApps: [] },
          { vendor: 'NVIDIA', model: 'Tesla P40', vramTotalMb: 24576, vramUsedMb: 2048, gpuPercent: null, tempC: null, index: 1, computeApps: [] },
        ],
        gpu: { vendor: 'NVIDIA', model: 'Tesla P40', vramTotalMb: 24576, vramUsedMb: 4096, gpuPercent: 15, tempC: 48, computeApps: [] },
      },
      services: [],
      lastUpdated: null,
    }
    const text = rig.toPrometheusText(snapshot)
    assert.ok(text.includes('gen_gpu_vram_total_mb{node="chonko",gpu="0"} 24576'))
    assert.ok(text.includes('gen_gpu_vram_total_mb{node="chonko",gpu="1"} 24576'))
    assert.ok(text.includes('gen_gpu_vram_used_mb{node="chonko",gpu="0"} 4096'))
    assert.ok(text.includes('gen_gpu_vram_used_mb{node="chonko",gpu="1"} 2048'))
    assert.ok(text.includes('gen_gpu_util_percent{node="chonko",gpu="0"} 15'))
    // gpu="1" has no util percent (null)
    assert.ok(!text.includes('gen_gpu_util_percent{node="chonko",gpu="1"}'))
    // No unlabeled series
    assert.ok(!text.match(/gen_gpu_vram_total_mb\{node="chonko"\}/))
  })
})
