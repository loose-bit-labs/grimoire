'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const fs     = require('node:fs')
const path   = require('node:path')
const { execSync } = require('node:child_process')

// ── fixtures ──────────────────────────────────────────────────────────────────

/**
 * Create a temporary git repo with a fake KB entity file, set GRIMOIRE_ROOT
 * so grim-librarian.js treats it as the KB, and restore on cleanup.
 * Also creates a local bare "origin" remote so git push succeeds in tests.
 */
function _mkFixture() {
  const tmp = fs.mkdtempSync('/tmp/grim-librarian-test-')
  const bare = fs.mkdtempSync('/tmp/grim-librarian-bare-')
  execSync('git init --bare', { cwd: bare, stdio: 'pipe' })
  execSync('git init',            { cwd: tmp, stdio: 'pipe' })
  execSync('git config user.email "test@test"', { cwd: tmp, stdio: 'pipe' })
  execSync('git config user.name  "Test"',       { cwd: tmp, stdio: 'pipe' })
  // Create an initial commit so the repo is valid
  const entitiesDir = path.join(tmp, 'entities')
  fs.mkdirSync(entitiesDir, { recursive: true })
  fs.writeFileSync(path.join(tmp, 'README.md'), '# KB\n')
  fs.writeFileSync(
    path.join(entitiesDir, 'test-entity.json'),
    JSON.stringify({ '@type': 'DefinedTerm', '@id': 'test_entity', name: 'Test', description: 'test' })
  )
  execSync('git add -A && git commit -m "init"', { cwd: tmp, stdio: 'pipe' })
  execSync(`git remote add origin "${bare}"`, { cwd: tmp, stdio: 'pipe' })
  execSync('git push -u origin main', { cwd: tmp, stdio: 'pipe' })
  return { tmp, bare }
}

describe('grim librarian commit', () => {
  let origRoot
  let tmpDir
  let bareDir

  before(() => { origRoot = process.env.GRIMOIRE_ROOT })
  after(()  => {
    if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
    else process.env.GRIMOIRE_ROOT = origRoot
  })

  it('exits 0 with no changes (clean KB)', () => {
    const fix = _mkFixture()
    tmpDir = fix.tmp; bareDir = fix.bare
    process.env.GRIMOIRE_ROOT = tmpDir
    const r = execSync('node bin/grim-librarian.js commit', {
      cwd: '/mnt/eighty/userspace/vgvm/src/me/grimoire',
      encoding: 'utf8',
      stdio: 'pipe',
    })
    assert.equal(r.trim(), '')
    // No additional commit created — only the fixture commits exist
    const log = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf8' }).trim().split('\n')
    assert.ok(log[0].includes('init'), 'should not create a librarian commit when KB is clean')
  })

  it('commits new entity files and reports count', () => {
    const fix = _mkFixture()
    tmpDir = fix.tmp; bareDir = fix.bare
    process.env.GRIMOIRE_ROOT = tmpDir
    // Add a new entity file (untracked)
    const entitiesDir = path.join(tmpDir, 'entities')
    fs.writeFileSync(
      path.join(entitiesDir, 'new-entity.json'),
      JSON.stringify({ '@type': 'DefinedTerm', '@id': 'new_entity', name: 'New', description: 'new' })
    )
    const r = execSync('node bin/grim-librarian.js commit', {
      cwd: '/mnt/eighty/userspace/vgvm/src/me/grimoire',
      encoding: 'utf8',
      stdio: 'pipe',
    })
    assert.ok(r.includes('1 new'), `expected "1 new" in output, got: ${r}`)
    const log = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf8' }).trim().split('\n')
    assert.ok(log[0].includes('kb:'), `expected librarian commit message, got: ${log[0]}`)
  })

  it('commits updated entity files and reports count', () => {
    const fix = _mkFixture()
    tmpDir = fix.tmp; bareDir = fix.bare
    process.env.GRIMOIRE_ROOT = tmpDir
    // Modify an existing entity file
    const entitiesDir = path.join(tmpDir, 'entities')
    const existing = JSON.parse(fs.readFileSync(path.join(entitiesDir, 'test-entity.json'), 'utf8'))
    existing.description = 'updated'
    fs.writeFileSync(path.join(entitiesDir, 'test-entity.json'), JSON.stringify(existing))
    const r = execSync('node bin/grim-librarian.js commit', {
      cwd: '/mnt/eighty/userspace/vgvm/src/me/grimoire',
      encoding: 'utf8',
      stdio: 'pipe',
    })
    assert.ok(r.includes('1 updated'), `expected "1 updated" in output, got: ${r}`)
    const log = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf8' }).trim().split('\n')
    assert.ok(log[0].includes('kb:'), `expected librarian commit message, got: ${log[0]}`)
  })

  it('commits mixed new + updated and reports both counts', () => {
    const fix = _mkFixture()
    tmpDir = fix.tmp; bareDir = fix.bare
    process.env.GRIMOIRE_ROOT = tmpDir
    const entitiesDir = path.join(tmpDir, 'entities')
    // Add new
    fs.writeFileSync(
      path.join(entitiesDir, 'new-entity.json'),
      JSON.stringify({ '@type': 'DefinedTerm', '@id': 'new2', name: 'New2', description: 'new2' })
    )
    // Update existing
    const existing = JSON.parse(fs.readFileSync(path.join(entitiesDir, 'test-entity.json'), 'utf8'))
    existing.description = 'updated again'
    fs.writeFileSync(path.join(entitiesDir, 'test-entity.json'), JSON.stringify(existing))
    const r = execSync('node bin/grim-librarian.js commit', {
      cwd: '/mnt/eighty/userspace/vgvm/src/me/grimoire',
      encoding: 'utf8',
      stdio: 'pipe',
    })
    assert.ok(r.includes('1 new'), `expected "1 new" in output, got: ${r}`)
    assert.ok(r.includes('1 updated'), `expected "1 updated" in output, got: ${r}`)
  })

  it('exits 2 on push failure (local commit kept)', () => {
    const fix = _mkFixture()
    tmpDir = fix.tmp; bareDir = fix.bare
    process.env.GRIMOIRE_ROOT = tmpDir
    // Add a new file so there's something to commit
    const entitiesDir = path.join(tmpDir, 'entities')
    fs.writeFileSync(
      path.join(entitiesDir, 'new-entity.json'),
      JSON.stringify({ '@type': 'DefinedTerm', '@id': 'new3', name: 'New3', description: 'new3' })
    )
    // Remove the remote so push fails
    try { execSync('git remote remove origin', { cwd: tmpDir, stdio: 'pipe' }) } catch {}
    let exitCode = null
    try {
      execSync('node bin/grim-librarian.js commit', {
        cwd: '/mnt/eighty/userspace/vgvm/src/me/grimoire',
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, GRIMOIRE_ROOT: tmpDir },
      })
    } catch (e) {
      exitCode = e.status
    }
    assert.equal(exitCode, 2, `expected exit 2 on push failure, got ${exitCode}`)
    // Verify local commit was created
    const log = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf8' }).trim().split('\n')
    assert.ok(log[0].includes('kb:'), `expected local commit, got: ${log[0]}`)
  })

  it('exits 1 when GRIMOIRE_ROOT points to a non-existent path', () => {
    process.env.GRIMOIRE_ROOT = '/tmp/grim-librarian-nonexistent-' + Date.now()
    try {
      execSync('node bin/grim-librarian.js commit', {
        cwd: '/mnt/eighty/userspace/vgvm/src/me/grimoire',
        stdio: 'pipe',
      })
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal(e.status, 1)
      assert.ok(e.stderr.includes('KB root not found'))
    }
  })

  after(() => {
    for (const d of [tmpDir, bareDir]) {
      if (d && fs.existsSync(d)) {
        try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
      }
    }
  })
})
