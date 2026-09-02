#!/usr/bin/env node
'use strict'

/**
 * grim-hmm.js — Pact project statuses (Track Q, terminal view / the Guild Hall)
 *
 * Prints a readable table of host, project, role, status, idle-age for all pact
 * projects under ~/src/me/ (or $GRIMOIRE_ROOT/../src/me/). With --watch it
 * becomes a live doorbell: it redraws whenever a new .mm message lands, and
 * spotlights the latest exchange — who spoke, who's up next (portrait via timg),
 * the phase, the verdict state, and the message's title line. A terminal Guild
 * Hall until the real one ships (phases 63/81). Promoted from ~/tmp/hmm-ww.sh.
 *
 * Usage:
 *   grim hmm                    one-shot status table
 *   grim hmm --once             table + latest-exchange spotlight, once
 *   grim hmm --watch            live: redraw + spotlight on every new message
 *   grim hmm --watch -n 5       poll every 5s (default 3)
 *
 * Portraits: <role>.png looked up in $GRIM_HMM_PORTRAITS, then the repo's
 * assets/pact/, then ~/tmp/ (back-compat with hmm-ww.sh). Missing timg or
 * portrait → the spotlight still renders text-only (graceful degradation).
 */

const os   = require('node:os')
const fs   = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { scanProjects, projectStatus } = require('../lib/hmm')

const ROLE_ICON  = { hierophant: '🎩', mage: '🧙', minion: '🛠️', user: '🧑' }
const STATE_ICON = {
  direction: '🧭', brief: '📋', report: '📤', accepted: '✅', accept: '✅',
  revise: '♻️', revision: '♻️', escalate: '🚨', question: '❓', answer: '💬', ack: '👍',
}
const HAS_TIMG = spawnSync('sh', ['-c', 'command -v timg'], { stdio: 'ignore' }).status === 0

function resolveRoot() {
  return process.env.GRIMOIRE_ROOT
    ? path.join(process.env.GRIMOIRE_ROOT, '..', 'src', 'me')
    : path.join(os.homedir(), 'src', 'me')
}

// Human age: seconds → "12s" / "4m" / "2h" / "—".
function fmtAge(sec) {
  if (!isFinite(sec)) return '—'
  if (sec < 90)   return `${Math.round(sec)}s`
  if (sec < 5400) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}

// The role a portrait belongs to → first existing <role>.png across the search
// dirs. No hardcoded paths: env override, then repo assets, then ~/tmp.
function findPortrait(role) {
  const dirs = [process.env.GRIM_HMM_PORTRAITS, path.join(__dirname, '..', 'assets', 'pact'), path.join(os.homedir(), 'tmp')]
  for (const d of dirs) {
    if (!d) continue
    const p = path.join(d, `${role}.png`)
    if (fs.existsSync(p)) return p
  }
  return null
}

// The message's own title — its first markdown heading — as a one-line summary.
function firstHeading(filePath) {
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const m = /^#{1,3}\s+(.+?)\s*$/.exec(line)
      if (m) return m[1]
    }
  } catch { /* unreadable — no title */ }
  return ''
}

// Newest message across every project. Compare by epoch, not by ts *string*:
// a missing/garbled ts stringifies to "undefined", which sorts ABOVE any real
// "2026-…" date and would otherwise let a stale retired project hijack the
// spotlight. An unparseable ts is treated as oldest (−∞), never newest.
function latestAcross(projects) {
  let best = null, bestT = -Infinity
  for (const proj of projects) {
    const m = proj.thread[proj.thread.length - 1]
    if (!m) continue
    const t = _epoch(m.ts)
    const key = isFinite(t) ? t : -Infinity
    if (!best || key > bestT) { best = { project: proj.project, thread: proj.thread, msg: m }; bestT = key }
  }
  return best
}

function renderTable(projects, host, now) {
  console.log(`\n  ${'HOST'.padEnd(8)} ${'PROJECT'.padEnd(30)} ${'ROLE'.padEnd(14)} ${'STATUS'.padEnd(18)} AGE`)
  console.log('  ' + '─'.repeat(80))
  for (const proj of projects.map(p => projectStatus(p, now))) {
    for (const p of proj.participants) {
      console.log(`  ${host.padEnd(8)} ${proj.project.padEnd(30)} ${p.role.padEnd(14)} ${p.status.padEnd(18)} ${fmtAge(p.lastActivitySec)}`)
    }
  }
  console.log('')
}

// The spotlight: portrait of whoever's up next, then the latest exchange.
function renderSpotlight(projects, now) {
  const L = latestAcross(projects)
  if (!L) return
  const m = L.msg
  const from = m.from || '?', to = m.to || '?'
  const title = firstHeading(m._path)
  const age = isFinite(_epoch(m.ts)) ? fmtAge(now - _epoch(m.ts)) : '—'

  console.log('  ' + '━'.repeat(80))
  const portrait = findPortrait(to)               // who's UP (doorbell), not who spoke
  if (HAS_TIMG && portrait) spawnSync('timg', ['-g', '32x16', portrait], { stdio: 'inherit' })

  console.log(`  #${m.id}  ${ROLE_ICON[from] || ''} ${from} → ${ROLE_ICON[to] || ''} ${to}    ` +
    `phase ${m.phase || '—'}    ${STATE_ICON[m.state] || '·'} ${m.state || 'message'}    ${age} ago    [${L.project}]`)
  if (title) console.log(`  “${title}”`)
  console.log(`  up next: ${ROLE_ICON[to] || ''} ${to}`)

  // Tail of the spotlighted thread (last 3), oldest→newest.
  const tail = L.thread.slice(-3)
  if (tail.length > 1) {
    console.log('')
    for (const t of tail) console.log(`    ${String(t.id).padStart(4)}  ${(t.from || '?')} → ${(t.to || '?')}  ${STATE_ICON[t.state] || '·'} ${t.state || ''}`)
  }
  console.log('')
}

// ts "2026-09-01_13:18:08" → epoch seconds (best-effort; NaN → treated as ∞ age).
function _epoch(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[_ T](\d{2}):(\d{2}):(\d{2})/.exec(String(ts || ''))
  if (!m) return NaN
  return Math.floor(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000)
}

function draw({ root, host, spotlight }) {
  const projects = scanProjects(root)
  const now = Math.floor(Date.now() / 1000)
  if (projects.length === 0) { console.log('No pact projects found under', root); return null }
  renderTable(projects, host, now)
  if (spotlight) renderSpotlight(projects, now)
  const L = latestAcross(projects)
  return L ? `${L.project}#${L.msg.id}` : ''       // change-key for --watch
}

async function watch({ root, host, intervalMs }) {
  let last = null
  process.stdout.write('\x1b[?25l')                                // hide cursor
  const restore = () => { process.stdout.write('\x1b[?25h'); process.exit(0) }
  process.on('SIGINT', restore); process.on('SIGTERM', restore)
  for (;;) {
    const projects = scanProjects(root)
    const L = latestAcross(projects)
    const key = L ? `${L.project}#${L.msg.id}` : ''
    if (key !== last) {                                            // redraw only on a new message
      console.clear()
      console.log(`  🏛️  the Guild Hall — watching ${path.basename(root)}/*/.mm   (Ctrl-C to leave)`)
      draw({ root, host, spotlight: true })
      last = key
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

function parseArgs(argv) {
  const a = argv.filter(t => t !== 'hmm')                          // drop the subcommand token
  const watchOn = a.includes('--watch') || a.includes('-w')
  const once    = a.includes('--once')
  let interval = 3
  const ni = a.findIndex(t => t === '-n' || t === '--interval')
  if (ni >= 0 && a[ni + 1]) interval = Math.max(1, parseInt(a[ni + 1], 10) || 3)
  return { watchOn, once, interval }
}

function main() {
  const root = resolveRoot()
  const host = os.hostname().toLowerCase()
  const { watchOn, once, interval } = parseArgs(process.argv.slice(2))
  if (watchOn) return watch({ root, host, intervalMs: interval * 1000 })
  draw({ root, host, spotlight: once })
}

if (require.main === module) {
  main()
}

module.exports = { main, renderSpotlight, renderTable, latestAcross, findPortrait, firstHeading, _epoch }
