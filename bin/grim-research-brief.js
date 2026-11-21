#!/usr/bin/env node
'use strict'

/**
 * grim-research-brief — analyze a research topic, produce opportunity brief.
 *
 * This is the spike version: KB-based analysis using oracle search + edge analysis.
 * Future: integrate with swandive post-dive, external landscape scanning, etc.
 *
 * Usage:
 *   grim research-brief <topic>         Analyze topic, show opportunity brief
 *   grim research-brief --json <topic>  Output as JSON (for programmatic use)
 *   grim research-brief --help
 */

const analyzer = require('../lib/research-analyzer')
const briefFmt = require('../lib/research-brief')

const args = process.argv.slice(2)
let topic = args[0]
const jsonMode = args.includes('--json')

// Normalize: strip leading dashes
const cmd = (args[0] || '').replace(/^-+/, '')

if (cmd === 'help' || cmd === '--help' || cmd === '-h' || !topic) {
  console.log(`grim research-brief — analyze a research topic, propose next steps

Usage:
  grim research-brief <topic>         Analyze topic, show opportunity brief
  grim research-brief --json <topic>  Output as JSON (for programmatic use)

Examples:
  grim research-brief "quantum computing and consciousness"
  grim research-brief "rust async runtimes"
  grim research-brief "local LLM inference optimization"
`)
  process.exit(0)
}

if (cmd === 'json') {
  topic = args[1] || topic
}

if (!topic) {
  console.error('No topic provided.')
  console.error('Usage: grim research-brief <topic>')
  process.exit(1)
}

console.log(`\nAnalyzing: "${topic}"...`)

// Run analysis
;(async () => {
  const analysis = await analyzer.analyze(topic)

  if (jsonMode) {
    console.log(JSON.stringify(analysis, null, 2))
  } else {
    const brief = briefFmt.format(analysis)
    console.log(`\n${brief}`)
  }

  console.log(`\nDone.\n`)
})().catch(e => { console.error(e); process.exit(1) })
