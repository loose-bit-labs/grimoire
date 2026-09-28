#!/usr/bin/env node
'use strict'

/**
 * grim-jev.js — `grim jev` CLI: ask TypeSafe/Jev a typed judgment question set.
 *
 * Usage:
 *   grim jev ask <file.json> [--out <path>] [--model <name>]
 *
 * <file.json> is shaped { state, questions } — the same shape every prior
 * one-off ~/tmp/locatesta/ script hand-assembled. Writes the full raw
 * response to --out (default ~/tmp/jev-<timestamp>.json, mirroring the
 * existing artifact-saving habit — prior judgments stay auditable), prints
 * `answers` to stdout and `usage` to stderr.
 */

const fs   = require('node:fs')
const os   = require('node:os')
const path = require('node:path')
const minimist = require('minimist')
const { askJev } = require('../lib/jev')

async function main(argv, { ask = askJev } = {}) {
  const args = minimist(argv.slice(1), { string: ['out', 'model'] })
  const verb = argv[0]

  if (verb !== 'ask' || !argv[1]) {
    console.error('usage: grim jev ask <file.json> [--out <path>] [--model <name>]')
    process.exit(1)
    return
  }

  const { state, questions } = JSON.parse(fs.readFileSync(argv[1], 'utf8'))
  const out = await ask(state, questions, args.model ? { model: args.model } : {})

  const outPath = args.out || path.join(os.homedir(), 'tmp', `jev-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))

  console.log(JSON.stringify(out.answers, null, 2))
  console.error(`\nusage: ${JSON.stringify(out.usage)}  artifact: ${outPath}`)
}

if (require.main === module) {
  // bin/grim.js spawns 'grim-jev.js jev <verb>' — the command name is
  // prepended; strip it (the grim-bounty.js idiom).
  const argvStart = (process.argv[2] === 'jev') ? 3 : 2
  main(process.argv.slice(argvStart)).catch(e => { console.error(e.message); process.exit(1) })
}

module.exports = { main }
