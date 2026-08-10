#!/usr/bin/env node
'use strict'

/**
 * lib/hmm.js — HMM Tracking status core (Track Q)
 *
 * Reads .mm/ pact threads and computes participant status via a deterministic
 * state machine. Never writes .mm — read-only observer.
 *
 * Status state machine (per participant):
 *   done/retired   — roadmapOpen == 0
 *   working        — owns next move, last activity < ACTIVE_SEC
 *   conversing     — last ≥2 messages alternate roles within ACTIVE_SEC
 *   waiting-on-user — latest state is 'escalate' with scope, or USER-gate phase
 *   waiting        — not their turn; counterpart owes next message
 *   sleeping       — owns the move but idle > IDLE_SEC
 *
 * Usage:
 *   const { scanProjects, projectStatus } = require('./lib/hmm')
 *   const projects = scanProjects(root)
 */

const fs   = require('node:fs')
const path = require('node:path')

const { readThread, parseHeader, NEXT_OWNER, TERMINAL } = require('../bin/grim-mm')
const { parse: parseRoadmap } = require('../bin/grim-roadmap')

// Activity windows (seconds)
const ACTIVE_SEC = 300   // ~5 min — recent activity
const IDLE_SEC   = 1200  // ~20 min — idle threshold

const ROLES = ['hierophant', 'mage', 'minion']

/**
 * Scan a root directory for pact projects (dirs containing .mm/).
 * Returns array of { project, thread, roadmapOpen }.
 */
function scanProjects(root) {
  const projects = []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return projects
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const mmDir = path.join(root, entry.name, '.mm')
    if (!fs.existsSync(mmDir)) continue

    const thread = readThread(mmDir).map(m => ({ ...m, _path: path.join(mmDir, m.file) }))
    if (thread.length === 0) continue

    // Open-phase count from ROADMAP.md
    let roadmapOpen = 0
    const roadmapPath = path.join(root, entry.name, 'plans', 'ROADMAP.md')
    try {
      const roadmapRows = parseRoadmap(roadmapPath)
      roadmapOpen = roadmapRows.filter(r => r.status !== 'closed' && r.status !== 'done').length
    } catch {
      roadmapOpen = 0
    }

    projects.push({ project: entry.name, thread, roadmapOpen })
  }

  return projects
}

/**
 * Compute status for a single participant in a project.
 * @param {object} threadData — { project, thread, roadmapOpen }
 * @param {string} role — participant role
 * @param {number} now — epoch seconds
 * @returns {object} — { role, status, lastActivitySec }
 */
function participantStatus(threadData, role, now) {
  const { thread, roadmapOpen } = threadData

  if (roadmapOpen === 0) {
    return { role, status: 'retired', lastActivitySec: _latestAge(thread, now) }
  }

  if (thread.length === 0) {
    return { role, status: 'waiting', lastActivitySec: Infinity }
  }

  const latest = thread[thread.length - 1]
  const latestTs = _tsEpoch(latest)
  const age = now - latestTs

  // waiting-on-user: latest state is escalate with scope — applies to the recipient
  if (latest.state === 'escalate' && latest.scope && latest.to.includes(role)) {
    return { role, status: 'waiting-on-user', lastActivitySec: age }
  }

  // conversing: last ≥2 messages alternate roles within ACTIVE_SEC
  if (age <= ACTIVE_SEC && _isConversing(thread, ACTIVE_SEC)) {
    return { role, status: 'conversing', lastActivitySec: age }
  }

  // Determine who owns the next move
  const nextOwner = _nextOwner(thread)
  const ownsMove = nextOwner === role

  if (ownsMove) {
    if (age <= ACTIVE_SEC) {
      return { role, status: 'working', lastActivitySec: age }
    }
    // owns move but idle > IDLE_SEC
    return { role, status: 'sleeping', lastActivitySec: age }
  }

  // Not their turn
  return { role, status: 'waiting', lastActivitySec: age }
}

/**
 * Compute full project status with all participant statuses.
 * @param {object} threadData — { project, thread, roadmapOpen }
 * @param {number} now — epoch seconds
 * @returns {object} — { project, roadmapOpen, retired, participants }
 */
function projectStatus(threadData, now) {
  const { roadmapOpen } = threadData
  const retired = roadmapOpen === 0

  const participants = ROLES.map(role => participantStatus(threadData, role, now))

  return {
    project: threadData.project,
    roadmapOpen,
    retired,
    participants,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get epoch seconds from a thread message (ts: frontmatter, fallback to mtime).
 * Handles both ISO (2026-08-08T15:50:49Z) and compact (2026-08-08_15:50:49) formats.
 */
function _tsEpoch(msg) {
  if (msg.ts) {
    // .mm ts: fields are local time (e.g. "2026-08-08_22:50:43"), not UTC.
    // Parse as local — do NOT append 'Z'.
    const d = new Date(msg.ts.replace('_', 'T'))
    const epoch = Math.floor(d.getTime() / 1000)
    return isNaN(epoch) ? 0 : epoch
  }
  // Fallback to file mtime (msg._path set by scanProjects)
  try {
    const st = fs.statSync(msg._path)
    return Math.floor(st.mtimeMs / 1000)
  } catch {
    return 0
  }
}

/**
 * Age of the latest message in seconds.
 */
function _latestAge(thread, now) {
  if (thread.length === 0) return Infinity
  const latestTs = _tsEpoch(thread[thread.length - 1])
  return now - latestTs
}

/**
 * Determine who owns the next move from the thread.
 */
function _nextOwner(thread) {
  const latest = thread[thread.length - 1]
  if (!latest) return null
  // If latest is TERMINAL, the sender owns the next move (they're ready for a new brief)
  if (TERMINAL.includes(latest.state)) {
    return latest.from
  }
  return NEXT_OWNER[latest.from] || latest.from
}

/**
 * Check if the last ≥2 messages alternate roles within ACTIVE_SEC.
 */
function _isConversing(thread, activeSec) {
  if (thread.length < 2) return false
  const recent = thread.slice(-3) // look at last 3 for alternation
  for (let i = recent.length - 1; i > 0; i--) {
    const age = activeSec - (_tsEpoch(recent[i]) - _tsEpoch(recent[i - 1]))
    if (age < 0) return false // too old
    if (recent[i].from === recent[i - 1].from) return false // same role, not alternating
  }
  return true
}

/**
 * Emit Prometheus gauges for a list of project statuses.
 * Bounded cardinality: {host, project, role, status} — no phase/message labels.
 * @param {Array} projects — output of scanProjects().map(p => projectStatus(p, now))
 * @param {string} host — box hostname
 * @returns {string} — Prometheus text format
 */
function toPrometheus(projects, host) {
  const lines = []
  const node = host || 'unknown'

  for (const proj of projects) {
    for (const p of proj.participants) {
      const projLabel = proj.project.replace(/[^a-zA-Z0-9_]/g, '_')
      const roleLabel = p.role.replace(/[^a-zA-Z0-9_]/g, '_')
      const statusLabel = (p.status || 'waiting').replace(/[^a-zA-Z0-9_]/g, '_')

      // hmm_participant_status{host,project,role,status} — 1=working/conversing/waiting-on-user, 0=others
      const isAlive = (p.status === 'working' || p.status === 'conversing' || p.status === 'waiting-on-user') ? 1 : 0
      lines.push(`hmm_participant_status{host="${node}",project="${projLabel}",role="${roleLabel}",status="${statusLabel}"} ${isAlive}`)

      // hmm_last_activity_seconds{host,project,role}
      const age = typeof p.lastActivitySec === 'number' && isFinite(p.lastActivitySec) ? p.lastActivitySec : 0
      lines.push(`hmm_last_activity_seconds{host="${node}",project="${projLabel}",role="${roleLabel}"} ${age}`)
    }
  }

  return lines.join('\n') + '\n'
}

module.exports = { scanProjects, projectStatus, toPrometheus, ACTIVE_SEC, IDLE_SEC }
