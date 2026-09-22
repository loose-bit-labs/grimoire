#!/usr/bin/env node
'use strict'

/**
 * grim-bounty.js — The Bounty Board CLI (phase 76). Thin HTTP client over the
 * phase-74 bounty routes (bin/grim-server.js); never writes state directly.
 * The server is resolved via lib/env config.host (GRIMOIRE_HOST env →
 * lbl-config endpoints.grimoire) — no hardcoded hosts.
 *
 * Deviations from master plan Task 6
 * (docs/superpowers/plans/2026-08-16-grim-bounty-board.md), verified against
 * live code: (1) register hits the shipped POST /api/bounty/:id/register
 * (:id present, unused by the handler); (2) baseUrl() reads config.host
 * (lib/env has no config.endpoints key); (3) the boot guard strips the
 * dispatcher's prepended command name — bin/grim.js spawns
 * 'grim-bounty.js bounty <verb>' (the grim-features.js / grim-roadmap.js
 * idiom).
 */

const minimist = require('minimist')
const { config } = require('../lib/env')

function baseUrl() {
  const url = config.host
  if (!url) throw new Error('grimoire host not resolved (config.host — GRIMOIRE_HOST env or lbl-config endpoints.grimoire)')
  return url.replace(/\/$/, '')
}

function resolveHunterId(args) {
  const id = args.as || process.env.CLAUDE_CODE_SESSION_ID
  if (!id) throw new Error('no hunter id: pass --as <id> or set CLAUDE_CODE_SESSION_ID')
  return id
}

const PR = { P0: 0, P1: 1, P2: 2, P3: 3 }
function formatBoard(bounties) {
  return [...bounties]
    .sort((a, b) => (PR[a.priority] ?? 9) - (PR[b.priority] ?? 9))
    .map(b => `#${b.id}  ${b.priority}  ${String(b.state).padEnd(12)}  ${b.repo}  ${b.phase_tag ?? '-'}  ${b.title}`)
    .join('\n') + '\n'
}

async function api(method, path, body) {
  const res = await fetch(baseUrl() + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

async function main(argv) {
  const args = minimist(argv.slice(1), { boolean: ['json', 'accept', 'reject'], string: ['as', 'repo', 'priority', 'title', 'phase', 'body', 'size', 'file', 'reason', 'wip', 'state', 'kind'] })
  const verb = argv[0]
  const out = (o) => console.log(args.json ? JSON.stringify(o, null, 2) : o)
  switch (verb) {
    case 'list': {
      const q = new URLSearchParams(Object.fromEntries(['state','repo','kind'].filter(k => args[k]).map(k => [k, args[k]])))
      if (args.mine) q.set('mine', resolveHunterId(args))
      const { bounties } = await api('GET', `/api/bounty?${q}`)
      out(args.json ? bounties : formatBoard(bounties)); break
    }
    case 'show':      out((await api('GET', `/api/bounty/${argv[1]}`)).bounty); break
    case 'next': {
      const { bounties } = await api('GET', `/api/bounty?state=OPEN${args.kind ? `&kind=${args.kind}` : ''}`)
      out(bounties[0] || 'no eligible bounties'); break
    }
    case 'claim':     out((await api('POST', `/api/bounty/${argv[1]}/claim`, { hunter_id: resolveHunterId(args), host: require('node:os').hostname(), session_id: process.env.CLAUDE_CODE_SESSION_ID })).bounty); break
    case 'heartbeat': out((await api('POST', `/api/bounty/${argv[1]}/heartbeat`, { hunter_id: resolveHunterId(args), epoch: Number(args.epoch), wip_ref: args.wip })).bounty); break
    case 'submit':    out((await api('POST', `/api/bounty/${argv[1]}/submit`, { hunter_id: resolveHunterId(args), epoch: Number(args.epoch), report: args.file })).bounty); break
    case 'release':   out((await api('POST', `/api/bounty/${argv[1]}/release`, { hunter_id: resolveHunterId(args), epoch: Number(args.epoch) })).bounty); break
    case 'review':    out((await api('POST', `/api/bounty/${argv[1]}/review`, { reviewer_id: resolveHunterId(args), verdict: args.accept ? 'accept' : 'reject', reason: args.reason })).bounty); break
    case 'create':    out((await api('POST', '/api/bounty', { kind: 'phase', repo: args.repo, priority: args.priority, title: args.title, phase_tag: args.phase, body_path: args.body, size: args.size })).bounty); break
    case 'register':  out(await api('POST', `/api/bounty/${resolveHunterId(args)}/register`, { hunter_id: resolveHunterId(args), host: require('node:os').hostname() })); break
    case 'hunters':   out((await api('GET', '/api/bounty/hunters')).hunters); break
    case 'hunter':    out(((await api('GET', '/api/bounty/hunters')).hunters).find(h => h.hunter_id === argv[1]) || 'unknown hunter'); break
    case 'watch':     console.error('watch is deferred — the SSE doorbell lands in phase 75'); process.exit(1)
    default: console.error('usage: grim bounty <list|show|next|claim|heartbeat|submit|release|review|create|register|hunters|hunter|watch>'); process.exit(1)
  }
}

if (require.main === module) {
  // bin/grim.js spawns 'grim-bounty.js bounty <verb>' — the command name is
  // prepended; strip it (the grim-features.js / grim-roadmap.js idiom).
  const argvStart = (process.argv[2] === 'bounty') ? 3 : 2
  main(process.argv.slice(argvStart)).catch(e => { console.error(e.message); process.exit(1) })
}
module.exports = { resolveHunterId, baseUrl, formatBoard, main }
