#!/usr/bin/env node
'use strict'

/**
 * grim-librarian.js — KB durability cadence
 *
 * Subcommand:
 *   commit    Scan the KB repo, commit any new/updated entities, push to origin
 *
 * Deterministic mechanics — no model calls, no curation. One job: the KB is
 * never more than one cycle behind its remote.
 *
 * Exit codes:
 *   0 — clean (nothing to commit) or commit + push succeeded
 *   1 — fatal error (no KB root, git failure)
 *   2 — push failed (local commit kept; next cycle retries)
 */

const fs       = require('node:fs')
const path     = require('node:path')
const { execSync } = require('node:child_process')
const { config } = require('../lib/env')

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Run a git command in the KB root. Returns stdout as string.
 * Throws on non-zero exit.
 */
function _git(args) {
  return execSync(`git ${args}`, {
    cwd: config.root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Count new (`??`) and modified (` M`) lines from `git status --porcelain`.
 * Returns { new: number, updated: number }.
 */
function _countChanges() {
  const raw = _git('status --porcelain')
  if (!raw) return { new: 0, updated: 0 }
  let newCount = 0
  let updatedCount = 0
  for (const line of raw.split('\n')) {
    const status = line.slice(0, 2)
    if (status === '??') newCount++
    else if (status === ' M') updatedCount++
  }
  return { new: newCount, updated: updatedCount }
}

// ── commit ────────────────────────────────────────────────────────────────────

function cmdCommit() {
  if (!config.root) {
    console.error('grim librarian: GRIMOIRE_ROOT not set — nothing to do')
    process.exit(0)
  }

  if (!fs.existsSync(config.root)) {
    console.error(`grim librarian: KB root not found: ${config.root}`)
    process.exit(1)
  }

  // Ensure we're in a git repo
  try {
    _git('rev-parse --git-dir')
  } catch {
    console.error(`grim librarian: not a git repo: ${config.root}`)
    process.exit(1)
  }

  const counts = _countChanges()
  if (counts.new === 0 && counts.updated === 0) {
    // Clean — exit quietly, no empty commits
    process.exit(0)
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const parts = []
  if (counts.new)     parts.push(`${counts.new} new`)
  if (counts.updated) parts.push(`${counts.updated} updated`)
  const msg = `kb: ${parts.join(', ')} (librarian ${dateStr})`

  try {
    _git('add -A')
    _git(`commit -m "${msg}"`)
  } catch (e) {
    console.error(`grim librarian: commit failed — ${e.message}`)
    process.exit(1)
  }

  // Push — non-fatal on failure; next cycle retries
  try {
    _git('push')
    console.log(`grim librarian: pushed (${msg})`)
  } catch (e) {
    console.error(`grim librarian: push failed — ${e.message}`)
    console.error('Local commit kept; retry on next cycle.')
    process.exit(2)
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const sub = process.argv[2] || 'commit'

switch (sub) {
  case 'commit': cmdCommit(); break
  case '--help':
  case '-h':
    console.log(`
  grim librarian commit    Scan KB, commit changes, push to origin
                           (no-op if KB is clean)

  Exit codes:
    0  clean or success
    1  fatal (no KB root, not a git repo, commit failed)
    2  push failed (local commit kept for next retry)
`)
    process.exit(0)
  default:
    console.error(`grim librarian: unknown subcommand '${sub}'`)
    console.error("Run 'grim librarian --help'")
    process.exit(1)
}
