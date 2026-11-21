#!/usr/bin/env node
'use strict'

/**
 * grim-research-patterns — discover patterns across the KB research surface.
 *
 * Finds:
 *   Common concepts (tags across many entities)
 *   Convergent goals (clusters of related threads)
 *   System signals (when 3+ threads need the same thing)
 *
 * Usage:
 *   grim research-patterns              Full analysis
 *   grim research-patterns --json       JSON output
 *   grim research-patterns --concepts   Common concepts only
 *   grim research-patterns --goals      Convergent goals only
 *   grim research-patterns --systems    System signals only
 *   grim research-patterns --help
 */

const patterns = require('../lib/research-patterns')

const args = process.argv.slice(2)
const cmd = (args[0] || '').replace(/^-+/, '')

if (cmd === 'help' || cmd === '--help' || cmd === '-h' || (cmd === 'patterns' && args.length === 0)) {
  console.log(`grim research-patterns — discover patterns across KB research

Usage:
  grim research-patterns              Full analysis
  grim research-patterns --json       JSON output
  grim research-patterns --concepts   Common concepts only
  grim research-patterns --goals      Convergent goals only
  grim research-patterns --systems    System signals only
`)
  process.exit(0)
}

const mode = args.includes('--json') ? 'json' :
             args.includes('--concepts') ? 'concepts' :
             args.includes('--goals') ? 'goals' :
             args.includes('--systems') ? 'systems' : 'all'

console.log(`\nAnalyzing KB patterns...`)

;(async () => {
  const analysis = await patterns.analyze()

  if (mode === 'json') {
    console.log(JSON.stringify(analysis, null, 2))
  } else if (mode === 'concepts') {
    printConcepts(analysis)
  } else if (mode === 'goals') {
    printGoals(analysis)
  } else if (mode === 'systems') {
    printSystems(analysis)
  } else {
    printFull(analysis)
  }

  console.log('Done.\n')
})().catch(e => { console.error(e); process.exit(1) })

// ── Printers ───────────────────────────────────────────────────────

function printConcepts (a) {
  console.log('\nCommon Concepts (tags shared across entities)\n')
  console.log(`\`${'─'.repeat(55)}\``)
  console.log(`Found ${a.commonConcepts.length} concepts in ${a.entityCount} entities\n`)

  for (const c of a.commonConcepts.slice(0, 15)) {
    const bar = '█'.repeat(Math.round(c.count / 2))
    const pad = ' '.repeat(Math.max(0, 10 - bar.length))
    console.log(`  ${bar}${pad} ${c.count}× ${c.tag}`)
    console.log(`    ${c.examples.join(', ').slice(0, 100)}…`)
  }
  console.log(`\n${'─'.repeat(55)}\n`)
}

function printGoals (a) {
  console.log('\nConvergent Goals (clusters of related threads)\n')
  console.log(`\`${'─'.repeat(55)}\``)
  console.log(`Found ${a.convergentGoals.length} clusters\n`)

  for (const c of a.convergentGoals) {
    console.log(`  [${c.tags.slice(0, 3).join(' + ')}] ${c.theme}`)
    console.log(`    ${c.entityCount} entities, ${c.span} tag areas`)
    for (const e of c.entities.slice(0, 3)) {
      console.log(`      ↳ ${e.name.slice(0, 70)}`)
    }
    console.log()
  }
  console.log(`${'─'.repeat(55)}\n`)
}

function printSystems (a) {
  console.log('\nSystem Signals (3+ threads → build opportunity)\n')
  console.log(`\`${'─'.repeat(55)}\``)
  console.log(`Found ${a.systemSignals.length} signals\n`)

  for (const s of a.systemSignals) {
    if (s.type === 'cross-cutting') {
      console.log(`  🏗 ${s.pattern}`)
      console.log(`    Cross-cutting across ${s.categories} categories`)
      console.log(`    → ${s.action}`)
    } else {
      console.log(`  🏗 ${s.category} infrastructure`)
      console.log(`    ${s.memberCount} entities, ${s.commonPatterns.length} common patterns`)
      for (const sc of s.systemCandidates.slice(0, 3)) {
        const strength = sc.signal === 'strong' ? '🔥' : '👉'
        console.log(`    ${strength} ${sc.pattern}: ${sc.action}`)
      }
    }
    console.log()
  }
  console.log(`${'─'.repeat(55)}\n`)
}

function printFull (a) {
  console.log('\nKB Research Pattern Analysis\n')
  console.log(`${'─'.repeat(55)}`)
  console.log(`\n${a.entityCount} entities across the knowledge base\n`)

  // Common concepts
  if (a.commonConcepts.length > 0) {
    printConcepts(a)
  }

  // Convergent goals
  if (a.convergentGoals.length > 0) {
    printGoals(a)
  }

  // System signals
  if (a.systemSignals.length > 0) {
    printSystems(a)
  }

  console.log(`${'─'.repeat(55)}`)
  console.log(`💡 DO SOMETHING ELSE`)
  console.log(`Go somewhere else — tell me what to research\n`)
}
