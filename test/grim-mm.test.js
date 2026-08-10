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
      assert.ok(content.includes('phase: 3'), 'should contain phase: 3')
      assert.ok(content.includes('state: brief'), 'should contain state: brief')
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

// ── resolveRecipients: default --to to the pact counterpart, refuse self-send ──

describe('resolveRecipients', () => {
  const { resolveRecipients } = require('../bin/grim-mm')

  it('mage defaults to minion',        () => assert.deepEqual(resolveRecipients('mage', undefined), ['minion']))
  it('minion defaults to mage',        () => assert.deepEqual(resolveRecipients('minion', undefined), ['mage']))
  it('hierophant defaults to mage',    () => assert.deepEqual(resolveRecipients('hierophant', undefined), ['mage']))

  it('explicit --to overrides the default', () => assert.deepEqual(resolveRecipients('mage', 'hierophant'), ['hierophant']))
  it('honors a broadcast --to',              () => assert.deepEqual(resolveRecipients('mage', 'minion,hierophant'), ['minion', 'hierophant']))

  it('refuses a self-addressed message (the from-mage-to-mage bug)',
    () => assert.throws(() => resolveRecipients('mage', 'mage'), /self-addressed/))
  it('refuses self even inside a broadcast list',
    () => assert.throws(() => resolveRecipients('mage', 'minion,mage'), /self-addressed/))
})

// ── write() stamps the counterpart into the filename when --to is omitted ──────

describe('write default recipient → filename', () => {
  it('mage with no --to writes from-mage-to-minion, not from-mage-to-mage', () => {
    const tmp = mktmp()
    try {
      fs.mkdirSync(path.join(tmp, '.mm'), { recursive: true })
      const { write } = require('../bin/grim-mm')
      write({ dir: path.join(tmp, '.mm'), role: 'mage', state: 'brief', phase: 1, body: 'x', force: false, json: false })
      const files = fs.readdirSync(path.join(tmp, '.mm'))
      assert.ok(files[0].endsWith('-from-mage-to-minion.md'), `got ${files[0]}`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── assertRealIdentity ────────────────────────────────────────────────────────

describe('assertRealIdentity', () => {
  const { assertRealIdentity, isPlaceholderIdentity } = require('../bin/grim-mm')
  const { execFileSync } = require('node:child_process')

  function mkrepo(identity) {
    const tmp = mktmp()
    execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
    // Init with a valid identity so the repo has a commit, then overwrite
    // with the test identity — that way git is happy but assertRealIdentity
    // sees the placeholder we want to test.
    execFileSync('git', ['config', 'user.name',  'Init'], { cwd: tmp, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'init@init.com'], { cwd: tmp, stdio: 'ignore' })
    fs.writeFileSync(path.join(tmp, 'README.md'), '# test\n')
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmp, stdio: 'ignore' })
    // Overwrite with test identity
    if (identity.name !== null) execFileSync('git', ['config', 'user.name',  identity.name],  { cwd: tmp, stdio: 'ignore' })
    if (identity.email !== null) execFileSync('git', ['config', 'user.email', identity.email], { cwd: tmp, stdio: 'ignore' })
    return tmp
  }

  it('throws for T <t@t>', () => {
    const tmp = mkrepo({ name: 'T', email: 't@t' })
    try { assert.throws(() => assertRealIdentity(tmp), /placeholder/) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('throws for empty name/email', () => {
    const tmp = mkrepo({ name: '', email: 'x@y.z' })
    try { assert.throws(() => assertRealIdentity(tmp), /placeholder/) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('throws for single-char name', () => {
    const tmp = mkrepo({ name: 'a', email: 'a@a.com' })
    try { assert.throws(() => assertRealIdentity(tmp), /placeholder/) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('throws for test@test', () => {
    const tmp = mkrepo({ name: 'Test', email: 'test@test' })
    try { assert.throws(() => assertRealIdentity(tmp), /placeholder/) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('throws for a@a', () => {
    const tmp = mkrepo({ name: 'A', email: 'a@a' })
    try { assert.throws(() => assertRealIdentity(tmp), /placeholder/) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('throws for x@localhost', () => {
    const tmp = mkrepo({ name: 'X', email: 'x@localhost' })
    try { assert.throws(() => assertRealIdentity(tmp), /placeholder/) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('passes for Val GvM <luckybit4755+lbl@gmail.com>', () => {
    const tmp = mkrepo({ name: 'Val GvM', email: 'luckybit4755+lbl@gmail.com' })
    try { assert.doesNotThrow(() => assertRealIdentity(tmp)) }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

// ── grim mm commit ────────────────────────────────────────────────────────────

describe('grim mm commit', () => {
  const { cmdCommit } = require('../bin/grim-mm')
  const { execFileSync } = require('node:child_process')

  function mkrepo(identity) {
    const tmp = mktmp()
    execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name',  identity.name],  { cwd: tmp, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', identity.email], { cwd: tmp, stdio: 'ignore' })
    fs.writeFileSync(path.join(tmp, 'README.md'), '# test\n')
    execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmp, stdio: 'ignore' })
    return tmp
  }

  it('refuses with placeholder identity — no commit created', () => {
    const tmp = mkrepo({ name: 'T', email: 't@t' })
    const target = path.join(tmp, 'README.md')
    fs.writeFileSync(target, '# updated\n')
    try {
      assert.throws(() => cmdCommit({ cwd: tmp, phase: 1, files: ['README.md'], message: 'test' }), /placeholder/)
      const log = execFileSync('git', ['log', '--oneline'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n')
      assert.strictEqual(log.length, 1, 'should not create a commit under placeholder identity')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('commits only the specified file, leaves unrelated changes untouched', () => {
    const tmp = mkrepo({ name: 'Val GvM', email: 'luckybit4755+lbl@gmail.com' })
    const target = path.join(tmp, 'README.md')
    const other  = path.join(tmp, 'other.md')
    fs.writeFileSync(target, '# updated\n')
    fs.writeFileSync(other, '# scratch\n') // untracked, should NOT be staged
    try {
      cmdCommit({ cwd: tmp, phase: 1, files: ['README.md'], message: 'phase 1: test' })
      const log = execFileSync('git', ['log', '--oneline'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n')
      assert.ok(log[0].includes('phase 1: test'), `expected phase message, got: ${log[0]}`)
      // other.md should still be untracked
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: tmp, encoding: 'utf8' }).trim()
      assert.ok(status.includes('other.md'), `other.md should remain untracked, got: ${status}`)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('refuses with no --files', () => {
    const tmp = mkrepo({ name: 'Val GvM', email: 'luckybit4755+lbl@gmail.com' })
    try {
      assert.throws(() => cmdCommit({ cwd: tmp, phase: 1, files: [], message: 'x' }), /--files is required/)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('refuses with non-existent path', () => {
    const tmp = mkrepo({ name: 'Val GvM', email: 'luckybit4755+lbl@gmail.com' })
    try {
      assert.throws(() => cmdCommit({ cwd: tmp, phase: 1, files: ['no-such-file.md'], message: 'x' }), /file not found/)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('refuses when file has no changes', () => {
    const tmp = mkrepo({ name: 'Val GvM', email: 'luckybit4755+lbl@gmail.com' })
    try {
      assert.throws(() => cmdCommit({ cwd: tmp, phase: 1, files: ['README.md'], message: 'x' }), /no changes/)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

// ── drive identity guard must be reachable (regression: circular-dep undefined) ──
// grim-mm.js requires grim-mm-drive.js at its top, before its own module.exports.
// If drive destructures assertRealIdentity at load, it captures `undefined` and the
// drive ACT preflight dies with "not a function" — the guard is dead exactly in the
// autonomous-loop commit path. Node flags this precise bug with a circular-dep warning.
describe('drive identity guard reachability', () => {
  const { spawnSync } = require('node:child_process')
  it('loading grim-mm then grim-mm-drive emits NO circular-dependency warning', () => {
    const repo = path.join(__dirname, '..')
    const r = spawnSync(process.execPath,
      ['-e', "require('./bin/grim-mm.js'); require('./bin/grim-mm-drive.js')"],
      { cwd: repo, encoding: 'utf8' })
    assert.ok(!/circular dependency/i.test(r.stderr || ''),
      'circular-dep warning present — drive guard would be undefined:\n' + r.stderr)
  })
})

// --session defaults to CLAUDE_CODE_SESSION_ID so callers don't spell it every
// time (token waste). stampRole writes .mm/.role-<session> — a clean probe for
// which session id actually flowed through.
describe('--session defaults to CLAUDE_CODE_SESSION_ID', () => {
  const { execFileSync } = require('node:child_process')
  const mmBin = path.join(__dirname, '..', 'bin', 'grim-mm.js')

  function readInTmp(env) {
    const tmp = mktmp()
    execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
    execFileSync(process.execPath, [mmBin, 'read', '--role', 'hierophant'],
      { cwd: tmp, stdio: 'ignore', env: { ...process.env, ...env } })
    return tmp
  }

  it('uses the env session when --session is omitted', () => {
    const tmp = readInTmp({ CLAUDE_CODE_SESSION_ID: 'env-sess-abc' })
    try { assert.ok(fs.existsSync(path.join(tmp, '.mm', '.role-env-sess-abc')),
      'role marker should carry the ambient session id') }
    finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('explicit --session still wins over the env', () => {
    const tmp = mktmp()
    execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' })
    execFileSync(process.execPath, [mmBin, 'read', '--role', 'hierophant', '--session', 'explicit-xyz'],
      { cwd: tmp, stdio: 'ignore', env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'env-sess-abc' } })
    try {
      assert.ok(fs.existsSync(path.join(tmp, '.mm', '.role-explicit-xyz')), 'explicit session should win')
      assert.ok(!fs.existsSync(path.join(tmp, '.mm', '.role-env-sess-abc')), 'env must not override explicit')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})
