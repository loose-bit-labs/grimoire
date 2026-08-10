#!/usr/bin/env node
'use strict'

/**
 * test/hmm.test.js — HMM Tracking status core
 *
 * Drives fixture .mm threads through every status:
 *   working, conversing, waiting-on-user, waiting, sleeping, retired
 * Fixtures live in a temp dir — no test reads real ~/src/me.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs     = require('node:fs')
const path   = require('node:path')

const { scanProjects, projectStatus, toPrometheus, ACTIVE_SEC, IDLE_SEC, STATUSES } = require('../lib/hmm')

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Write a .mm thread file with the given frontmatter and optional body.
 */
function writeThread(dir, num, from, to, phase, state, ts, opts = {}) {
  const { body = '', scope = '' } = opts
  const scopeLine = scope ? `\nscope: ${scope}` : ''
  const content = `---\nid: msg-${num}\nts: ${ts}\nfrom: ${from}\nto: ${to}\nphase: ${phase}\nstate: ${state}${scopeLine}\n---\n\n${body}`
  fs.writeFileSync(path.join(dir, `${String(num).padStart(4, '0')}-from-${from}-to-${to}.md`), content)
}

/**
 * Create a temp project dir with a .mm/ subdir and ROADMAP.md.
 * @param {string} tmpDir — temp root
 * @param {string} name — project name
 * @param {number} roadmapOpen — number of open phases (0 = retired)
 * @returns {string} path to .mm/ dir
 */
function mkProject(tmpDir, name, roadmapOpen = 1) {
  const projDir = path.join(tmpDir, name)
  const mmDir   = path.join(projDir, '.mm')
  fs.mkdirSync(mmDir, { recursive: true })
  const plansDir = path.join(projDir, 'plans')
  fs.mkdirSync(plansDir, { recursive: true })
  if (roadmapOpen > 0) {
    const rows = Array.from({ length: roadmapOpen }, (_, i) =>
      `| ${i + 1} | — | Phase ${i + 1} | open |`
    ).join('\n')
    fs.writeFileSync(path.join(plansDir, 'ROADMAP.md'),
      `| phase | brief | title | status |\n|-------|-------|-------|--------|\n${rows}`)
  } else {
    fs.writeFileSync(path.join(plansDir, 'ROADMAP.md'),
      `| phase | brief | title | status |\n|-------|-------|-------|--------|\n| 1 | — | Phase 1 | closed 2026-01-01 |`)
  }
  return mmDir
}

/**
 * Return a ts string that is `sec` seconds ago from now.
 */
function ago(sec) {
  const d = new Date(Date.now() - sec * 1000)
  const yy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${yy}-${mm}-${dd}_${hh}:${mi}:${ss}`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('hmm: status core', () => {
  it('exports ACTIVE_SEC and IDLE_SEC', () => {
    assert.ok(typeof ACTIVE_SEC === 'number', 'ACTIVE_SEC is a number')
    assert.ok(typeof IDLE_SEC === 'number', 'IDLE_SEC is a number')
    assert.ok(ACTIVE_SEC > 0, 'ACTIVE_SEC is positive')
    assert.ok(IDLE_SEC > ACTIVE_SEC, 'IDLE_SEC > ACTIVE_SEC')
  })

  it('working: owns next move, recent activity', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-working', 1)
      const t = ago(60) // 1 min ago
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', t)
      // latest.from=mage, NEXT_OWNER[mage]=minion → minion owns next
      const projects = scanProjects(tmp)
      assert.equal(projects.length, 1)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      const minion = ps.participants.find(p => p.role === 'minion')
      assert.equal(minion.status, 'working', 'minion should be working')
      const mage = ps.participants.find(p => p.role === 'mage')
      assert.equal(mage.status, 'waiting', 'mage should be waiting')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('conversing: last ≥2 messages alternate roles within ACTIVE_SEC', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-conv', 1)
      const t1 = ago(120) // 2 min ago
      const t2 = ago(60)  // 1 min ago
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', t1)
      writeThread(mmDir, 2, 'minion', 'mage', 1, 'report', t2)
      // latest.from=minion, NEXT_OWNER[minion]=mage → mage owns next
      // Last 2 msgs alternate roles within ACTIVE_SEC → conversing
      const projects = scanProjects(tmp)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      const mage = ps.participants.find(p => p.role === 'mage')
      assert.equal(mage.status, 'conversing', 'mage should be conversing')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('waiting-on-user: latest state is escalate with scope', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-esc', 1)
      const t = ago(60)
      writeThread(mmDir, 1, 'minion', 'mage', 1, 'escalate', t, { body: 'decision: which library', scope: 'decision: which library' })
      // latest.from=minion, state=escalate, scope=decision
      // NEXT_OWNER[minion]=mage, so mage is the recipient of the escalate
      const projects = scanProjects(tmp)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      const mage = ps.participants.find(p => p.role === 'mage')
      assert.equal(mage.status, 'waiting-on-user', 'mage should be waiting-on-user (escalate)')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('waiting: not their turn', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-wait', 1)
      const t = ago(60)
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', t)
      // latest.from=mage, NEXT_OWNER[mage]=minion → minion owns next
      // hierophant and mage are not their turn
      const projects = scanProjects(tmp)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      const hierophant = ps.participants.find(p => p.role === 'hierophant')
      assert.equal(hierophant.status, 'waiting', 'hierophant should be waiting')
      const mage = ps.participants.find(p => p.role === 'mage')
      assert.equal(mage.status, 'waiting', 'mage should be waiting')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('sleeping: owns move but idle > IDLE_SEC', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-sleep', 1)
      // Build a local-time ts string IDLE_SEC + 60 seconds ago
      const d = new Date(Date.now() - (IDLE_SEC + 60) * 1000)
      const localTs = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', localTs)
      // latest.from=mage, NEXT_OWNER[mage]=minion → minion owns next but idle > IDLE
      const projects = scanProjects(tmp)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      const minion = ps.participants.find(p => p.role === 'minion')
      assert.equal(minion.status, 'sleeping', 'minion should be sleeping')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('retired: roadmapOpen == 0', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-retired', 0)
      const t = ago(60)
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'accepted', t)
      const projects = scanProjects(tmp)
      assert.equal(projects.length, 1)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      assert.ok(ps.retired, 'project should be retired')
      for (const p of ps.participants) {
        assert.equal(p.status, 'retired', `${p.role} should be retired`)
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('scanProjects skips dirs without .mm/', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      fs.mkdirSync(path.join(tmp, 'no-mm-project'), { recursive: true })
      fs.writeFileSync(path.join(tmp, 'no-mm-project', 'README.md'), '# no pact here')
      const projects = scanProjects(tmp)
      assert.equal(projects.length, 0, 'should skip dirs without .mm/')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('scanProjects skips .mm/ dirs with no messages', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = path.join(tmp, 'empty-mm', '.mm')
      fs.mkdirSync(mmDir, { recursive: true })
      const plansDir = path.join(tmp, 'empty-mm', 'plans')
      fs.mkdirSync(plansDir, { recursive: true })
      fs.writeFileSync(path.join(plansDir, 'ROADMAP.md'),
        '| phase | brief | title | status |\n|-------|-------|-------|--------|\n| 1 | — | Phase 1 | open |')
      const projects = scanProjects(tmp)
      assert.equal(projects.length, 0, 'should skip empty .mm/ dirs')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('lib/hmm.js never writes .mm (grep check)', () => {
    const hmmSrc = fs.readFileSync('lib/hmm.js', 'utf8')
    assert.ok(!/writeFile.*\.mm/.test(hmmSrc), 'lib/hmm.js should not write .mm files')
    assert.ok(!/writeSync.*\.mm/.test(hmmSrc), 'lib/hmm.js should not write .mm files')
  })

  it('working: real local ts (not UTC) shows fresh activity as working', () => {
    // Regression test for timezone skew bug: ts fields are local time,
    // not UTC. If parsed as UTC, age is inflated by TZ offset and
    // working/conversing become unreachable.
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-tz', 1)
      // Build a ts in local time format, ~30 seconds ago
      const d = new Date(Date.now() - 30 * 1000)
      const yy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mi = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      const localTs = `${yy}-${mm}-${dd}_${hh}:${mi}:${ss}`
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', localTs)
      const projects = scanProjects(tmp)
      const now = Math.floor(Date.now() / 1000)
      const ps = projectStatus(projects[0], now)
      const minion = ps.participants.find(p => p.role === 'minion')
      assert.equal(minion.status, 'working', `minion should be working (fresh local ts), got ${minion.status}`)
      assert.ok(minion.lastActivitySec < ACTIVE_SEC, `minion age ${minion.lastActivitySec}s should be < ACTIVE_SEC ${ACTIVE_SEC}s`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('mtime fallback: ts-less message shows sane age from file mtime', () => {
    // Regression test for basename bug: msg.file is a bare basename,
    // so fs.statSync(msg.file) fails and returns epoch 0 → age ≈ 56 years.
    // Fix: scanProjects attaches absolute _path to each message.
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-mtime', 1)
      // Write a thread file WITHOUT a ts: field
      const content = `---\nid: msg-0001\nfrom: mage\nto: minion\nphase: 1\nstate: brief\n---\n\nbody`
      fs.writeFileSync(path.join(mmDir, '0001-from-mage-to-minion.md'), content)
      const projects = scanProjects(tmp)
      const now = Math.floor(Date.now() / 1000)
      const ps = projectStatus(projects[0], now)
      const minion = ps.participants.find(p => p.role === 'minion')
      // Age should be small (seconds from file creation), not ~epoch-0 (~56 years)
      // Age can be 0 if file was just created (mtime == now), but must be << 1 year
      assert.ok(minion.lastActivitySec < 86400, `minion age ${minion.lastActivitySec}s should be < 1 day (mtime fallback working)`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('hmm: toPrometheus', () => {
  it('emits bounded gauges per participant', () => {
    const projects = [
      {
        project: 'grimoire',
        roadmapOpen: 1,
        retired: false,
        participants: [
          { role: 'hierophant', status: 'waiting', lastActivitySec: 360 },
          { role: 'mage', status: 'sleeping', lastActivitySec: 1200 },
          { role: 'minion', status: 'working', lastActivitySec: 60 },
        ],
      },
    ]
    const out = toPrometheus(projects, 'aid')
    // Should have 6 lines: 3 status + 3 activity
    const lines = out.trim().split('\n')
    assert.equal(lines.length, 6, 'should emit 2 gauges × 3 participants')
    assert.ok(out.includes('hmm_participant_status{host="aid",project="grimoire",role="hierophant",status="waiting"} 0'), 'waiting → 0')
    assert.ok(out.includes('hmm_participant_status{host="aid",project="grimoire",role="minion",status="working"} 1'), 'working → 1')
    assert.ok(out.includes('hmm_last_activity_seconds{host="aid",project="grimoire",role="minion"} 60'), 'age 60')
  })

  it('retired participants emit status 0', () => {
    const projects = [
      {
        project: 'wantan',
        roadmapOpen: 0,
        retired: true,
        participants: [
          { role: 'hierophant', status: 'retired', lastActivitySec: 50000 },
          { role: 'mage', status: 'retired', lastActivitySec: 50000 },
          { role: 'minion', status: 'retired', lastActivitySec: 50000 },
        ],
      },
    ]
    const out = toPrometheus(projects, 'aid')
    assert.ok(!out.includes(' 1\n'), 'no participant should emit 1 for retired project')
    for (const role of ['hierophant', 'mage', 'minion']) {
      assert.ok(out.includes(`status="retired"} 0`), `${role} retired should emit 0`)
    }
  })

  it('sanitizes project names with hyphens', () => {
    const projects = [
      {
        project: 'grim-npc',
        roadmapOpen: 0,
        retired: true,
        participants: [
          { role: 'minion', status: 'retired', lastActivitySec: 100 },
        ],
      },
    ]
    const out = toPrometheus(projects, 'aid')
    assert.ok(out.includes('project="grim_npc"'), 'hyphen should be sanitized to underscore')
    assert.ok(!out.includes('project="grim-npc"'), 'hyphen should not appear in label')
  })

  it('exports toPrometheus', () => {
    assert.ok(typeof toPrometheus === 'function', 'toPrometheus should be exported')
  })
})

describe('hmm: projectStatus detail fields (phase 63)', () => {
  it('adds livePhase, latestState, lastActivitySec, conversingPair to the project object', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-detail', 1)
      const t1 = ago(120)
      const t2 = ago(60)
      writeThread(mmDir, 1, 'mage', 'minion', 63, 'brief', t1)
      writeThread(mmDir, 2, 'minion', 'mage', 63, 'report', t2)
      const projects = scanProjects(tmp)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      assert.equal(ps.livePhase, '63')
      assert.equal(ps.latestState, 'report')
      assert.ok(typeof ps.lastActivitySec === 'number')
      assert.deepEqual(ps.conversingPair, ['minion', 'mage'], 'alternating pair within ACTIVE_SEC')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('conversingPair is null when not conversing', () => {
    const tmp = fs.mkdtempSync('/tmp/hmm-test-')
    try {
      const mmDir = mkProject(tmp, 'proj-noconv', 1)
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', ago(60))
      const projects = scanProjects(tmp)
      const ps = projectStatus(projects[0], Math.floor(Date.now() / 1000))
      assert.equal(ps.conversingPair, null)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('exports STATUSES covering the full state machine', () => {
    assert.ok(Array.isArray(STATUSES))
    for (const s of ['working', 'conversing', 'waiting-on-user', 'waiting', 'sleeping', 'retired']) {
      assert.ok(STATUSES.includes(s), `STATUSES should include ${s}`)
    }
  })
})

describe('hmm: guild-hall viewer status→anim map (phase 63)', () => {
  it('defines an animation key for every status the state machine can emit', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'guild-hall.html'), 'utf8')
    const m = /STATUS_ANIM\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(html)
    assert.ok(m, 'guild-hall.html should define a STATUS_ANIM map')
    for (const s of STATUSES) {
      const key = /^[a-zA-Z]+$/.test(s) ? s : `'${s}'`
      assert.ok(
        m[1].includes(`${s}:`) || m[1].includes(`'${s}':`) || m[1].includes(`"${s}":`),
        `STATUS_ANIM should map status "${s}"`
      )
    }
  })
})

describe('hmm: /api/hmm/:host/:project detail lookup (phase 63)', () => {
  const { pickProjectDetail } = require('../bin/grim-server.js')

  it('returns the merged host+project detail object when found', () => {
    const fleet = {
      boxes: [{
        host: 'aid',
        up: true,
        projects: [{ project: 'grimoire', roadmapOpen: 1, retired: false, participants: [] }],
      }],
    }
    const detail = pickProjectDetail(fleet, 'aid', 'grimoire')
    assert.equal(detail.host, 'aid')
    assert.equal(detail.project, 'grimoire')
    assert.equal(detail.roadmapOpen, 1)
  })

  it('returns null when the host is down', () => {
    const fleet = { boxes: [{ host: 'aid', up: false, projects: [] }] }
    assert.equal(pickProjectDetail(fleet, 'aid', 'grimoire'), null)
  })

  it('returns null when the project is not found on an up host', () => {
    const fleet = { boxes: [{ host: 'aid', up: true, projects: [] }] }
    assert.equal(pickProjectDetail(fleet, 'aid', 'nope'), null)
  })

  it('returns null when the host is not in the fleet at all', () => {
    const fleet = { boxes: [] }
    assert.equal(pickProjectDetail(fleet, 'ghost', 'grimoire'), null)
  })
})

describe('hmm: guild-hall viewer is self-contained (phase 63)', () => {
  it('has no external/CDN script or link src', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'guild-hall.html'), 'utf8')
    const srcs = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m => m[1])
    for (const s of srcs) {
      assert.ok(!/^https?:\/\//.test(s), `no external src/href: ${s}`)
    }
  })

  it('only fetches same-origin /api/hmm* endpoints', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'guild-hall.html'), 'utf8')
    const fetches = [...html.matchAll(/fetch\(['"`]([^'"`]+)['"`]/g)].map(m => m[1])
    const sources = [...html.matchAll(/new EventSource\(['"`]([^'"`]+)['"`]/g)].map(m => m[1])
    for (const url of [...fetches, ...sources]) {
      assert.ok(url.startsWith('/api/hmm'), `unexpected fetch/EventSource target: ${url}`)
    }
  })
})
