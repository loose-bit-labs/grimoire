'use strict'
const fs = require('node:fs')
const path = require('node:path')
const B = require('./bounty')

function paths(root) {
  const dir = path.join(root, 'bounties')
  return {
    dir,
    boardFile: path.join(dir, 'board.json'),
    leasesFile: path.join(dir, 'leases.json'),
    huntersFile: path.join(dir, 'hunters.json'),
    gitignoreFile: path.join(dir, '.gitignore'),
  }
}

function _readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function _atomicWrite(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file)   // atomic on same filesystem
}

function loadBoard(root) {
  const p = paths(root)
  const durable = _readJson(p.boardFile, { bounties: [] })
  const leases  = _readJson(p.leasesFile, {})
  const hunters = _readJson(p.huntersFile, {})
  const bounties = (durable.bounties || []).map(b => ({ ...b, lease: leases[b.id] || null }))
  return { bounties, hunters }
}

function saveBoard(root, board) {
  const p = paths(root)
  fs.mkdirSync(p.dir, { recursive: true })
  const leases = {}
  const durable = board.bounties.map(b => {
    const { lease, ...rest } = b
    if (lease) leases[b.id] = lease
    return rest
  })
  _atomicWrite(p.boardFile, { bounties: durable })
  _atomicWrite(p.leasesFile, leases)
  _atomicWrite(p.huntersFile, board.hunters || {})
  if (!fs.existsSync(p.gitignoreFile)) fs.writeFileSync(p.gitignoreFile, 'leases.json\n')
}

// per-root serialization: a chained promise queue keyed by resolved dir
const _queues = new Map()
function mutate(root, fn) {
  const key = paths(root).dir
  const prev = _queues.get(key) || Promise.resolve()
  const run = prev.then(async () => {
    const board = loadBoard(root)
    const { board: next, result } = await fn(board)
    saveBoard(root, next)
    return result
  })
  // keep the chain alive even if this link rejects
  _queues.set(key, run.catch(() => {}))
  return run
}

function upsertHunter(board, { hunterId, host, session_id, nowMs }) {
  board.hunters = board.hunters || {}
  const existing = board.hunters[hunterId]
  board.hunters[hunterId] = {
    hunter_id: hunterId,
    host: host || existing?.host || null,
    session_id: session_id || existing?.session_id || null,
    first_seen: existing?.first_seen ?? nowMs,
    last_seen: nowMs,
  }
  return board
}

module.exports = { paths, loadBoard, saveBoard, mutate, upsertHunter, ConflictError: B.ConflictError }
