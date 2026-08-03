#!/usr/bin/env node
'use strict'

/**
 * grim-ritual.js — The Ritual
 *
 * Nightly maintenance pipeline. Runs automatically via cron on the KB host.
 * Each stage logs structured JSON results to the KB logs directory.
 *
 * Pipeline:
 *   1. Long Rest    — dream analysis, surface gaps and patterns
 *   2. Scribe       — rebuild graph index
 *   3. Divination   — compute health score
 *   4. Dedup        — report-only near-duplicate entity candidates
 *   5. Pathfinder   — link orphan entities (batch 20)
 *   6. Scribe again — incorporate new edges
 *   7. Noise Floor  — post ritual summary as thought
 *
 * Local only — must run on the KB host.
 *
 * CLI:
 *   node bin/grim-ritual.js
 *   node bin/grim-ritual.js --skip-rest      Skip Long Rest (faster, no Ollama)
 *   node bin/grim-ritual.js --skip-dedup     Skip Dedup stage
 *   node bin/grim-ritual.js --skip-pathfind  Skip Pathfinder
 *   node bin/grim-ritual.js --batch 50       Pathfinder batch size
 *   node bin/grim-ritual.js --dedup-threshold 0.92  Cosine similarity threshold for Dedup
 *   node bin/grim-ritual.js --json           Machine-readable stage log
 */

const fs        = require('node:fs')
const path      = require('node:path')
const minimist  = require('minimist')
const { LocalIndex } = require('vectra')
const { config, requireMode } = require('../lib/env')
const { indexReady } = require('../lib/vectors')

requireMode('local')

const LOGS_DIR = path.join(config.root, 'logs')
fs.mkdirSync(LOGS_DIR, { recursive: true })

// ── Stage runner ──────────────────────────────────────────────────────────────

async function runStage(name, fn) {
  const started = Date.now()
  process.stdout.write(`  [${new Date().toISOString().slice(11, 19)}] ${name} ... `)
  try {
    const result  = await fn()
    const elapsed = Date.now() - started
    console.log(`done (${elapsed}ms)`)
    return { stage: name, ok: true, elapsed, result }
  } catch (e) {
    const elapsed = Date.now() - started
    console.log(`FAILED (${e.message})`)
    return { stage: name, ok: false, elapsed, error: e.message }
  }
}

// ── Dedup — near-duplicate entity detection (report-only) ──────────────────────

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Find near-duplicate entity pairs. Never merges/edits/deletes — report only.
 * Degrades gracefully: if the vector index is missing/unreadable, name-match
 * results are still returned and `embeddingError` explains why embedding
 * comparison was skipped.
 */
async function findDuplicateCandidates(graph, threshold) {
  const entities = Object.values(graph.entities)
  const byNorm   = new Map()
  const pairs    = new Map() // "id1|id2" (sorted) -> candidate

  function addPair(idA, idB, nameA, nameB, type, matchType, score) {
    const key = [idA, idB].sort().join('|')
    const existing = pairs.get(key)
    if (existing) {
      existing.score     = Math.max(existing.score, score)
      existing.matchType = existing.matchType === matchType ? matchType : `${existing.matchType}+${matchType}`
    } else {
      pairs.set(key, { a: idA, b: idB, aName: nameA, bName: nameB, type, matchType, score })
    }
  }

  for (const e of entities) {
    const norm = normalizeName(e.name)
    if (!norm) continue
    const bucket = byNorm.get(norm) || []
    for (const other of bucket) {
      if (other['@type'] === e['@type']) {
        addPair(other['@id'], e['@id'], other.name, e.name, e['@type'], 'name', 1)
      }
    }
    bucket.push(e)
    byNorm.set(norm, bucket)
  }

  let embeddingError = null
  try {
    const ready = await indexReady()
    if (!ready) {
      embeddingError = 'vector index not ready'
    } else {
      const idx     = new LocalIndex(path.join(config.root, 'indexes', 'vectors'))
      const items   = await idx.listItems()
      const byType  = new Map()
      for (const item of items) {
        const list = byType.get(item.metadata.type) || []
        list.push(item)
        byType.set(item.metadata.type, list)
      }
      for (const [type, list] of byType) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const score = cosineSim(list[i].vector, list[j].vector)
            if (score > threshold) {
              addPair(list[i].metadata.id, list[j].metadata.id, list[i].metadata.name, list[j].metadata.name, type, 'embedding', score)
            }
          }
        }
      }
    }
  } catch (e) {
    embeddingError = e.message
  }

  const candidates = [...pairs.values()].sort((x, y) => y.score - x.score)
  return { candidates, embeddingError }
}

// ── Noise Floor poster ────────────────────────────────────────────────────────

function postToNoiseFloor(thought) {
  const noiseFile = path.join(config.root, 'noise-floor.json')
  let thoughts = []
  try { thoughts = JSON.parse(fs.readFileSync(noiseFile, 'utf8')) } catch {}
  thoughts.push({ at: new Date().toISOString(), source: 'ritual', type: 'observation', text: thought })
  fs.writeFileSync(noiseFile, JSON.stringify(thoughts.slice(-500), null, 2))
}

// ── Main ritual ───────────────────────────────────────────────────────────────

async function runRitual({ skipRest = false, skipPathfind = false, batchSize = 20, skipDedup = false, dedupThreshold = 0.92 } = {}) {
  const date    = new Date().toISOString().slice(0, 10)
  const logFile = path.join(LOGS_DIR, `ritual-${date}.json`)
  const stages  = []

  console.log(`\n  ░ The Ritual begins — ${new Date().toISOString()}\n`)

  // Stage 1: Long Rest
  if (!skipRest) {
    const stage = await runStage('Long Rest', async () => {
      const { longRest } = require('./grim-rest')
      return await longRest()
    })
    stages.push(stage)
  } else {
    console.log(`  [--] Long Rest skipped`)
  }

  // Stage 2: Scribe
  stages.push(await runStage('Scribe', async () => {
    const { scribe } = require('./grim-scribe')
    const { graph }  = scribe()
    return { entityCount: graph._meta.entityCount, edgeCount: graph._meta.edgeCount }
  }))

  // Stage 3: Divination
  const divineStage = await runStage('Divination', async () => {
    const { loadGraph }            = require('../lib/graph')
    const { runChecks, computeScore } = require('./grim-divine')
    const graph   = await loadGraph()
    const results = runChecks(graph)
    const scoring = computeScore(results)
    return {
      score:       scoring.score,
      grade:       scoring.grade,
      density:     scoring.density,
      orphans:     results.orphans.length,
      brokenEdges: results.brokenEdges.length,
    }
  })
  stages.push(divineStage)

  // Stage 4: Dedup — report-only near-duplicate entity candidates
  if (!skipDedup) {
    stages.push(await runStage('Dedup', async () => {
      const { loadGraph } = require('../lib/graph')
      const graph = await loadGraph()
      const { candidates, embeddingError } = await findDuplicateCandidates(graph, dedupThreshold)
      return { candidateCount: candidates.length, candidates, embeddingError }
    }))
  } else {
    console.log(`  [--] Dedup skipped`)
  }

  // Stage 5: Pathfinder
  if (!skipPathfind) {
    stages.push(await runStage('Pathfinder', async () => {
      const { pathfind } = require('./grim-pathfind')
      return await pathfind({ batchSize })
    }))
  } else {
    console.log(`  [--] Pathfinder skipped`)
  }

  // Stage 6: Final Scribe
  stages.push(await runStage('Scribe (final)', async () => {
    const { scribe } = require('./grim-scribe')
    const { graph }  = scribe()
    return { entityCount: graph._meta.entityCount, edgeCount: graph._meta.edgeCount }
  }))

  // Summary
  const health     = divineStage.result
  const dedupStage = stages.find(s => s.stage === 'Dedup')
  const dedup      = dedupStage?.result
  const failed     = stages.filter(s => !s.ok)
  const dedupLine  = dedup ? (() => {
    const top3 = dedup.candidates.slice(0, 3).map(c => `${c.aName}~${c.bName} (${c.score.toFixed(2)})`).join(', ')
    return `Dedup: ${dedup.candidateCount} candidate pair(s)${top3 ? ` — top: ${top3}` : ''}.`
  })() : null
  const summary = [
    `Ritual complete ${date}.`,
    health ? `Graph health: ${health.score}/100 (${health.grade}). Orphans: ${health.orphans}.` : null,
    dedupLine,
    failed.length ? `Failures: ${failed.map(s => s.stage).join(', ')}.` : 'All stages passed.',
  ].filter(Boolean)

  const log = {
    date,
    startedAt:  stages[0]?.result ? new Date().toISOString() : null,
    completedAt: new Date().toISOString(),
    stages,
    summary,
  }

  fs.writeFileSync(logFile, JSON.stringify(log, null, 2))
  postToNoiseFloor(summary.join(' '))

  console.log(`\n  ░ Ritual complete.\n`)
  console.log(`  ${summary.join('\n  ')}\n`)
  console.log(`  Log: ${logFile}\n`)

  return log
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = minimist(process.argv.slice(3), {
    boolean: ['json', 'skip-rest', 'skip-pathfind', 'skip-dedup'],
    alias:   { j: 'json', b: 'batch' },
    default: { batch: 20, 'dedup-threshold': 0.92 },
  })

  const result = await runRitual({
    skipRest:       args['skip-rest'],
    skipPathfind:   args['skip-pathfind'],
    batchSize:      Number(args.batch),
    skipDedup:      args['skip-dedup'],
    dedupThreshold: Number(args['dedup-threshold']),
  })

  if (args.json) console.log(JSON.stringify(result, null, 2))
}

main().catch(e => { console.error(e.message); process.exit(1) })

module.exports = { runRitual }
