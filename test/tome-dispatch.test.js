'use strict'

/**
 * Regression test for the `grim tome <sub>` argv off-by-one (Phase 0 / Phase 9).
 *
 * bin/grim.js's dispatcher spawns each command as [scriptPath, cmd, ...realArgs],
 * so the child's argv[2] is always the injected `cmd` token ('tome'), not the real
 * subcommand — which lands at argv[3]. grim-tome.js used to read process.argv[2]
 * directly for its subcommand, so every `grim tome <sub>` call misread `sub` as
 * the literal string 'tome' and fell through to the generic default-case usage
 * line, regardless of which subcommand was requested. Direct invocation
 * (`node bin/grim-tome.js <sub>`) was unaffected since there's no injected token
 * in that argv shape.
 *
 * These tests spawn the real CLI entry points (offline — no server, no KB
 * writes; `update`/`recall` with no args exit on argument validation before any
 * store operation) and assert the subcommand-specific usage line is reached,
 * not the generic fallback. They fail against the pre-fix code (see the phase-9
 * report for the git-stash proof) and pass after.
 */

const { test }          = require('node:test')
const assert             = require('node:assert/strict')
const path               = require('node:path')
const { execFileSync }   = require('node:child_process')

const REPO_ROOT = path.join(__dirname, '..')
const GRIM      = path.join(REPO_ROOT, 'bin', 'grim.js')
const GRIM_TOME = path.join(REPO_ROOT, 'bin', 'grim-tome.js')

const DEFAULT_USAGE = /Usage: grim tome <recall\|remember\|update\|relate\|annotate\|forget>/

function runCLI(scriptPath, args) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' }
  }
}

test('grim tome update via the real dispatcher reaches the update-specific usage, not the default fallback', () => {
  const result = runCLI(GRIM, ['tome', 'update'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage: grim tome update <entityId>/)
  assert.doesNotMatch(result.stderr, DEFAULT_USAGE)
})

test('grim tome recall via the real dispatcher reaches the recall-specific usage, not the default fallback', () => {
  const result = runCLI(GRIM, ['tome', 'recall'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage: grim tome recall <query>/)
  assert.doesNotMatch(result.stderr, DEFAULT_USAGE)
})

test('direct node bin/grim-tome.js update parses identically to the dispatcher path', () => {
  const result = runCLI(GRIM_TOME, ['update'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage: grim tome update <entityId>/)
})

test('direct node bin/grim-tome.js recall parses identically to the dispatcher path', () => {
  const result = runCLI(GRIM_TOME, ['recall'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage: grim tome recall <query>/)
})

test('an unknown subcommand still falls through to the default usage line', () => {
  const result = runCLI(GRIM, ['tome', 'not-a-real-subcommand'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, DEFAULT_USAGE)
})
