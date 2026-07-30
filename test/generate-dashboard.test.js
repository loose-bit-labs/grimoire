'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { DashboardGenerator } = require('../deploy/telemetry/generate-dashboard.js')

// ── helpers ──────────────────────────────────────────────────────────────────

function baseDashboard() {
  return {
    panels: [
      { id: 100, type: 'row', title: 'Overview / Alerts', gridPos: { h: 1, w: 24, x: 0, y: 0 } },
      { id: 1, type: 'bargauge', title: 'VRAM Hotspots', gridPos: { h: 8, w: 12, x: 0, y: 1 } },
    ],
    version: 1,
  }
}

function tmpFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grim-dash-gen-'))
  const rigPath = path.join(dir, 'rig.json')
  const dashboardPath = path.join(dir, 'dashboard-hotspots.json')
  const provisioningPath = path.join(dir, 'provisioning', 'dashboard-hotspots.json')
  fs.writeFileSync(dashboardPath, JSON.stringify(baseDashboard()))
  return { dir, rigPath, dashboardPath, provisioningPath }
}

// ── loadHosts() ──────────────────────────────────────────────────────────────

describe('DashboardGenerator.loadHosts()', () => {
  it('returns non-skipped hosts in rig.json order', () => {
    const { rigPath, dashboardPath, provisioningPath } = tmpFiles()
    fs.writeFileSync(rigPath, JSON.stringify([
      { host: 'aid' }, { host: 'chonko' }, { host: 'meinherz', skip: true },
    ]))
    const gen = new DashboardGenerator({ rigPath, dashboardPath, provisioningPath })
    assert.deepStrictEqual(gen.loadHosts(), ['aid', 'chonko'])
  })

  it('throws a clear error when rig.json is missing', () => {
    const { rigPath, dashboardPath, provisioningPath } = tmpFiles()
    const gen = new DashboardGenerator({ rigPath, dashboardPath, provisioningPath })
    assert.throws(() => gen.loadHosts(), /rig\.json not found/)
  })
})

// ── rebuild() ────────────────────────────────────────────────────────────────

describe('DashboardGenerator.rebuild()', () => {
  it('generates one row per host, each with 10 panels, and drops old ▸ rows', () => {
    const { rigPath, dashboardPath, provisioningPath } = tmpFiles()
    const gen = new DashboardGenerator({ rigPath, dashboardPath, provisioningPath })
    const dashboard = baseDashboard()
    dashboard.panels.push({ id: 200, type: 'row', title: '▸ stale-host', gridPos: { h: 1, w: 24, x: 0, y: 9 }, panels: [] })

    gen.rebuild(dashboard, ['aid', 'chonko'])

    const rows = dashboard.panels.filter(p => p.type === 'row' && p.title.startsWith('▸ '))
    assert.strictEqual(rows.length, 2)
    assert.deepStrictEqual(rows.map(r => r.title), ['▸ aid', '▸ chonko'])
    for (const row of rows) assert.strictEqual(row.panels.length, 10)

    // Static panels (Overview) survive untouched
    assert.ok(dashboard.panels.some(p => p.id === 1 && p.title === 'VRAM Hotspots'))
  })

  it('scopes every per-host query to that host\'s node label', () => {
    const { rigPath, dashboardPath, provisioningPath } = tmpFiles()
    const gen = new DashboardGenerator({ rigPath, dashboardPath, provisioningPath })
    const dashboard = baseDashboard()
    gen.rebuild(dashboard, ['meinherz'])

    const row = dashboard.panels.find(p => p.title === '▸ meinherz')
    for (const panel of row.panels) {
      for (const target of panel.targets) {
        assert.ok(target.expr.includes('node="meinherz"'), `expected node filter in: ${target.expr}`)
      }
    }
  })

  it('stacks host rows without overlapping gridPos.y', () => {
    const { rigPath, dashboardPath, provisioningPath } = tmpFiles()
    const gen = new DashboardGenerator({ rigPath, dashboardPath, provisioningPath })
    const dashboard = baseDashboard()
    gen.rebuild(dashboard, ['aid', 'chonko', 'meinherz'])

    const rows = dashboard.panels.filter(p => p.type === 'row' && p.title.startsWith('▸ '))
    const ys = rows.map(r => r.gridPos.y)
    assert.strictEqual(new Set(ys).size, ys.length, 'row y-positions must be unique')
    assert.deepStrictEqual(ys, [...ys].sort((a, b) => a - b), 'rows should stack in order')
  })
})

// ── generate() / idempotency ─────────────────────────────────────────────────

describe('DashboardGenerator.generate()', () => {
  let files
  beforeEach(() => { files = tmpFiles() })
  afterEach(() => { fs.rmSync(files.dir, { recursive: true, force: true }) })

  it('writes both the canonical and provisioning copies', () => {
    fs.writeFileSync(files.rigPath, JSON.stringify([{ host: 'aid' }]))
    const gen = new DashboardGenerator(files)
    gen.generate()

    const canonical = JSON.parse(fs.readFileSync(files.dashboardPath, 'utf8'))
    const provisioned = JSON.parse(fs.readFileSync(files.provisioningPath, 'utf8'))
    assert.deepStrictEqual(canonical, provisioned)
  })

  it('bumps version only when the host row set actually changes', () => {
    fs.writeFileSync(files.rigPath, JSON.stringify([{ host: 'aid' }]))
    const gen = new DashboardGenerator(files)

    const first = gen.generate()
    assert.strictEqual(first.changed, true)
    const v1 = first.version

    const second = gen.generate()
    assert.strictEqual(second.changed, false, 're-running with the same host list should be a no-op')
    assert.strictEqual(second.version, v1)

    fs.writeFileSync(files.rigPath, JSON.stringify([{ host: 'aid' }, { host: 'newbox' }]))
    const third = gen.generate()
    assert.strictEqual(third.changed, true)
    assert.strictEqual(third.version, v1 + 1)
  })

  it('produces byte-identical output across repeated runs (deterministic)', () => {
    fs.writeFileSync(files.rigPath, JSON.stringify([{ host: 'aid' }, { host: 'chonko' }]))
    const gen = new DashboardGenerator(files)
    gen.generate()
    const run1 = fs.readFileSync(files.dashboardPath, 'utf8')
    gen.generate()
    const run2 = fs.readFileSync(files.dashboardPath, 'utf8')
    assert.strictEqual(run1, run2)
  })
})
