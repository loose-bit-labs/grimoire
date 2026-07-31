#!/usr/bin/env node
'use strict'

/**
 * generate-dashboard.js — regenerate per-host rows in dashboard-hotspots.json from rig.json.
 *
 * Grafana's row-repeat ($node in a repeated row's title) is a long-standing upstream bug
 * (grafana/grafana#14443, #9547, #104374) — the title never gets the real hostname
 * substituted. So per-host sections are static rows here instead, one block per
 * non-skipped host in rig.json, regenerated deterministically whenever the host list
 * changes — same idea as generate-scrape.sh for Prometheus targets.
 *
 * Usage:
 *   deploy/telemetry/generate-dashboard.js [rig.json]
 *
 * Idempotent: re-running with an unchanged rig.json produces byte-identical per-host
 * rows (only the "version" field bumps, and only when the row set actually changed).
 */

const fs = require('node:fs')
const path = require('node:path')

class DashboardGenerator {
  constructor({ rigPath, dashboardPath, provisioningPath } = {}) {
    this.telemetryDir = __dirname
    this.rigPath = rigPath || path.join(process.env.GRIMOIRE_ROOT || path.join(process.env.HOME, 'data', 'grimoire-kb'), 'rig.json')
    this.dashboardPath = dashboardPath || path.join(this.telemetryDir, 'dashboard-hotspots.json')
    this.provisioningPath = provisioningPath || path.join(this.telemetryDir, 'provisioning', 'dashboards', 'dashboard-hotspots.json')
  }

  loadHosts() {
    if (!fs.existsSync(this.rigPath)) {
      throw new Error(`rig.json not found at ${this.rigPath}`)
    }
    const rig = JSON.parse(fs.readFileSync(this.rigPath, 'utf8'))
    return rig.filter(b => !b.skip).map(b => b.host)
  }

  // The 7-panel-per-host template. host-scoped query filters are the only thing
  // that varies between hosts — everything else (layout, thresholds, units) is shared.
  hostPanels(host, rowId) {
    const p = id => rowId * 10 + id
    return [
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 70 }, { color: 'red', value: 90 }] },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 4, x: 0, y: 0 },
        id: p(1),
        title: 'CPU %',
        type: 'gauge',
        targets: [{ expr: `gen_host_cpu_percent{job!="grafana",node="${host}"}`, legendFormat: '{{node}}', refId: 'A' }],
        options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 70 }, { color: 'red', value: 90 }] },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 4, x: 4, y: 0 },
        id: p(2),
        title: 'Mem %',
        type: 'gauge',
        targets: [{ expr: `gen_host_mem_used_mb{job!="grafana",node="${host}"} / gen_host_mem_total_mb{job!="grafana",node="${host}"} * 100`, legendFormat: '{{node}}', refId: 'A' }],
        options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 80 }, { color: 'red', value: 95 }] },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 4, x: 8, y: 0 },
        id: p(3),
        title: 'Disk %',
        type: 'gauge',
        targets: [{ expr: `gen_host_disk_used_percent{job!="grafana",node="${host}"}`, legendFormat: '{{node}}', refId: 'A' }],
        options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 70 }, { color: 'red', value: 90 }] },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 4, x: 12, y: 0 },
        id: p(8),
        title: 'VRAM %',
        type: 'gauge',
        targets: [{ expr: `gen_gpu_vram_used_mb{job!="grafana",node="${host}"} / gen_gpu_vram_total_mb{job!="grafana",node="${host}"} * 100`, legendFormat: 'gpu{{gpu}}', refId: 'A' }],
        options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 70 }, { color: 'red', value: 85 }] },
            min: 0, max: 100, unit: 'celsius',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 4, x: 16, y: 0 },
        id: p(9),
        title: 'GPU Temp',
        type: 'gauge',
        targets: [{ expr: `gen_gpu_temp_c{job!="grafana",node="${host}"}`, legendFormat: 'gpu{{gpu}}', refId: 'A', interval: '5s' }],
        options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 70 }, { color: 'red', value: 90 }] },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 4, x: 20, y: 0 },
        id: p(10),
        title: 'GPU %',
        type: 'gauge',
        targets: [{ expr: `gen_gpu_util_percent{job!="grafana",node="${host}"}`, legendFormat: 'gpu{{gpu}}', refId: 'A' }],
        options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'palette-classic' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 8 }] },
            custom: {
              axisCenteredZero: false, axisLabel: '', axisPlacement: 'auto', barAlignment: 0,
              drawStyle: 'bars', fillOpacity: 80, gradientMode: 'none', lineWidth: 1, pointSize: 5,
              scaleDistribution: { type: 'linear' }, showPoints: 'never', spanNulls: false,
              stacking: { group: 'A', mode: 'stack' }, thresholdsStyle: { mode: 'off' },
            },
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 24, x: 0, y: 16 },
        id: p(4),
        title: 'Queue / Running',
        type: 'timeseries',
        targets: [
          { expr: `gen_queue_pending{job!="grafana",node="${host}"}`, legendFormat: '{{service}} queue', refId: 'A' },
          { expr: `gen_requests_running{job!="grafana",node="${host}"}`, legendFormat: '{{service}} running', refId: 'B' },
        ],
        options: { legend: { displayMode: 'table', placement: 'bottom', calcs: [] } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'palette-classic' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
            custom: {
              axisCenteredZero: false, axisLabel: '', axisPlacement: 'auto', barAlignment: 0,
              drawStyle: 'line', fillOpacity: 10, gradientMode: 'none', lineWidth: 2, pointSize: 5,
              scaleDistribution: { type: 'linear' }, showPoints: 'never', spanNulls: false,
              stacking: { group: 'A', mode: 'none' }, thresholdsStyle: { mode: 'off' },
            },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 8, x: 0, y: 8 },
        id: p(5),
        title: 'CPU / Mem (last 2m)',
        type: 'timeseries',
        timeFrom: '2m',
        targets: [
          { expr: `gen_host_cpu_percent{job!="grafana",node="${host}"}`, legendFormat: 'cpu', refId: 'A', interval: '5s' },
          { expr: `gen_host_mem_used_mb{job!="grafana",node="${host}"} / gen_host_mem_total_mb{job!="grafana",node="${host}"} * 100`, legendFormat: 'mem', refId: 'B', interval: '5s' },
        ],
        options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'palette-classic' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
            custom: {
              axisCenteredZero: false, axisLabel: '', axisPlacement: 'auto', barAlignment: 0,
              drawStyle: 'line', fillOpacity: 10, gradientMode: 'none', lineWidth: 2, pointSize: 5,
              scaleDistribution: { type: 'linear' }, showPoints: 'never', spanNulls: false,
              stacking: { group: 'A', mode: 'none' }, thresholdsStyle: { mode: 'off' },
            },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 8, x: 8, y: 8 },
        id: p(6),
        title: 'VRAM / GPU Compute (last 2m)',
        type: 'timeseries',
        timeFrom: '2m',
        targets: [
          { expr: `gen_gpu_vram_used_mb{job!="grafana",node="${host}"} / gen_gpu_vram_total_mb{job!="grafana",node="${host}"} * 100`, legendFormat: 'vram % gpu{{gpu}}', refId: 'A', interval: '5s' },
          { expr: `gen_gpu_util_percent{job!="grafana",node="${host}"}`, legendFormat: 'gpu compute %', refId: 'B', interval: '5s' },
        ],
        options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'palette-classic' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
            custom: {
              axisCenteredZero: false, axisLabel: '', axisPlacement: 'auto', barAlignment: 0,
              drawStyle: 'line', fillOpacity: 10, gradientMode: 'none', lineWidth: 2, pointSize: 5,
              scaleDistribution: { type: 'linear' }, showPoints: 'never', spanNulls: false,
              stacking: { group: 'A', mode: 'none' }, thresholdsStyle: { mode: 'off' },
            },
            unit: 'celsius',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 8, x: 16, y: 8 },
        id: p(7),
        title: 'GPU Temp (last 2m)',
        type: 'timeseries',
        timeFrom: '2m',
        targets: [{ expr: `gen_gpu_temp_c{job!="grafana",node="${host}"}`, legendFormat: 'gpu{{gpu}}', refId: 'A', interval: '5s' }],
        options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] } },
      },
      {
        datasource: { type: 'prometheus', uid: 'prometheus' },
        fieldConfig: {
          defaults: {
            color: { mode: 'palette-classic' },
            thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
            custom: {
              axisCenteredZero: false, axisLabel: '', axisPlacement: 'auto', barAlignment: 0,
              drawStyle: 'line', fillOpacity: 10, gradientMode: 'none', lineWidth: 2, pointSize: 5,
              scaleDistribution: { type: 'linear' }, showPoints: 'never', spanNulls: false,
              stacking: { group: 'A', mode: 'none' }, thresholdsStyle: { mode: 'off' },
            },
            min: 0, max: 100, unit: 'percent',
          },
          overrides: [],
        },
        gridPos: { h: 8, w: 24, x: 0, y: 24 },
        id: p(8),
        title: 'VRAM / GPU Compute (last 10m)',
        type: 'timeseries',
        timeFrom: '10m',
        targets: [
          { expr: `gen_gpu_vram_used_mb{job!="grafana",node="${host}"} / gen_gpu_vram_total_mb{job!="grafana",node="${host}"} * 100`, legendFormat: 'vram % gpu{{gpu}}', refId: 'A', interval: '5s' },
          { expr: `gen_gpu_util_percent{job!="grafana",node="${host}"}`, legendFormat: 'gpu compute %', refId: 'B', interval: '5s' },
        ],
        options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] } },
      },
    ]
  }

  hostRow(host, index, startY) {
    const rowId = 300 + index
    return {
      collapsed: true,
      gridPos: { h: 1, w: 24, x: 0, y: startY },
      id: rowId,
      title: `▸ ${host}`,
      type: 'row',
      panels: this.hostPanels(host, rowId),
    }
  }

  // ▸-prefixed rows are the generated per-host blocks; everything else (Overview,
  // alerts, templating) is hand-authored and left untouched.
  rebuild(dashboard, hosts) {
    const BLOCK_HEIGHT = 1 + 8 + 8 + 8
    const staticPanels = dashboard.panels.filter(p => !(p.type === 'row' && p.title.startsWith('▸ ')))
    const startY = Math.max(0, ...staticPanels.map(p => p.gridPos.y + p.gridPos.h)) + 1
    const hostRows = hosts.map((host, i) => this.hostRow(host, i, startY + i * BLOCK_HEIGHT))
    dashboard.panels = [...staticPanels, ...hostRows]
    return dashboard
  }

  generate() {
    const hosts = this.loadHosts()
    const dashboard = JSON.parse(fs.readFileSync(this.dashboardPath, 'utf8'))
    const before = JSON.stringify(dashboard.panels.filter(p => p.type === 'row' && p.title.startsWith('▸ ')))

    this.rebuild(dashboard, hosts)

    const after = JSON.stringify(dashboard.panels.filter(p => p.type === 'row' && p.title.startsWith('▸ ')))
    if (before !== after) dashboard.version = (dashboard.version || 0) + 1

    const text = JSON.stringify(dashboard, null, 2) + '\n'
    fs.writeFileSync(this.dashboardPath, text)

    return { hosts, changed: before !== after, version: dashboard.version }
  }

  main() {
    const rigArg = process.argv[2]
    if (rigArg) this.rigPath = rigArg
    const { hosts, changed, version } = this.generate()
    console.log(`grim dashboard: ${hosts.length} host(s) — ${hosts.join(', ')}`)
    console.log(changed ? `rows regenerated, version ${version}` : 'no change (host list matches existing rows)')
  }
}

if (require.main === module) {
  try {
    new DashboardGenerator().main()
  } catch (e) {
    console.error(`generate-dashboard.js: ${e.message}`)
    process.exit(1)
  }
}

module.exports = { DashboardGenerator }
