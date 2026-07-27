#!/usr/bin/env node
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// ── helpers ──────────────────────────────────────────────────────────────────

function createFixtureThread(messages) {
  const dir = path.join(__dirname, '..', '.mm-test-fixture-drive')
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
  const dir = path.join(__dirname, '..', '.mm-test-fixture-drive')
  fs.rmSync(dir, { recursive: true, force: true })
}

function runDrive(dir, role, extraArgs = []) {
  const repoRoot = path.join(__dirname, '..')
  const result = spawnSync(
    process.execPath,
    ['bin/grim-mm-drive.js', '--role', role, '--session', 'test-session', '--dir', dir, ...extraArgs],
    { cwd: repoRoot, encoding: 'utf8', timeout: 10000 }
  )
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  }
}

// ── ACT: minion reported, mage should act ────────────────────────────────────

test('ACT — prints DRIVE: ACT line, exit 0', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
  ])
  try {
    const out = runDrive(dir, 'mage')
    assert.strictEqual(out.status, 0, 'exit code should be 0 for ACT')
    assert.ok(out.stdout.includes('DRIVE: ACT'), 'should print DRIVE: ACT')
  } finally {
    cleanupFixture()
  }
})

// ── WAIT: mage's own message is latest ───────────────────────────────────────

test('WAIT — prints DRIVE: WAIT line, exit 3', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'revise', body: 'Fix this' },
  ])
  try {
    const out = runDrive(dir, 'mage')
    assert.strictEqual(out.status, 3, 'exit code should be 3 for WAIT')
    assert.ok(out.stdout.includes('DRIVE: WAIT'), 'should print DRIVE: WAIT')
  } finally {
    cleanupFixture()
  }
})

// ── HALT deadlock: ≥3 revise messages ────────────────────────────────────────

test('HALT deadlock — prints DRIVE: HALT line, exit 4', () => {
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
    const out = runDrive(dir, 'mage')
    assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT')
    assert.ok(out.stdout.includes('DRIVE: HALT'), 'should print DRIVE: HALT')
    assert.ok(out.stdout.includes('deadlock'), 'should mention deadlock')
  } finally {
    cleanupFixture()
  }
})

// ── HALT budget: --budget-exceeded flag ───────────────────────────────────────

test('HALT budget — --budget-exceeded flag, exit 4', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
  ])
  try {
    const out = runDrive(dir, 'mage', ['--budget-exceeded'])
    assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT budget')
    assert.ok(out.stdout.includes('DRIVE: HALT'), 'should print DRIVE: HALT')
    assert.ok(out.stdout.includes('budget'), 'should mention budget')
  } finally {
    cleanupFixture()
  }
})

// ── HALT roadmap-empty: accepted, no queued phases ───────────────────────────

test('HALT roadmap-empty — prints DRIVE: HALT, exit 4', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
    { num: 3, role: 'mage', phase: '5', state: 'accepted', body: 'Accepted' },
  ])
  try {
    // Patch ROADMAP.md to remove all queued phases
    const roadmapPath = path.join(__dirname, '..', 'plans', 'ROADMAP.md')
    const original = fs.readFileSync(roadmapPath, 'utf8')
    const patched = original.split('\n').map(line => {
      const match = /^\| (\d+) \| plans\/phase-\d+\.md/.exec(line)
      if (match && (line.includes('queued') || line.includes('blocked')) && !line.includes('✅ accepted')) {
        return line.replace(/(queued|blocked)/i, '✅ accepted')
      }
      return line
    }).join('\n')
    fs.writeFileSync(roadmapPath, patched, 'utf8')
    try {
      const out = runDrive(dir, 'mage')
      assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT')
      assert.ok(out.stdout.includes('DRIVE: HALT'), 'should print DRIVE: HALT')
      assert.ok(out.stdout.includes('roadmap-empty'), 'should mention roadmap-empty')
    } finally {
      fs.writeFileSync(roadmapPath, original, 'utf8')
    }
  } finally {
    cleanupFixture()
  }
})

// ── --budget-tokens 0 triggers budget HALT ───────────────────────────────────

test('HALT budget — --budget-tokens 0 triggers budget HALT', () => {
  const dir = createFixtureThread([
    { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'Phase 5 brief' },
    { num: 2, role: 'minion', phase: '5', state: 'report', body: 'Phase 5 done' },
  ])
  try {
    const out = runDrive(dir, 'mage', ['--budget-tokens', '0'])
    assert.strictEqual(out.status, 4, 'exit code should be 4 for HALT budget')
    assert.ok(out.stdout.includes('DRIVE: HALT'), 'should print DRIVE: HALT')
    assert.ok(out.stdout.includes('budget'), 'should mention budget')
  } finally {
    cleanupFixture()
  }
})

// ── re-entry command present on HALT ─────────────────────────────────────────

test('HALT — re-entry command in output', () => {
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
    const out = runDrive(dir, 'mage')
    assert.ok(out.stdout.includes('Re-entry:'), 'should print re-entry command')
    assert.ok(out.stdout.includes('grim mm read'), 're-entry should reference grim mm read')
  } finally {
    cleanupFixture()
  }
})
