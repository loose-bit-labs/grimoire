#!/usr/bin/env node
// bin/grim-scrub.js — bulk-prune KB orphans, empty entities, and broken edges
//
// Usage: node bin/grim-scrub.js [--dry-run] [--orphans] [--empty] [--all]
//
// Default (no flags): deletes all meta_sessions and empty entities (safe junk)
// --orphans: also deletes orphan entities (reboot events, stale concepts)
// --all: same as --orphans
//
// Target: reads from lbl-config.json (endpoints.grimoire)
// If the current machine IS the KB host, it operates on local files.

const { spawn } = require('child_process')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const full = args.includes('--orphans') || args.includes('--all')

// Resolve the KB endpoint from lbl-config.json
function getHost () {
  if (process.env.GRIMOIRE_HOST) return process.env.GRIMOIRE_HOST
  try {
    const { lblEndpoint } = require('../lib/env')
    const url = lblEndpoint('grimoire')
    if (!url) throw new Error('endpoints.grimoire not set in lbl-config.json')
    return url
  } catch {
    throw new Error('GRIMOIRE_HOST not set and endpoints.grimoire missing from lbl-config.json')
  }
}
const HOST = getHost()

// ── Fetch health ─────────────────────────────────────────────────────────────

async function fetchHealth () {
  const res = await fetch(HOST + '/api/divine')
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── Forget entity ────────────────────────────────────────────────────────────

async function forget (id) {
  const res = await fetch(HOST + '/api/tome/forget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  let body
  try { body = await res.json() } catch { body = { text: await res.text() } }
  return { id, ok: res.ok && body.ok, body }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main () {
  const health = await fetchHealth()
  console.log(`\n  KB: ${health.entityCount} entities, ${health.orphans?.length||0} orphans, ${health.emptyEntities?.length||0} empty, ${health.brokenEdges?.length||0} broken edges\n`)

  const targets = []
  const reasons = {}

  // Always delete empty entities (they're stubs / test entries / dead session records)
  for (const id of (health.emptyEntities || [])) {
    targets.push(id)
    reasons[id] = 'empty'
  }

  // If --orphans: delete reboot events and stale concept stubs
  if (full) {
    for (const id of (health.orphans || [])) {
      if (reasons[id]) continue // already in the list
      // Reboot events are low-value logs
      if (id.startsWith('concept_reboot_')) {
        targets.push(id)
        reasons[id] = 'orphan (reboot event)'
      } else if (id.startsWith('concept_')) {
        // Stale concept stubs — these are usually abandoned experiments
        targets.push(id)
        reasons[id] = 'orphan (stale concept)'
      }
    }
  }

  if (targets.length === 0) {
    console.log('  Nothing to do.\n')
    return
  }

  console.log(`  Targeting ${targets.length} entities for deletion`)
  console.log(`  Breakdown: ${(Object.values(reasons).filter(r=>r==='empty').length)} empty, ${(Object.values(reasons).filter(r=>r.includes('orphan')).length)} orphans\n`)

  if (!dryRun && !args.includes('--yes')) {
    process.stdout.write('  Proceed? [y/N] ')
    const answer = await new Promise(resolve => {
      process.stdin.once('data', d => resolve(d.toString().trim().toLowerCase()))
    })
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Aborted.\n')
      return
    }
  }

  let success = 0
  let alreadyGone = 0
  let errors = 0
  let i = 0

  for (const id of targets) {
    i++
    if (dryRun) {
      if (i % 50 === 0 || i === targets.length) {
        console.log(`  [${i}/${targets.length}] (dry) ${reasons[id]} — ${id}`)
      }
      continue
    }

    const r = await forget(id)
    if (r.body?.ok) {
      success++
      if (i % 100 === 0 || i === targets.length) {
        console.log(`  [${i}/${targets.length}] ✓ ${reasons[id]} — ${id}`)
      }
    } else if (r.body?.reason === 'not_found') {
      alreadyGone++
    } else {
      errors++
      if (errors <= 5) {
        console.error(`  [${i}/${targets.length}] ✗ ${id}: ${JSON.stringify(r.body)}`)
      }
    }

    // Small throttle to avoid hammering
    if (i % 20 === 0) await new Promise(r => setTimeout(r, 50))
  }

  if (!dryRun) {
    console.log(`\n  Results: ${success} deleted, ${alreadyGone} already gone, ${errors} errors, ${targets.length} total`)

    // Rebuild the index
    console.log('  Rebuilding graph index...')
    const scribe = spawn('node', ['bin/grim.js', 'scribe'], { stdio: 'inherit' })
    await new Promise(resolve => scribe.on('close', resolve))
    console.log('  Done.\n')
  } else {
    console.log(`\n  Dry run: ${targets.length} candidates\n`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
