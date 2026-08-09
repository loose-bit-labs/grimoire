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

const { scanProjects, projectStatus, ACTIVE_SEC, IDLE_SEC } = require('../lib/hmm')

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
      const t = ago(IDLE_SEC + 60) // > 20 min ago
      writeThread(mmDir, 1, 'mage', 'minion', 1, 'brief', t)
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
})
