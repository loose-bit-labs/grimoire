#!/usr/bin/env node
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Create a temporary thread directory for fixture tests
function createFixtureThread(messages) {
  const dir = path.join(__dirname, '..', '.mm-test-fixture')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const msg of messages) {
    const num = String(msg.num).padStart(4, '0')
    const header = `phase: ${msg.phase} · state: ${msg.state}`
    const scopeLine = msg.scope ? `scope: ${msg.scope}` : ''
    const content = `${header}\n${scopeLine}\n${msg.body}\n`
    fs.writeFileSync(path.join(dir, `${num}-${msg.role}.md`), content, 'utf8')
  }
  return dir
}

function cleanupFixture() {
  const dir = path.join(__dirname, '..', '.mm-test-fixture')
  fs.rmSync(dir, { recursive: true, force: true })
}

function runNext(dir, extraArgs = []) {
  const repoRoot = path.join(__dirname, '..')
  const result = spawnSync(
    process.execPath,
    ['bin/grim-mm.js', 'next', '--dir', dir, '--role', 'mage', '--session', 'test-session', ...extraArgs],
    { cwd: repoRoot, encoding: 'utf8', timeout: 10000 }
  )
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  }
}

function runNextJson(dir, extraArgs = []) {
  const repoRoot = path.join(__dirname, '..')
  const result = spawnSync(
    process.execPath,
    ['bin/grim-mm.js', 'next', '--dir', dir, '--role', 'mage', '--session', 'test-session', '--json', ...extraArgs],
    { cwd: repoRoot, encoding: 'utf8', timeout: 10000 }
  )
  return JSON.parse(result.stdout || '{}')
}

// ── ACT: minion reported, mage should act ────────────────────────────────────

test('ACT — minion reported, mage should act', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
  ])
  try {
    const out = runNext(dir)
    assert.strictEqual(out.status, 0, 'exit code should be 0 for ACT')
    assert.ok(out.stdout.includes('ACT'), 'should print ACT')
  } finally {
    cleanupFixture()
  }
})

// ── WAIT: mage's own message is latest ───────────────────────────────────────

test('WAIT — mage waiting on minion', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'revise', body: 'Fix this' },
  ])
  try {
    const out = runNext(dir)
    assert.strictEqual(out.status, 3, 'exit code should be 3 for WAIT')
    assert.ok(out.stdout.includes('WAIT'), 'should print WAIT')
  } finally {
    cleanupFixture()
  }
})

// ── HALT deadlock: ≥3 revise messages ────────────────────────────────────────

test('HALT deadlock — 3 revise messages on phase', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'revise', body: 'Fix 1' },
    { num: 4, role: 'minion', phase: '5', state: 'report', body: 'Fixed 1' },
    { num: 5, role: 'mage', phase: '5', state: 'revise', body: 'Fix 2' },
    { num: 6, role: 'minion', phase: '5', state: 'report', body: 'Fixed 2' },
    { num: 7, role: 'mage', phase: '5', state: 'revise', body: 'Fix 3' },
  ])
  try {
    const out = runNext(dir)
    assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT')
    assert.ok(out.stdout.includes('HALT deadlock'), 'should print HALT deadlock')
  } finally {
    cleanupFixture()
  }
})

// ── HALT decision: escalate with scope:product ───────────────────────────────

test('HALT decision — escalate with scope:product', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'escalate', scope: 'product', body: 'Need decision' },
  ])
  try {
    const out = runNext(dir)
    assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT')
    assert.ok(out.stdout.includes('HALT decision'), 'should print HALT decision')
  } finally {
    cleanupFixture()
  }
})

// ── ACT: escalate with scope:architecture → route to hierophant ──────────────

test('ACT — escalate with scope:architecture routes to hierophant', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'escalate', scope: 'architecture', body: 'Architecture question' },
  ])
  try {
    const out = runNext(dir)
    assert.strictEqual(out.status, 0, 'exit code should be 0 (ACT) for architecture escalate')
    assert.ok(out.stdout.includes('ACT'), 'should print ACT (not HALT)')
  } finally {
    cleanupFixture()
  }
})

// ── HALT roadmap-empty: accepted, no queued phases ───────────────────────────

test('HALT roadmap-empty — accepted with no queued phases', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'accepted', body: 'Accepted' },
  ])
  try {
    // Temporarily remove all non-accepted phases from ROADMAP.md
    const roadmapPath = path.join(__dirname, '..', 'plans', 'ROADMAP.md')
    const original = fs.readFileSync(roadmapPath, 'utf8')
    // Mark all non-accepted phases as accepted by replacing queued/blocked with ✅ accepted
    // Use a line-level approach to avoid issues with | in descriptions
    const patched = original.split('\n').map(line => {
      const match = /^\| (\d+) \| plans\/phase-\d+\.md/.exec(line)
      if (match && (line.includes('queued') || line.includes('blocked') || line.includes('reserved')) && !line.includes('✅ accepted')) {
        return line.replace(/(queued|blocked|reserved)/i, '✅ accepted')
      }
      return line
    }).join('\n')
    fs.writeFileSync(roadmapPath, patched, 'utf8')
    try {
      const out = runNext(dir)
      assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT')
      assert.ok(out.stdout.includes('HALT roadmap-empty'), 'should print HALT roadmap-empty')
    } finally {
      fs.writeFileSync(roadmapPath, original, 'utf8')
    }
  } finally {
    cleanupFixture()
  }
})

// ── --json output shape ──────────────────────────────────────────────────────

test('--json ACT output shape', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
  ])
  try {
    const data = runNextJson(dir)
    assert.strictEqual(data.verdict, 'ACT')
    assert.ok(typeof data.phase === 'string')
    assert.ok(typeof data.state === 'string')
  } finally {
    cleanupFixture()
  }
})

test('--json HALT deadlock output shape', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'revise', body: 'Fix 1' },
    { num: 4, role: 'minion', phase: '5', state: 'report', body: 'Fixed 1' },
    { num: 5, role: 'mage', phase: '5', state: 'revise', body: 'Fix 2' },
    { num: 6, role: 'minion', phase: '5', state: 'report', body: 'Fixed 2' },
    { num: 7, role: 'mage', phase: '5', state: 'revise', body: 'Fix 3' },
  ])
  try {
    const data = runNextJson(dir)
    assert.strictEqual(data.verdict, 'HALT')
    assert.strictEqual(data.reason, 'deadlock')
    assert.ok(data.command && data.command.includes('grim mm read'))
  } finally {
    cleanupFixture()
  }
})
