#!/usr/bin/env node
'use strict'

/**
 * grim-vision.js — The Vision
 *
 * Cast image spells via AUTOMATIC1111, or interrogate images into the KB.
 *
 * CLI:
 *   grim vision spells                           List available spells
 *   grim vision cast logo                        Generate the Grimoire logo
 *   grim vision cast mascot                      Generate the Grimoire mascot
 *   grim vision cast <spell> [--out /tmp/x.png]  Cast a named spell
 *   grim vision cast --prompt "..." [--spell <base>]  Free-form cast
 *   grim vision interrogate image.png            CLIP-caption → entity hints
 *   grim vision interrogate dir/                 Batch interrogate a directory
 */

const fs       = require('node:fs')
const path     = require('node:path')
const minimist = require('minimist')
const { txt2img, interrogate, a1111Available, A1111_BASE, DEFAULT_NEGATIVE } = require('../lib/a1111-client')

// ── Spell registry ────────────────────────────────────────────────────────────
//
// Each spell is a named preset. "prompt" is the positive prompt seed.
// Cast with: grim vision cast <name>
// Override any field with CLI flags.

const SPELLS = {

  logo: {
    description: 'Grimoire Ex Machina — repository logo, wide format',
    prompt: [
      'grimoire logo, ancient mechanical tome robot wizard automaton, brass and copper gears integrated into spellbook cover,',
      'glowing arcane runes etched in circuit traces, neural network tendrils growing from open pages,',
      'teal and deep purple bioluminescent light, dark void background,',
      'professional tech logo, clean composition, dramatic cinematic lighting,',
      'high detail concept art, centered, symmetrical',
    ].join(' '),
    negative_prompt: DEFAULT_NEGATIVE + ', busy background, cluttered, asymmetric, text, words',
    width:  960,
    height: 540,
    steps:  35,
    cfg_scale: 8,
  },

  mascot: {
    description: 'The Grimoire Roboticus — brass automaton wizard mascot',
    prompt: [
      'cute brass automaton wizard mascot character, small mechanical robot wearing tiny conical wizard hat,',
      'chest is an open ancient glowing spellbook with floating runes and equations,',
      'copper and teal bioluminescent glow, glowing rune-carved eyes, warm magical light,',
      'surrounding floating data orbs and circuit runes, dark atmospheric background,',
      'concept art character design, anime-adjacent but dignified, 3/4 view,',
      'detailed, professional illustration, digital painting',
    ].join(' '),
    negative_prompt: DEFAULT_NEGATIVE + ', realistic, photorealistic, ugly robot, scary',
    width:  768,
    height: 768,
    steps:  35,
    cfg_scale: 7.5,
  },

  'mascot-banner': {
    description: 'Mascot + logotype, banner format for README header',
    prompt: [
      'banner illustration, small brass automaton wizard robot mascot on left, open mechanical spellbook in center,',
      'glowing neural network graph emanating from pages, "Grimoire Ex Machina" mood,',
      'dark deep purple background with teal accent light, horizontal composition,',
      'concept art, professional, clean, banner/header format',
    ].join(' '),
    negative_prompt: DEFAULT_NEGATIVE + ', text, words, letters, cluttered',
    width:  1280,
    height: 400,
    steps:  30,
    cfg_scale: 7,
  },

  entity: {
    description: 'Portrait for a KB entity (use --prompt to describe the entity)',
    prompt: 'knowledge graph entity portrait, glowing node in neural network, concept art, teal purple palette',
    negative_prompt: DEFAULT_NEGATIVE,
    width:  512,
    height: 512,
    steps:  25,
    cfg_scale: 7,
  },

  oracle: {
    description: 'The Oracle — abstract visualization for search/query results',
    prompt: [
      'the oracle, vast dark library, floating glowing knowledge nodes connected by light threads,',
      'a lone figure consulting a luminous tome, deep space perspective, teal and amber light shafts,',
      'concept art, cinematic, atmospheric',
    ].join(' '),
    negative_prompt: DEFAULT_NEGATIVE,
    width:  960,
    height: 540,
    steps:  30,
    cfg_scale: 7.5,
  },

}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultOutFile(spellName) {
  const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = process.env.GRIMOIRE_VISION_OUT || '/tmp'
  return path.join(dir, `grimoire-${spellName}-${ts}.png`)
}

function printSpells() {
  console.log('\n  Available spells:\n')
  for (const [name, spell] of Object.entries(SPELLS)) {
    console.log(`  %-20s  %s`.replace('%s', spell.description).replace('%-20s', name.padEnd(20)))
  }
  console.log()
}

function printHelp() {
  console.log(`
  Usage: grim vision [spells|cast|interrogate] [--help]

  Subcommands:

    spells                    List available spells (this output)
    cast <name>               Cast a named spell
    cast --prompt "..."       Free-form generation (optionally --spell <name> for base params)

  Global flags:

    --help                    Show this help text
    --json (-j)               Output results as JSON
    --verbose (-v)            Verbose output

  Cast flags (override spell defaults):

    --prompt (-p) <text>      Override the spell's positive prompt
    --out (-o) <path>         Output file path (default: /tmp/grimoire-<spell>-<timestamp>.png)
    --steps <n>               Sampling steps (spell default: 25–35)
    --width <n>               Image width in pixels (spell default: 512–1280)
    --height <n>              Image height in pixels (spell default: 400–768)

  Interrogate flags:

    interrogate <image|dir>   Run CLIP captioning on an image or all images in a directory
    --model <name>            Interrogate model (default: clip)
    --verbose (-v)            Print caption for each file

  Spell parameters:

    Each spell has a fixed prompt, negative prompt, dimensions, steps, and cfg_scale.
    Override any parameter with the corresponding --flag.
`)

  console.log('  Spells:\n')
  for (const [name, spell] of Object.entries(SPELLS)) {
    console.log(`    ${name.padEnd(20)}  ${spell.description}`)
    console.log(`      size: ${spell.width}×${spell.height}  steps: ${spell.steps}  cfg_scale: ${spell.cfg_scale}`)
    console.log()
  }
}

// ── Cast ──────────────────────────────────────────────────────────────────────

async function cast(spellName, overrides = {}) {
  const base = SPELLS[spellName]
  if (!base) {
    console.error(`  Unknown spell: ${spellName}`)
    console.error(`  Run: grim vision spells`)
    process.exit(1)
  }

  const params = { ...base, ...overrides }
  delete params.description
  params.outFile = overrides.out || defaultOutFile(spellName)

  console.log(`\n  ✦ Casting spell: ${spellName}`)
  console.log(`  ${base.description}`)
  console.log(`  Output: ${params.outFile}`)
  console.log(`  Size: ${params.width}×${params.height}  Steps: ${params.steps}\n`)
  process.stdout.write('  Generating')

  const ticker = setInterval(() => process.stdout.write('.'), 2000)
  try {
    const outPath = await txt2img(params)
    clearInterval(ticker)
    console.log(` done.\n  ✔ Saved: ${outPath}\n`)
    return outPath
  } catch (e) {
    clearInterval(ticker)
    console.error(`\n  ✗ Generation failed: ${e.message}`)
    throw e
  }
}

// ── Interrogate ───────────────────────────────────────────────────────────────

async function interrogateImage(imagePath, { model = 'clip', verbose = false } = {}) {
  const caption = await interrogate(imagePath, model)
  if (verbose) console.log(`  ${path.basename(imagePath)}: ${caption}`)
  return { path: imagePath, caption }
}

async function interrogateDir(dir, opts = {}) {
  const exts   = /\.(png|jpg|jpeg|webp)$/i
  const files  = fs.readdirSync(dir).filter(f => exts.test(f)).map(f => path.join(dir, f))
  const results = []
  for (const f of files) {
    process.stdout.write(`  ↳ ${path.basename(f)} ... `)
    try {
      const r = await interrogateImage(f, opts)
      console.log(r.caption.slice(0, 100))
      results.push(r)
    } catch {
      console.log('failed')
    }
  }
  return results
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  // Check process.argv[2] directly — node consumes --help/-h before minimist sees them.
  // This matches the pattern in grim.js.
  const rawArg = process.argv[2]
  if (rawArg === '--help' || rawArg === '-h') {
    printHelp()
    return
  }

  const args = minimist(process.argv.slice(3), {
    boolean: ['json', 'verbose'],
    alias:   { j: 'json', v: 'verbose', p: 'prompt', o: 'out' },
    string:  ['prompt', 'out', 'spell', 'model'],
  })

  const [subcmd, ...rest] = args._

  // --help/-h can appear after the subcommand (grim vision --help)
  // minimist auto-converts --flag to flag: true even without boolean config
  if (args.help || args.h || args._.includes('--help') || args._.includes('-h')) {
    printHelp()
    return
  }

  if (!subcmd || subcmd === 'spells' || subcmd === 'list') {
    printSpells()
    return
  }

  const online = await a1111Available()
  if (!online) {
    console.error(`\n  ✗ AUTOMATIC1111 is not reachable at ${A1111_BASE}`)
    console.error('  Start it first:  python launch.py --api --listen')
    process.exit(1)
  }

  if (subcmd === 'cast') {
    const spellName = rest[0] || args.spell || 'mascot'
    const overrides = {}
    if (args.prompt) overrides.prompt = args.prompt
    if (args.out)    overrides.out    = args.out
    if (args.steps)  overrides.steps  = Number(args.steps)
    if (args.width)  overrides.width  = Number(args.width)
    if (args.height) overrides.height = Number(args.height)

    const outPath = await cast(spellName, overrides)
    if (args.json) console.log(JSON.stringify({ spell: spellName, path: outPath }))
    return
  }

  if (subcmd === 'interrogate') {
    const target = rest[0] || args._[1]
    if (!target) { console.error('  Usage: grim vision interrogate <image|dir>'); process.exit(1) }

    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      const results = await interrogateDir(target, { model: args.model, verbose: args.verbose })
      if (args.json) console.log(JSON.stringify(results, null, 2))
    } else {
      const result = await interrogateImage(target, { model: args.model, verbose: true })
      if (args.json) console.log(JSON.stringify(result, null, 2))
    }
    return
  }

  console.error(`  Unknown subcommand: ${subcmd}`)
  console.error('  Usage: grim vision [spells|cast|interrogate]')
  process.exit(1)
}

module.exports = { cast, interrogateImage, interrogateDir, SPELLS }

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1) })
