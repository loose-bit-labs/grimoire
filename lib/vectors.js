'use strict'

/**
 * lib/vectors.js — Grimoire semantic vector index
 *
 * Builds and queries a local vector index using Ollama embeddings + vectra.
 * The index lives alongside graph.json in the KB indexes/ directory.
 *
 * Embedding model: nomic-embed-text (768 dims, fast, pulls via ollama)
 * Vector store:    vectra (local JSON-backed, no server needed)
 */

const path  = require('node:path')
const axios = require('axios')
const { LocalIndex } = require('vectra')
const { config } = require('./env')

const EMBED_MODEL  = process.env.GRIMOIRE_EMBED_MODEL || 'nomic-embed-text'
const OLLAMA_BASE  = config.ollama
const INDEX_DIR    = () => path.join(config.root, 'indexes', 'vectors')
// nomic-embed-text's context is ~2048 tokens; ollama 500s ("input length
// exceeds the context length") on anything longer rather than truncating. A few
// long entity descriptions would otherwise abort the whole embed batch, so cap
// the text well under the limit (~4 chars/token → 6000 chars ≈ 1500 tokens).
// The head — name + description — carries the semantic signal; the tail is tags
// and notes, cheap to lose. Override with GRIMOIRE_EMBED_MAX_CHARS.
const EMBED_MAX_CHARS = Number(process.env.GRIMOIRE_EMBED_MAX_CHARS) || 6000

// ── Embedding ─────────────────────────────────────────────────────────────────

function capForEmbed(text) {
  const t = String(text || '')
  return t.length > EMBED_MAX_CHARS ? t.slice(0, EMBED_MAX_CHARS) : t
}

async function embed(text) {
  const res = await axios.post(
    `${OLLAMA_BASE}/api/embeddings`,
    { model: EMBED_MODEL, prompt: capForEmbed(text) },
    { timeout: 30_000 }
  )
  return res.data.embedding
}

function entityText(entity) {
  const notes = Array.isArray(entity.notes) ? entity.notes.join(' ') : ''
  const tags  = (entity.tags || []).join(' ')
  return [entity.name, entity.description, notes, tags].filter(Boolean).join(' ')
}

// ── Index management ──────────────────────────────────────────────────────────

async function openIndex() {
  const idx = new LocalIndex(INDEX_DIR())
  if (!await idx.isIndexCreated()) await idx.createIndex()
  return idx
}

/**
 * Build or incrementally update the vector index from a loaded graph.
 * Only re-embeds entities whose dateModified is newer than their stored vector.
 *
 * @param {object} graph - loaded graph from lib/graph.js
 * @param {object} [opts]
 * @param {boolean} [opts.force]   - re-embed all entities regardless of date
 * @param {Function} [opts.onProgress] - called with (done, total) each embed
 * @returns {Promise<{added, updated, skipped}>}
 */
async function buildIndex(graph, { force = false, onProgress } = {}) {
  const idx      = await openIndex()
  const entities = Object.values(graph.entities)
  const stats    = { added: 0, updated: 0, skipped: 0, failed: 0 }

  // Load existing item dates for incremental updates
  const existing = new Map()
  try {
    const items = await idx.listItems()
    for (const item of items) {
      existing.set(item.metadata.id, item.metadata.dateModified || '')
    }
  } catch { /* empty index */ }

  let done = 0
  for (const entity of entities) {
    const id           = entity['@id']
    const dateModified = entity.metadata?.dateModified || ''
    const text         = entityText(entity)

    if (!force && existing.get(id) === dateModified) {
      stats.skipped++
      done++
      onProgress?.(done, entities.length)
      continue
    }

    // Fail-soft per entity: a single embed failure (oversized text, a transient
    // ollama hiccup) must not abort the whole index — log it, skip it, keep going.
    // Graceful degradation: a stale/missing vector for one node beats no rebuild.
    try {
      const vector = await embed(text)

      if (existing.has(id)) {
        await idx.deleteItem(id)
        stats.updated++
      } else {
        stats.added++
      }

      await idx.insertItem({
        id,
        vector,
        metadata: { id, name: entity.name, type: entity['@type'], dateModified },
      })
    } catch (e) {
      stats.failed++
      process.stderr.write(`  ⚠ embed failed for ${id}: ${e.response?.data?.error || e.message}\n`)
    }

    done++
    onProgress?.(done, entities.length)
  }

  return stats
}

/**
 * Semantic search: embed query, return nearest neighbours.
 *
 * @param {string} query
 * @param {number} [topK=10]
 * @returns {Promise<Array<{id, name, type, score}>>}
 */
async function semanticSearch(query, topK = 10) {
  const idx = await openIndex()
  if (!await idx.isIndexCreated()) return []

  const vector  = await embed(query)
  const results = await idx.queryItems(vector, topK)

  return results.map(r => ({
    id:    r.item.metadata.id,
    name:  r.item.metadata.name,
    type:  r.item.metadata.type,
    score: r.score,
  }))
}

/**
 * Check if the vector index exists and has items.
 * @returns {Promise<boolean>}
 */
async function indexReady() {
  try {
    const idx   = new LocalIndex(INDEX_DIR())
    if (!await idx.isIndexCreated()) return false
    const items = await idx.listItems()
    return items.length > 0
  } catch {
    return false
  }
}

module.exports = { embed, buildIndex, semanticSearch, indexReady, entityText, capForEmbed, EMBED_MAX_CHARS }
