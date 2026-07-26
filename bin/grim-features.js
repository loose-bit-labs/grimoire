#!/usr/bin/env node
'use strict'

/**
 * grim-features.js — List feature-request entities grouped by project
 *
 * Reads the KB for entities tagged research/feature-request, groups by project,
 * shows needs-triage first.
 *
 * CLI:
 *   grim features                          List all feature requests
 *   grim features <project-id>             List for a specific project
 *   grim features --all                    Same as no args (explicit)
 *   grim features --json                   JSON output
 */

const minimist = require('minimist')
const { loadGraph } = require('../lib/graph')
const { search } = require('./grim-oracle')

function listFeatures(opts = {}) {
  const { project, json } = opts

  let graph
  try {
    graph = loadGraph()
  } catch (e) {
    console.error(`grim features: cannot load graph — ${e.message}`)
    process.exit(1)
  }

  const entities = Object.values(graph.entities || {})
  const featureRequests = entities.filter(e =>
    (e.tags || []).includes('research/feature-request')
  )

  if (featureRequests.length === 0) {
    if (json) console.log(JSON.stringify({ features: [], count: 0 }, null, 2))
    else console.log('  No feature requests filed yet.')
    return
  }

  // Group by project
  const byProject = {}
  for (const e of featureRequests) {
    const proj = (e.relationships?.works_on || [])[0] || '(unrouted)'
    if (!byProject[proj]) byProject[proj] = []
    byProject[proj].push(e)
  }

  // Filter by project if specified
  if (project) {
    if (!byProject[project]) {
      if (json) console.log(JSON.stringify({ features: [], count: 0, project }, null, 2))
      else console.log(`  No feature requests for project '${project}'.`)
      return
    }
    // Show only the requested project
    const projectsToShow = { [project]: byProject[project] }
    printFeatures(projectsToShow, json, project)
    return
  }

  printFeatures(byProject, json, null)
}

function printFeatures(byProject, json, filterProject) {
  if (json) {
    const allFeatures = []
    for (const [proj, entities] of Object.entries(byProject)) {
      for (const e of entities) {
        allFeatures.push({
          project: proj,
          id: e['@id'],
          name: e.name,
          description: e.description?.slice(0, 200),
          needsTriage: (e.tags || []).includes('needs-triage'),
          drop: e.metadata?.drop,
          date: e.metadata?.dateAcquired,
        })
      }
    }
    // Sort: needs-triage first
    allFeatures.sort((a, b) => (b.needsTriage ? 1 : 0) - (a.needsTriage ? 1 : 0))
    console.log(JSON.stringify({ features: allFeatures, count: allFeatures.length }, null, 2))
    return
  }

  // Text output: grouped by project
  const projects = Object.keys(byProject).sort()
  for (const proj of projects) {
    const entities = byProject[proj]
    // Sort: needs-triage first
    entities.sort((a, b) => {
      const aTriage = (a.tags || []).includes('needs-triage') ? 1 : 0
      const bTriage = (b.tags || []).includes('needs-triage') ? 1 : 0
      return bTriage - aTriage
    })

    console.log(`\n  ${proj}`)
    console.log(`  ${'─'.repeat(proj.length + 1)}`)
    for (const e of entities) {
      const triage = (e.tags || []).includes('needs-triage') ? ' [triage]' : ''
      const date = e.metadata?.dateAcquired || ''
      console.log(`    ${e.name}${triage}  (${date})`)
      if (e.description) {
        console.log(`      ${e.description.slice(0, 120)}`)
      }
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = minimist(process.argv.slice(2), {
    string: ['project'],
    boolean: ['json', 'all'],
    alias: { j: 'json', a: 'all' },
    default: { all: false },
  })

  const project = args.project || (args._[0] && !args._[0].startsWith('-') ? args._[0] : null)

  listFeatures({ project, json: args.json })
}

module.exports = { listFeatures }
