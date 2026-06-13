'use strict'

/**
 * lib/queue.js — Offline crawl queue
 *
 * NDJSON queue stored at ~/.grimoire/queue.ndjson (or $GRIMOIRE_QUEUE_FILE).
 * Each entry is raw text + metadata, ready to POST to /api/crawl when online.
 *
 * Designed for clients that don't have direct KB access: queue locally,
 * sync to the server later with: grim crawl --sync
 */

const fs   = require('node:fs')
const path = require('node:path')
const os   = require('node:os')
const { randomBytes } = require('node:crypto')

const QUEUE_DIR  = process.env.GRIMOIRE_QUEUE_DIR
  || path.join(os.homedir(), '.grimoire')
const QUEUE_FILE = process.env.GRIMOIRE_QUEUE_FILE
  || path.join(QUEUE_DIR, 'queue.ndjson')

function ensureDir() {
  if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true })
}

/**
 * Add one entry to the queue.
 * @param {{ text: string, source?: string, language?: string|null, noNer?: boolean }} opts
 * @returns {object} The queued entry
 */
function enqueue({ text, source = 'queue', language = null, noNer = false }) {
  ensureDir()
  const entry = {
    id:       randomBytes(6).toString('hex'),
    at:       new Date().toISOString(),
    source,
    language,
    noNer:    noNer || false,
    status:   'pending',
    text,
  }
  fs.appendFileSync(QUEUE_FILE, JSON.stringify(entry) + '\n', 'utf8')
  return entry
}

/**
 * Load all entries from the queue.
 * @returns {object[]}
 */
function loadQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return []
  return fs.readFileSync(QUEUE_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

function saveQueue(entries) {
  ensureDir()
  const content = entries.map(e => JSON.stringify(e)).join('\n')
  fs.writeFileSync(QUEUE_FILE, content + (entries.length ? '\n' : ''), 'utf8')
}

/**
 * Update the status of a queued entry.
 * @param {string} id
 * @param {'synced'|'failed'} status
 * @param {string} [error]
 */
function updateEntry(id, status, error = null) {
  const entries = loadQueue()
  const updated = entries.map(e => {
    if (e.id !== id) return e
    const out = { ...e, status }
    if (status === 'synced') out.syncedAt = new Date().toISOString()
    if (error) out.error = error
    return out
  })
  saveQueue(updated)
}

/**
 * Remove synced/failed entries, leaving only pending ones.
 * @returns {number} Count of remaining pending entries
 */
function clearSynced() {
  const entries = loadQueue().filter(e => e.status === 'pending')
  saveQueue(entries)
  return entries.length
}

module.exports = { enqueue, loadQueue, updateEntry, clearSynced, QUEUE_FILE }
