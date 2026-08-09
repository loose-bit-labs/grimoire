#!/usr/bin/env node
'use strict'

/**
 * grim-hmm.js — Pact project statuses (Track Q, terminal view)
 *
 * Prints a readable table of host, project, role, status, idle-age
 * for all pact projects under ~/src/me/ (or $GRIMOIRE_ROOT/../src/me/).
 *
 * Usage:
 *   grim hmm
 */

const os      = require('node:os')
const path    = require('node:path')
const { scanProjects, projectStatus } = require('../lib/hmm')

function main() {
  const root = process.env.GRIMOIRE_ROOT
    ? path.join(process.env.GRIMOIRE_ROOT, '..', 'src', 'me')
    : path.join(os.homedir(), 'src', 'me')

  const now = Math.floor(Date.now() / 1000)
  const projects = scanProjects(root).map(p => projectStatus(p, now))

  if (projects.length === 0) {
    console.log('No pact projects found under', root)
    return
  }

  const host = os.hostname().toLowerCase()

  // Header
  console.log(`\n  ${'HOST'.padEnd(8)} ${'PROJECT'.padEnd(30)} ${'ROLE'.padEnd(14)} ${'STATUS'.padEnd(18)} AGE`)
  console.log('  ' + '─'.repeat(80))

  for (const proj of projects) {
    for (const p of proj.participants) {
      const age = p.lastActivitySec >= Infinity ? '—' : `${Math.round(p.lastActivitySec / 60)}m`
      console.log(`  ${host.padEnd(8)} ${proj.project.padEnd(30)} ${p.role.padEnd(14)} ${p.status.padEnd(18)} ${age}`)
    }
  }

  console.log('')
}

if (require.main === module) {
  main()
}

module.exports = { main }
