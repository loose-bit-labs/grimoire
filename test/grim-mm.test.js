'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const { readThread, parseHeader } = require('../bin/grim-mm')

// ── helpers ──────────────────────────────────────────────────────────────────

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grim-mm-test-'))
}

function writeMsg(dir, num, role, phase, state, body) {
  fs.mkdirSync(dir, { recursive: true })
  const file = `${String(num).padStart(4, '0')}-${role}.md`
  fs.writeFileSync(path.join(dir, file), `phase: ${phase} · state: ${state}\n\n${body}\n`, 'utf8')
}

function writeThread(dir, entries) {
  // entries: [{ num, role, phase, state, body }]
  for (const e of entries) {
    writeMsg(dir, e.num, e.role, e.phase, e.state, e.body || '')
  }
}

// ── archive --from/--to/--out ────────────────────────────────────────────────

describe('archive --from/--to/--out', () => {
  it('extracts messages by number range regardless of header phase', () => {
    const tmp = mktmp()
    const reviews = path.join(tmp, 'plans', 'reviews')
    try {
      // Init git repo so archive's commit succeeds
      const { execFileSync } = require('node:child_process')
      execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmp, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp, stdio: 'ignore' })

      writeThread(path.join(tmp, '.mm'), [
        { num: 1, role: 'mage', phase: '9', state: 'brief', body: 'old phase 9' },
        { num: 2, role: 'minion', phase: '9', state: 'report', body: 'minion report' },
        { num: 3, role: 'mage', phase: '9', state: 'accepted', body: 'phase 9 accepted' },
        { num: 4, role: 'mage', phase: '10', state: 'brief', body: 'phase 10 brief' },
        { num: 5, role: 'minion', phase: '10', state: 'report', body: 'minion phase 10' },
        { num: 6, role: 'mage', phase: '10', state: 'accepted', body: 'phase 10 accepted' },
      ])

      // Archive messages 2–3: should get minion report + accepted
      // even though #2 and #3 have phase: 9 headers (proves range-based not phase-based)
      const { archive } = require('../bin/grim-mm')
      archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: null, from: 2, to: 3, out: 'phase-10', forceOverwrite: false })

      const content = fs.readFileSync(path.join(reviews, 'phase-10.md'), 'utf8')
      assert.ok(content.includes('## 0002-minion'))
      assert.ok(content.includes('## 0003-mage'))
      assert.ok(content.includes('minion report'))
      assert.ok(content.includes('phase 9 accepted'))
      // Should NOT include #1, #4, or #5
      assert.ok(!content.includes('## 0001-mage'))
      assert.ok(!content.includes('## 0004-mage'))
      assert.ok(!content.includes('## 0005-minion'))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses when last message in range is not terminal', () => {
    const tmp = mktmp()
    try {
      writeThread(path.join(tmp, '.mm'), [
        { num: 1, role: 'mage', phase: '1', state: 'brief', body: 'brief' },
        { num: 2, role: 'minion', phase: '1', state: 'report', body: 'report' },
      ])

      const { archive } = require('../bin/grim-mm')
      assert.throws(
        () => archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: null, from: 1, to: 2, out: 'test', forceOverwrite: false }),
        /not accepted/
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses when --phase and --from/--to/--out are mixed', () => {
    const tmp = mktmp()
    try {
      writeThread(path.join(tmp, '.mm'), [
        { num: 1, role: 'mage', phase: '1', state: 'accepted', body: 'accepted' },
      ])

      const { archive } = require('../bin/grim-mm')
      // --phase + --from
      assert.throws(
        () => archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: 1, from: 1, to: 1, out: 'test', forceOverwrite: false }),
        /mutually exclusive/
      )
      // --phase + --to
      assert.throws(
        () => archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: 1, to: 1, out: 'test', forceOverwrite: false }),
        /mutually exclusive/
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses when range flags are incomplete', () => {
    const tmp = mktmp()
    try {
      writeThread(path.join(tmp, '.mm'), [
        { num: 1, role: 'mage', phase: '1', state: 'accepted', body: 'accepted' },
      ])

      const { archive } = require('../bin/grim-mm')
      // --from without --to or --out
      assert.throws(
        () => archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: null, from: 1, to: null, out: null, forceOverwrite: false }),
        /required together/
      )
      // --to without --from or --out
      assert.throws(
        () => archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: null, from: null, to: 1, out: null, forceOverwrite: false }),
        /required together/
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('existing --phase-based archive still works unchanged', () => {
    const tmp = mktmp()
    const reviews = path.join(tmp, 'plans', 'reviews')
    try {
      // Init git repo so archive's commit succeeds
      const { execFileSync } = require('node:child_process')
      execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmp, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp, stdio: 'ignore' })

      writeThread(path.join(tmp, '.mm'), [
        { num: 1, role: 'mage', phase: '5', state: 'brief', body: 'brief' },
        { num: 2, role: 'minion', phase: '5', state: 'report', body: 'report' },
        { num: 3, role: 'mage', phase: '5', state: 'accepted', body: 'accepted' },
      ])

      const { archive } = require('../bin/grim-mm')
      archive({ cwd: tmp, dir: path.join(tmp, '.mm'), phase: 5, forceOverwrite: false })

      const content = fs.readFileSync(path.join(reviews, 'phase-5.md'), 'utf8')
      assert.ok(content.includes('## 0001-mage'))
      assert.ok(content.includes('## 0002-minion'))
      assert.ok(content.includes('## 0003-mage'))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── write --state brief requires --phase ─────────────────────────────────────

describe('write --state brief requires --phase', () => {
  it('refuses --state brief without --phase', () => {
    const tmp = mktmp()
    try {
      fs.mkdirSync(path.join(tmp, '.mm'), { recursive: true })
      const { write } = require('../bin/grim-mm')
      assert.throws(
        () => write({ dir: path.join(tmp, '.mm'), role: 'mage', state: 'brief', phase: null, body: 'test', force: false, json: false }),
        /--state brief requires an explicit --phase/
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('allows --state brief with explicit --phase', () => {
    const tmp = mktmp()
    try {
      fs.mkdirSync(path.join(tmp, '.mm'), { recursive: true })
      const { write } = require('../bin/grim-mm')
      // Should not throw
      write({ dir: path.join(tmp, '.mm'), role: 'mage', state: 'brief', phase: 3, body: 'new phase', force: false, json: false })

      // Verify the file was created with the right header
      const files = fs.readdirSync(path.join(tmp, '.mm'))
      assert.strictEqual(files.length, 1)
      const content = fs.readFileSync(path.join(tmp, '.mm', files[0]), 'utf8')
      assert.ok(content.startsWith('phase: 3 · state: brief'))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('other states do not require --phase', () => {
    const tmp = mktmp()
    try {
      fs.mkdirSync(path.join(tmp, '.mm'), { recursive: true })
      const { write } = require('../bin/grim-mm')
      // report, revise, etc. should work without --phase
      write({ dir: path.join(tmp, '.mm'), role: 'minion', state: 'report', phase: null, body: 'report body', force: false, json: false })

      const files = fs.readdirSync(path.join(tmp, '.mm'))
      assert.strictEqual(files.length, 1)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
