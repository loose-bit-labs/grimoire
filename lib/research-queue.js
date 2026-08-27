'use strict'

/**
 * lib/research-queue.js — Durable pending → researched research queue (phase 84)
 *
 * Dives used to live in in-memory Map entries tied to a front-end's process
 * lifetime — a restart or crash dropped them with no trace. This store owns
 * the state on disk under <GRIMOIRE_ROOT>/research-queue/ so front-ends only
 * submit and get a terminal outcome back; the queue outlives them.
 *
 * Reuses the bounty-store discipline — no new dependency:
 *   - atomic temp+rename writes (a crash mid-write never leaves a torn file)
 *   - per-root single-writer mutate(): a chained promise queue, so concurrent
 *     submits + the serial worker never lose an update
 * and mirrors lib/queue.js's transition shape (status + timestamps + error).
 *
 * Entry shape:
 *   { id, drop, replyTarget, status: 'pending'|'researched'|'failed',
 *     submittedAt, startedAt, finishedAt, result, error }
 * replyTarget is opaque to the queue (e.g. { kind: 'discord-dm', channelId,
 * userId }) — the front-end interprets it on delivery.
 */

const fs        = require('node:fs')
const path      = require('node:path')
const { randomBytes } = require('node:crypto')

const QUEUE_DIRNAME = 'research-queue'
const ENTRY_FILE    = 'entries.json'

// A finished entry only dedups re-submits within this window — an old
// 'researched' entry is a legitimate re-request, not a duplicate.
const DEDUP_WINDOW_MS = 7 * 24 * 3600 * 1000

const STATUSES = new Set(['pending', 'researched', 'failed'])

function paths(root) {
  const dir = path.join(root, QUEUE_DIRNAME)
  return {
    dir,
    file: path.join(dir, ENTRY_FILE),
  }
}

function _readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function _atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file)   // atomic on same filesystem
}

function loadEntries(root) {
  return _readJson(paths(root).file, { entries: [] }).entries || []
}

// per-root serialization: a chained promise queue keyed by the store dir
// (same discipline as bounty-store.mutate)
const _queues = new Map()
function mutate(root, fn) {
  const key = paths(root).dir
  const prev = _queues.get(key) || Promise.resolve()
  const run = prev.then(async () => {
    const entries = loadEntries(root)
    const { entries: next, result } = await fn(entries)
    _atomicWrite(paths(root).file, { entries: next })
    return result
  })
  // keep the chain alive even if this link rejects
  _queues.set(key, run.catch(() => {}))
  return run
}

function newEntry({ drop, replyTarget = null }) {
  if (!drop || typeof drop !== 'string') throw new Error('research-queue: drop is required')
  const now = new Date().toISOString()
  return {
    id:          randomBytes(6).toString('hex'),
    drop,
    replyTarget,
    status:      'pending',
    submittedAt: now,
    startedAt:   null,
    finishedAt:  null,
    result:      null,
    error:       null,
  }
}

// Append a pending entry, deduping by drop against still-pending entries and
// entries finished within DEDUP_WINDOW_MS. Resolves { id, duplicate, entry } —
// the existing entry's id when deduped. Returns immediately (one atomic write).
async function submit(root, { drop, replyTarget = null }) {
  return mutate(root, entries => {
    const now = Date.now()
    const dup = entries.find(e => e.drop === drop &&
      (e.status === 'pending' || now - Date.parse(e.submittedAt) < DEDUP_WINDOW_MS))
    const entry = dup || newEntry({ drop, replyTarget })
    if (!dup) entries.push(entry)
    return { entries, result: { id: entry.id, duplicate: !!dup, entry } }
  })
}

// The single serial worker's critical section: pick the oldest pending, stamp
// startedAt, return it (or null when the queue is empty). No parallel workers
// — the front-end's "come back an hour later" is this loop, run again.
// A claim is not terminal: an entry left in-flight by a crash is the oldest
// pending again next drain and gets re-researched (at-least-once; the queue's
// dedup + the front-end make the re-run harmless). Reaping is phase 85.
async function claimNext(root) {
  return mutate(root, entries => {
    const pending = entries.filter(e => e.status === 'pending')
    if (!pending.length) return { entries, result: null }
    // stable sort: equal submittedAt keeps file order (= submission order),
    // so oldest-first is deterministic across ties
    pending.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    const next = pending[0]
    next.startedAt = new Date().toISOString()
    return { entries, result: { ...next } }
  })
}

// Always terminal — the worker never leaves an entry it claimed in limbo.
// Completing/failing an entry that is no longer pending is a caller bug and
// rejects loudly rather than silently rewriting history.
async function _finish(root, id, patch) {
  return mutate(root, entries => {
    const entry = entries.find(e => e.id === id)
    if (!entry) throw new Error(`research-queue: no entry ${id}`)
    if (entry.status !== 'pending') throw new Error(`research-queue: entry ${id} is ${entry.status}, not pending`)
    entry.status     = patch.status
    entry.finishedAt = new Date().toISOString()
    entry.result     = patch.result
    entry.error      = patch.error
    return { entries, result: { ...entry } }
  })
}

async function complete(root, id, { result = null }) {
  return _finish(root, id, { status: 'researched', result, error: null })
}

async function fail(root, id, { error = 'unknown error' }) {
  return _finish(root, id, { status: 'failed', result: null, error: String(error) })
}

// Read-only: atomic rename means a read always sees a complete file, so no
// lock is needed (same as bounty-store.loadBoard).
function list(root, { status } = {}) {
  if (status !== undefined && !STATUSES.has(status)) {
    throw new Error(`research-queue: unknown status '${status}'`)
  }
  const entries = loadEntries(root)
  return status !== undefined ? entries.filter(e => e.status === status) : entries
}

module.exports = { paths, loadEntries, mutate, submit, claimNext, complete, fail, list, DEDUP_WINDOW_MS }
