#!/usr/bin/env node
'use strict'

/**
 * grim-roadmap.js — How much work is left on a repo's ROADMAP?
 *
 * Reads the current repo's plans/ROADMAP.md (cwd-relative, so it works in ANY
 * pact repo), parses the phase table rows, and reports what's still open —
 * split into *this-repo* work (briefs living at plans/phase-N.md) vs *external*
 * work (rows whose brief points at another repo, e.g. a swandive phase in
 * fLimfLaMs). That split is the answer to "how much work is left HERE."
 *
 * Pure mechanics — a row is DONE if its Status cell is ticked/accepted, BLOCKED
 * if it says so, else OPEN. No model, no judgment (Rule 13).
 *
 * CLI:
 *   grim roadmap                     Report on ./plans/ROADMAP.md
 *   grim roadmap path/to/ROADMAP.md  Report on a specific file
 *   grim roadmap --all               Also list the done phases
 *   grim roadmap --json              Machine-readable
 */

const fs   = require('node:fs')
const path = require('node:path')
const minimist = require('minimist')

// Real done-markers in these ROADMAPs are the ✅ tick, "accepted"/"done live",
// or the wantan-style bold **CLOSED** marker (with or without a trailing date).
// The bold markup is the signal: prose like "closed the phase-24 gap" is neither
// bold nor uppercase, so it can't false-positive. (An unbold "CLOSED <date>" is
// also accepted, date-anchored, as a defensive fallback.) A bare "done" in prose
// (e.g. "infra done, creds not") must NOT count, and BLOCKED wins over done (below).
const DONE_RE    = /✅|\baccepted\b|done live|\*\*CLOSED\b|CLOSED \d{4}-\d{2}-\d{2}/i
const BLOCKED_RE = /⛔|blocked/i
// A row is "external" when its Brief cell points at a plans/ file that is NOT
// this repo's own phase brief (e.g. "fLimfLaMs `plans/swandive.md`").
const LOCAL_BRIEF_RE    = /^`?plans\/phase-/i
const EXTERNAL_BRIEF_RE = /plans\//i

function findRoadmap(arg) {
  if (arg) return path.resolve(arg)
  return path.resolve(process.cwd(), 'plans', 'ROADMAP.md')
}

// Split a markdown table row into trimmed cells (drop the empty ends from the
// leading/trailing pipe). Cells never contain raw pipes in these ROADMAPs.
function cells(line) {
  const parts = line.split('|').map(s => s.trim())
  if (parts[0] === '') parts.shift()
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

function shortTitle(what) {
  const bold = /\*\*(.+?)\*\*/.exec(what)
  const t = bold ? bold[1] : what
  return t.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

// Known workflow-status words. A ROADMAP whose last column is a *status* cell
// starts with one of these (grimoire's convention). A ROADMAP whose last column
// is prose (wantan's "Gate to pass") starts with something else ("USER eyeball…",
// "tests green…") — for those we must NOT print the scraped prose word as a
// state; fall back to the neutral 'open'.
const STATE_WORDS = new Set([
  'queued', 'open', 'blocked', 'done', 'accepted', 'wip', 'todo',
  'planned', 'reserved', 'review', 'revise', 'draft', 'active',
])
function stateWord(status) {
  if (BLOCKED_RE.test(status)) return 'blocked'
  if (DONE_RE.test(status))    return 'done'
  const m = /^[\s✅⛔*]*([A-Za-z]+)/.exec(status)
  const w = m ? m[1].toLowerCase() : ''
  return STATE_WORDS.has(w) ? w : 'open'
}

function trackOf(status, what) {
  const m = /Track\s+([A-Z][\w-]*)/.exec(status) || /Track\s+([A-Z][\w-]*)/.exec(what)
  return m ? m[1] : ''
}

// Classify a Status cell → 'done' | 'blocked' | 'open'. The ✅/accepted tick is
// authoritative: it beats a prose "blocked" ("accepted (blocked on 33)" = done).
// Only a tick-less ⛔/blocked row is blocked; a bare "done" in prose ("infra
// done, creds not") is NOT done — that's why DONE_RE excludes bare "done".
function classify(status) {
  if (DONE_RE.test(status))    return 'done'
  if (BLOCKED_RE.test(status)) return 'blocked'
  return 'open'
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const rows = []
  for (const line of raw.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue        // phase rows start "| <n> |"
    const c = cells(line)
    if (c.length < 3) continue
    const phase  = parseInt(c[0], 10)
    const brief  = c[1] || ''
    const status = c[c.length - 1] || ''
    const what   = c.slice(2, c.length - 1).join(' | ') || brief
    const status_ = classify(status)
    const local   = LOCAL_BRIEF_RE.test(brief) || !EXTERNAL_BRIEF_RE.test(brief)
    const repoHint = local ? '' : (brief.split(/[`\s]/).find(Boolean) || '')
    rows.push({
      phase, local, repoHint,
      state: status_ === 'open' ? stateWord(status) : status_,
      status: status_,
      track: trackOf(status, what),
      title: shortTitle(what),
    })
  }
  return rows
}

function report(rows, { file, json, all }) {
  const repo = path.basename(path.dirname(path.dirname(path.resolve(file))))
  const done    = rows.filter(r => r.status === 'done')
  const blocked = rows.filter(r => r.status === 'blocked')
  const open    = rows.filter(r => r.status === 'open')
  const localOpen    = open.filter(r => r.local)
  const externalOpen = open.filter(r => !r.local)

  // duplicate phase numbers (loop-drift signal)
  const seen = {}, dups = new Set()
  for (const r of rows) { if (seen[r.phase]) dups.add(r.phase); seen[r.phase] = true }

  if (json) {
    console.log(JSON.stringify({
      file, repo,
      total: rows.length, done: done.length, open: open.length, blocked: blocked.length,
      thisRepoOpen: localOpen.length, externalOpen: externalOpen.length,
      duplicates: [...dups].sort((a, b) => a - b),
      phases: rows,
    }, null, 2))
    return
  }

  const line = r => `    ${String(r.phase).padStart(3)}  ${r.state.padEnd(8)} ${(r.track ? 'Track ' + r.track : '').padEnd(9)} ${r.local ? '' : `[${r.repoHint}] `}${r.title}`

  console.log(`\n  ROADMAP — ${path.relative(process.cwd(), path.resolve(file)) || file}  (repo: ${repo})`)
  console.log(`  ${'─'.repeat(58)}`)
  console.log(`  ${rows.length} phases · ${done.length} done · ${open.length} open · ${blocked.length} blocked`)
  console.log(`  this repo: ${localOpen.length} open   ·   external: ${externalOpen.length} open`)

  if (localOpen.length) {
    console.log(`\n  Open — ${repo} (finishes this repo):`)
    localOpen.sort((a, b) => a.phase - b.phase).forEach(r => console.log(line(r)))
  }
  if (externalOpen.length) {
    console.log(`\n  Open — external (other repos):`)
    externalOpen.sort((a, b) => a.phase - b.phase).forEach(r => console.log(line(r)))
  }
  if (blocked.length) {
    console.log(`\n  Blocked:`)
    blocked.sort((a, b) => a.phase - b.phase).forEach(r => console.log(line(r)))
  }
  if (all && done.length) {
    console.log(`\n  Done:`)
    done.sort((a, b) => a.phase - b.phase).forEach(r => console.log(line(r)))
  }
  if (dups.size) {
    console.log(`\n  ⚠ duplicate phase numbers (loop-drift — reconcile): ${[...dups].sort((a, b) => a - b).join(', ')}`)
  }

  const n = localOpen.length
  console.log(`\n  → ${repo} finishes in ${n} phase${n === 1 ? '' : 's'}${n ? ' (' + localOpen.map(r => r.phase).sort((a, b) => a - b).join(', ') + ')' : ' — roadmap-empty'}.\n`)
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const argvStart = (process.argv[2] === 'roadmap') ? 3 : 2
  const args = minimist(process.argv.slice(argvStart), {
    boolean: ['json', 'all'],
    alias: { j: 'json', a: 'all' },
    default: { all: false },
  })
  const file = findRoadmap(args._[0])
  if (!fs.existsSync(file)) {
    console.error(`grim roadmap: no ROADMAP found at ${file}`)
    console.error(`  run inside a repo with plans/ROADMAP.md, or pass a path.`)
    process.exit(1)
  }
  try {
    report(parse(file), { file, json: args.json, all: args.all })
  } catch (e) {
    console.error(`grim roadmap: ${e.message}`)
    process.exit(1)
  }
}

module.exports = { parse, cells, shortTitle, stateWord, trackOf, classify }
