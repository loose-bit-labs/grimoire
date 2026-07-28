#!/usr/bin/env node
'use strict'

/**
 * grim-mm.js — The Postbox. Mechanics of the .mm/ message thread.
 *
 * The mage/minion/hierophant pact converses through `.mm/` — an append-only
 * thread of message files. This script owns every fiddly bit those skills kept
 * getting wrong: making `.mm/`, gitignoring it, stamping the session's role for
 * the HUD, sequencing the NNNN counter, the structured header, and working
 * out what's unread. The skills supply judgment; this supplies plumbing.
 *
 * Messages: `.mm/NNNN-from-<from>-to-<to>.md`.
 *   <from> = single role (sender). <to> = single role or hyphenated combo (recipients).
 *   Roles: mage | minion | hierophant | user.
 *   `.mm/` is gitignored — history is sacred.
 *
 * Message format (YAML frontmatter + body):
 *   ---
 *   id: <content-hash>
 *   ts: <ISO timestamp>
 *   from: <role>
 *   to: <role>[,<role>...]
 *   phase: <N>
 *   state: <state>
 *   scope: <optional>
 *   ---
 *
 *   <body>
 *
 * CLI (called directly by the skills, or via `grim mm`):
 *   grim mm read  --role mage --session "$CLAUDE_CODE_SESSION_ID"
 *   grim mm read  --role hierophant --session "$ID" --all      # whole thread, cold start
 *   grim mm write --role minion --session "$ID" --state report --file /tmp/report.md
 *   echo "body" | grim mm write --role mage --session "$ID" --state revise --phase 3
 *   grim mm write --role mage --session "$ID" --state direction --file f.md --to minion,hierophant
 *
 * read  → stamps role, prints unread inbox (messages above your last) + waiting status.
 * write → stamps from/to, writes YAML header, appends the next NNNN-from-<from>-to-<to>.md.
 */

const fs       = require('node:fs')
const path     = require('node:path')
const minimist = require('minimist')
const { execFileSync } = require('node:child_process')

const ROLES  = ['mage', 'minion', 'hierophant', 'user']
const STATES = ['brief', 'report', 'revise', 'accepted', 'question', 'blocked', 'direction', 'escalate']
// Who each role listens to, so a role's inbox stays on its own layer of the pact:
// the minion hears only the mage; the mage hears the minion below and the
// hierophant above; the hierophant reads the whole thread (use --all).
const LISTENS = { minion: ['mage'], mage: ['minion', 'hierophant'], hierophant: ['mage', 'minion', 'hierophant', 'user'], user: ['mage', 'minion', 'hierophant'] }
// Terminal states close a phase and owe NO reply. If your own terminal message is
// the latest you are not waiting on anyone — the loop is idle and it's your move
// to advance (next brief) or end. Without this the mage's `accepted` reads as
// "waiting on the minion" while the minion reads it as "nothing to do" → deadlock.
const TERMINAL = ['accepted']
const MM      = '.mm'
const PAD     = 4

// ── Thread mechanics ──────────────────────────────────────────────────────────

// Legacy role names found in older threads, normalized to the current ones.
const ROLE_ALIASES = { overseer: 'hierophant' }

// Parse filename → { num, from, to }. Supports both new and legacy formats.
// New: NNNN-from-<from>-to-<to>.md  (to can be hyphenated: mage-minion)
// Legacy: NNNN-<role>.md  (treated as from=role, to=role)
function parseName(file) {
  // Try new format first
  const m = /^(\d+)-from-([a-z]+)-to-([a-z0-9-]+)\.md$/.exec(file)
  if (m) {
    const from = ROLE_ALIASES[m[2]] || m[2]
    const tos = m[3].split('-').map(r => ROLE_ALIASES[r] || r)
    return { num: parseInt(m[1], 10), from, to: tos, file }
  }
  // Legacy fallback
  const lm = /^(\d+)-([a-z]+)\.md$/.exec(file)
  if (lm) {
    const role = ROLE_ALIASES[lm[2]] || lm[2]
    return { num: parseInt(lm[1], 10), from: role, to: [role], file }
  }
  return null
}

// Parse YAML frontmatter + legacy first-line header from raw message body.
// Returns { id, ts, from, to, phase, state, scope }.
function parseHeader(raw) {
  const result = { id: null, ts: null, from: null, to: null, phase: null, state: null, scope: null }

  // Check for YAML frontmatter (--- delimited)
  const fmStart = raw.indexOf('---\n')
  const fmEnd = raw.indexOf('\n---', fmStart + 3)

  if (fmStart >= 0 && fmEnd > fmStart) {
    const fmBody = raw.slice(fmStart + 4, fmEnd)
    fmBody.split('\n').forEach(line => {
      const kv = /^(\w+):\s*(.*)$/.exec(line)
      if (kv) {
        const key = kv[1].toLowerCase()
        const val = kv[2].trim()
        if (key === 'id') result.id = val
        else if (key === 'ts') result.ts = val
        else if (key === 'from') result.from = ROLE_ALIASES[val] || val
        else if (key === 'to') result.to = val.split(',').map(v => ROLE_ALIASES[v.trim()] || v.trim())
        else if (key === 'phase') result.phase = val
        else if (key === 'state') result.state = val
        else if (key === 'scope') result.scope = val
      }
    })
    return result
  }

  // Legacy: first line is `phase: N · state: S`
  const first = (raw.split('\n', 1)[0] || '')
  const phase = (/phase:\s*([^\s·]+)/i.exec(first) || [])[1] || null
  const state = (/state:\s*([a-z]+)/i.exec(first) || [])[1] || null
  const scope = (/^scope:\s*(\S+)/m.exec(raw) || [])[1] || null
  return { phase, state, scope }
}

// Extract body (everything after YAML frontmatter, or everything if no frontmatter).
function extractBody(raw) {
  const fmStart = raw.indexOf('---\n')
  const fmEnd = raw.indexOf('\n---', fmStart + 4)
  if (fmStart >= 0 && fmEnd > fmStart) {
    return raw.slice(fmEnd + 4)
  }
  return raw
}

function readThread(dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names
    .map(parseName)
    .filter(Boolean)
    .map(m => {
      const raw = fs.readFileSync(path.join(dir, m.file), 'utf8')
      const hdr = parseHeader(raw)
      return { ...m, raw, body: extractBody(raw), ...hdr }
    })
    .sort((a, b) => a.num - b.num)
}

// ── Setup: dir, gitignore, role marker ────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function ensureGitignore(cwd) {
  const gi = path.join(cwd, '.gitignore')
  let body = ''
  try { body = fs.readFileSync(gi, 'utf8') } catch {}
  if (body.split('\n').some(l => l.trim().replace(/\/$/, '') === MM)) return
  const next = body && !body.endsWith('\n') ? body + '\n' : body
  fs.writeFileSync(gi, `${next}${MM}/\n`, 'utf8')
}

// Drop the session→role marker the status-line HUD reads. No-op without a session id.
function stampRole(dir, role, session) {
  if (!session) return
  fs.writeFileSync(path.join(dir, `.role-${session}`), `${role}\n`, 'utf8')
}

// ── Next-move footer ─────────────────────────────────────────────────────────
//
// Who legally replies to what, and with which states. Mirrors the pact's actual
// reply graph (minion<->mage, mage<->hierophant) so the skills no longer have to
// re-explain it in prose — `read`'s footer prints the exact legal command instead.

const NEXT_OWNER   = { mage: 'minion', minion: 'mage', hierophant: 'mage' }
const REPLY_STATES = {
  minion:     { mage:       { brief: ['report', 'question', 'blocked'], revise: ['report', 'question', 'blocked'] } },
  mage:       { minion:     { report: ['accepted', 'revise'], question: ['revise'], blocked: ['revise'] },
                hierophant: { direction: ['brief'] } },
  hierophant: { mage:       { escalate: ['direction'] } },
}

function legalReplyStates(readerRole, speakerRole, speakerState) {
  return REPLY_STATES[readerRole]?.[speakerRole]?.[speakerState] || null
}

// One object describing what happens next, used by both --json (`nextMove`) and
// the human-readable footer. `waiting`/`phaseComplete` are the same booleans `read`
// already computes.
function computeNextMove({ role, latest, waiting, phaseComplete }) {
  if (!latest) return { note: 'no messages yet' }
  if (phaseComplete) {
    const n = parseInt(latest.phase, 10)
    const nextN = Number.isFinite(n) ? n + 1 : '<N+1>'
    return {
      action:  'archive-then-brief',
      command: `grim mm archive --phase ${latest.phase}`,
      note:    `then brief phase ${nextN} (--state brief) or declare done`,
    }
  }
  if (waiting) return { note: 'waiting on reply; nothing to send' }
  if (latest.from !== role && TERMINAL.includes(latest.state)) {
    return { note: 'phase accepted by another role; idle until next brief' }
  }
  const states = legalReplyStates(role, latest.from, latest.state)
  if (!states) return { note: 'no defined reply for this situation' }
  return {
    states,
    command: `grim mm write --role ${role} --session "$CLAUDE_CODE_SESSION_ID" --state <${states.join('|')}> --file <reply.md>`,
  }
}

function printFooter(nextMove) {
  if (!nextMove.states && !nextMove.action) return
  if (nextMove.action === 'archive-then-brief') {
    console.log(`next: ${nextMove.command}, ${nextMove.note}.`)
    return
  }
  console.log(`\nNEXT MOVE — choose --state ${nextMove.states.join('|')}:`)
  console.log(`  ${nextMove.command}`)
}

// ── Verbs ──────────────────────────────────────────────────────────────────────

function read({ dir, role, all, json }) {
  const thread = readThread(dir)
  const latest = thread[thread.length - 1] || null
  const myLast = thread.filter(m => m.from === role).reduce((n, m) => Math.max(n, m.num), 0)
  const waiting = !!latest && latest.from === role
  // Inbox: messages above my last one from a role I listen to. --all dumps the
  // entire thread verbatim (the hierophant arrives cold and reads everything).
  const inbox = all
    ? thread
    : thread.filter(m => m.num > myLast && m.from !== role && LISTENS[role].includes(m.from))

  const phaseComplete = waiting && TERMINAL.includes(latest.state)
  const nextMove      = computeNextMove({ role, latest, waiting, phaseComplete })

  if (json) {
    console.log(JSON.stringify({
      role, count: thread.length, waiting, phaseComplete,
      latest: latest && { num: latest.num, from: latest.from, to: latest.to, state: latest.state, phase: latest.phase },
      inbox: inbox.map(m => ({ num: m.num, from: m.from, to: m.to, state: m.state, phase: m.phase, body: m.raw })),
      nextMove,
    }, null, 2))
    return
  }

  console.log(`[grim-mm] role=${role}  thread=${dir}  messages=${thread.length}`)
  if (!thread.length) {
    console.log(`EMPTY — no messages yet. ${role === 'minion' ? 'Wait for a brief.' : 'You may open the thread.'}`)
    return
  }
  if (phaseComplete && !all) {
    console.log(`PHASE COMPLETE — your #${String(latest.num).padStart(PAD, '0')} is '${latest.state}' (phase ${latest.phase}). Nobody owes a reply; the loop is idle.`)
    printFooter(nextMove)
    return
  }
  if (waiting && !all) {
    console.log(`WAITING — your message #${String(latest.num).padStart(PAD, '0')} (state: ${latest.state}) is the latest.`)
    console.log(`Nothing unread is addressed to you. Tell the user you're waiting, and stop.`)
    return
  }
  // A terminal message from someone else (the mage's `accepted`) closes the phase
  // and is NOT a task. You're idle until the next brief lands — don't go reading
  // .mm/ by hand to "check"; just re-run this when nudged.
  if (latest && latest.from !== role && TERMINAL.includes(latest.state) && !all) {
    console.log(`PHASE ACCEPTED by ${latest.from} — #${String(latest.num).padStart(PAD, '0')} (phase ${latest.phase}). Nothing for you to do.`)
    console.log(`\n${'─'.repeat(72)}\n${latest.file}  (from ${latest.from} → ${latest.to.join(',')}, state: ${latest.state}, phase: ${latest.phase})\n${'─'.repeat(72)}`)
    console.log(latest.raw.trimEnd())
    console.log(`\nIDLE — the phase is closed; the next brief is the mage's move. Wait, then re-run \`grim mm read\` when nudged. Do NOT read .mm/ files by hand.`)
    return
  }
  console.log(`UNREAD: ${inbox.length} message(s)` +
    (latest ? ` — latest is #${String(latest.num).padStart(PAD, '0')}-${latest.from}→${latest.to.join(',')} (state: ${latest.state}, phase: ${latest.phase})` : ''))
  for (const m of inbox) {
    console.log(`\n${'─'.repeat(72)}\n${m.file}  (from ${m.from} → ${m.to.join(',')}, state: ${m.state}, phase: ${m.phase})\n${'─'.repeat(72)}`)
    console.log(m.raw.trimEnd())
  }
  if (!all) printFooter(nextMove)
}

function write({ dir, role, state, phase, body, force, json, scope, to }) {
  if (!STATES.includes(state)) {
    throw new Error(`invalid --state '${state}'. One of: ${STATES.join(', ')}`)
  }
  // --state brief requires explicit --phase to prevent silent carry-forward
  // of the previous phase (the root cause of the phase-label drift bug).
  if (state === 'brief' && phase == null) {
    throw new Error('grim mm write: --state brief requires an explicit --phase')
  }
  // --scope is only valid with --state escalate
  if (scope != null && state !== 'escalate') {
    throw new Error('grim mm write: --scope is only valid with --state escalate')
  }
  const thread = readThread(dir)
  const latest = thread[thread.length - 1] || null

  // Resolve recipients: --to flag overrides; defaults to sender (single-role reply).
  const tos = to ? to.split(',').map(t => t.trim()) : [role]

  // Don't fire a second message while your own is the latest unanswered one
  // (the don't-double-send rule the skills keep tripping on). --force overrides.
  // Exception: if your own latest is TERMINAL (accepted), no reply is owed — so a
  // follow-up is legitimate. This is exactly the mage archiving an `accepted` and
  // then briefing the next phase: two mage messages in a row. Don't make that
  // require --force, or the mage hand-writes .mm/ files and the thread rots.
  const latestTerminal = latest && TERMINAL.includes(latest.state)
  if (latest && latest.from === role && !force && !latestTerminal) {
    throw new Error(
      `your message #${String(latest.num).padStart(PAD, '0')} is already the latest unanswered one.\n` +
      `  Wait for a reply, or pass --force if the user told you to send anyway.`)
  }

  const nextNum  = (latest ? latest.num : 0) + 1
  const usePhase = phase != null ? phase : (latest && latest.phase != null ? latest.phase : '0')
  const file     = `${String(nextNum).padStart(PAD, '0')}-from-${role}-to-${tos.join('-')}.md`
  const d = new Date()
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  const id       = String(nextNum).padStart(PAD, '0')
  const toLine   = tos.join(',')
  const scopeLine = scope ? `scope: ${scope}` : ''
  const content  = `---
id: ${id}
ts: ${ts}
from: ${role}
to: ${toLine}
phase: ${usePhase}
state: ${state}
${scopeLine ? scopeLine + '\n' : ''}---

${body.trim()}\n`

  fs.writeFileSync(path.join(dir, file), content, 'utf8')

  if (json) {
    console.log(JSON.stringify({ file, num: nextNum, from: role, to: tos, state, phase: usePhase, scope, id, ts }, null, 2))
  } else {
    console.log(`[grim-mm] wrote ${dir}/${file}`)
    console.log(`  from: ${role} → ${toLine}  phase: ${usePhase}  state: ${state}${scope ? '  scope: ' + scope : ''}`)
  }
}

function status({ dir, json }) {
  const thread = readThread(dir)
  const latest = thread[thread.length - 1] || null
  const owner  = latest ? (TERMINAL.includes(latest.state) ? latest.from : NEXT_OWNER[latest.from]) : null

  if (json) {
    console.log(JSON.stringify({
      count: thread.length,
      latest: latest && { num: latest.num, from: latest.from, to: latest.to, state: latest.state, phase: latest.phase },
      owner,
    }, null, 2))
    return
  }

  if (!latest) { console.log(`[grim-mm] status: EMPTY — no messages yet.`); return }
  console.log(`[grim-mm] status: ${thread.length} message(s) — latest #${String(latest.num).padStart(PAD, '0')}-${latest.from}→${latest.to.join(',')} (${latest.state}, phase ${latest.phase}) — next move: ${owner}`)
}

// Concatenate messages to plans/reviews/<name>.md and commit it.
// Two modes: --phase N (filter by header phase field) or --from/--to/--out (filter by message num range).
// Report-only in spirit: refuses on an open phase or an existing
// file (unless --force-overwrite) rather than silently clobbering history.
function archive({ cwd, dir, phase, from, to, out, forceOverwrite }) {
  const thread = readThread(dir)
  let selected

  if (phase != null) {
    // --phase mode: filter by header phase field
    if (from != null || to != null || out != null) {
      fail('archive: --phase is mutually exclusive with --from/--to/--out')
    }
    selected = thread.filter(m => m.phase === String(phase))
    if (!selected.length) throw new Error(`no messages found for phase ${phase}`)

    const latest = selected[selected.length - 1]
    if (!TERMINAL.includes(latest.state)) {
      throw new Error(`phase ${phase} is not accepted yet (latest: #${String(latest.num).padStart(PAD, '0')}-${latest.from}→${latest.to.join(',')}, state: ${latest.state}) — refusing to archive an open phase`)
    }

    const outPath = path.join(cwd, 'plans', 'reviews', `phase-${phase}.md`)
    if (fs.existsSync(outPath) && !forceOverwrite) {
      throw new Error(`${outPath} already exists — pass --force-overwrite to replace`)
    }

    const content = selected
      .map(m => `## ${String(m.num).padStart(PAD, '0')}-${m.from}→${m.to.join(',')} (${m.state})\n\n${m.raw.trim()}\n`)
      .join('\n')

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, content, 'utf8')

    execFileSync('git', ['add', outPath], { cwd })
    execFileSync('git', ['commit', '-m', `mm: archive phase ${phase} review thread`], { cwd })

    return { file: outPath, messageCount: selected.length }
  }

  // --from/--to/--out mode: filter by message number range
  if (from == null || to == null || out == null) {
    fail('archive: --from and --to and --out are all required together (use --phase N instead)')
  }
  if (phase != null) {
    fail('archive: --phase is mutually exclusive with --from/--to/--out')
  }

  const fromNum = parseInt(String(from), 10)
  const toNum   = parseInt(String(to), 10)
  if (isNaN(fromNum) || isNaN(toNum) || fromNum > toNum) {
    fail(`archive: --from ${from} and --to ${to} must be valid integers with from <= to`)
  }

  selected = thread.filter(m => m.num >= fromNum && m.num <= toNum)
  if (!selected.length) throw new Error(`no messages in range ${fromNum}–${toNum}`)

  const latest = selected[selected.length - 1]
  if (!TERMINAL.includes(latest.state)) {
    throw new Error(`message #${String(latest.num).padStart(PAD, '0')}-${latest.from}→${latest.to.join(',')} (state: ${latest.state}) is not accepted — refusing to archive an open range`)
  }

  const outPath = path.join(cwd, 'plans', 'reviews', `${out}.md`)
  if (fs.existsSync(outPath) && !forceOverwrite) {
    throw new Error(`${outPath} already exists — pass --force-overwrite to replace`)
  }

  const content = selected
    .map(m => `## ${String(m.num).padStart(PAD, '0')}-${m.from}→${m.to.join(',')} (${m.state})\n\n${m.raw.trim()}\n`)
    .join('\n')

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, content, 'utf8')

  execFileSync('git', ['add', outPath], { cwd })
  execFileSync('git', ['commit', '-m', `mm: archive ${out} review thread`], { cwd })

  return { file: outPath, messageCount: selected.length }
}

// ── Halt predicates ──────────────────────────────────────────────────────

/**
 * Check if a brief file declares requires: permission.
 * @param {string} cwd - working directory
 * @param {string} phase - phase number
 * @returns {boolean}
 */
function briefRequiresPermission(cwd, phase) {
  const briefPath = path.join(cwd, 'plans', `phase-${phase}.md`)
  try {
    const body = fs.readFileSync(briefPath, 'utf8')
    return /^requires:\s*permission/im.test(body)
  } catch {
    return false
  }
}

/**
 * Find the lowest-numbered non-accepted phase in ROADMAP.md.
 * Returns the phase number or null if nothing queued.
 * @param {string} cwd - working directory
 * @returns {string|null}
 */
function nextQueuedPhase(cwd) {
  const roadmapPath = path.join(cwd, 'plans', 'ROADMAP.md')
  try {
    const body = fs.readFileSync(roadmapPath, 'utf8')
    const lines = body.split('\n')
    // Match table rows: | N | plans/phase-N.md | ... | ✅ accepted | ...
    // Also match non-table entries
    for (const line of lines) {
      // Table rows
      const tableMatch = /^\|\s*(\d+)\s*\|/.exec(line)
      if (tableMatch) {
        const num = tableMatch[1]
        if (!line.includes('✅ accepted') && !line.includes('archived')) {
          return num
        }
      }
    }
  } catch {}
  return null
}

/**
 * grim mm next — deterministic pact router.
 * Evaluates halt predicates in order; falls through to computeNextMove.
 * @param {object} opts
 * @param {string} opts.dir - thread directory
 * @param {string} opts.role - role to evaluate for
 * @param {string} opts.session - session id (for stamping)
 * @param {boolean} opts.json - JSON output
 * @param {boolean} opts.budgetExceeded - stub flag for budget halt
 * @param {string} opts.cwd - working directory (defaults to process.cwd())
 */
function next({ dir, role, session, json, budgetExceeded, cwd: cwdOpt }) {
  const thread = readThread(dir)
  const latest = thread[thread.length - 1] || null
  const cwd = cwdOpt || process.cwd()

  if (!latest) {
    // No messages — nothing to do
    if (json) {
      console.log(JSON.stringify({ verdict: 'WAIT', reason: 'no messages yet', command: null, owner: null, phase: null, state: null }, null, 2))
    } else {
      console.log('WAIT')
      console.log('no messages yet')
    }
    process.exit(3)
    return
  }

  const currentPhase = latest.phase
  const owner = latest.from === (TERMINAL.includes(latest.state) ? latest.from : NEXT_OWNER[latest.from])
    ? (TERMINAL.includes(latest.state) ? latest.from : NEXT_OWNER[latest.from])
    : null

  // Halt predicate 1: budget (stub — caller passes flag)
  if (budgetExceeded) {
    if (json) {
      console.log(JSON.stringify({ verdict: 'HALT', reason: 'budget', command: `grim mm read --role ${role} --session "${session}"`, owner, phase: currentPhase, state: latest.state }, null, 2))
    } else {
      console.log('HALT budget')
      console.log(`Re-entry: grim mm read --role ${role} --session "${session}"`)
    }
    process.exit(4)
    return
  }

  // Halt predicate 2: deadlock — ≥3 revise messages on current phase
  const reviseCount = thread.filter(m => m.phase === currentPhase && m.state === 'revise').length
  if (reviseCount >= 3) {
    if (json) {
      console.log(JSON.stringify({ verdict: 'HALT', reason: 'deadlock', command: `grim mm read --role ${role} --session "${session}"`, owner, phase: currentPhase, state: latest.state }, null, 2))
    } else {
      console.log('HALT deadlock')
      console.log(`${reviseCount} revise messages on phase ${currentPhase} — thrash guard`)
      console.log(`Re-entry: grim mm read --role ${role} --session "${session}"`)
    }
    process.exit(4)
    return
  }

  // Halt predicate 3: decision — latest is escalate with scope tag
  if (latest.state === 'escalate' && latest.scope) {
    const decisionScopes = ['scope', 'product', 'external']
    if (decisionScopes.includes(latest.scope)) {
      if (json) {
        console.log(JSON.stringify({ verdict: 'HALT', reason: 'decision', command: `grim mm read --role ${role} --session "${session}"`, owner, phase: currentPhase, state: latest.state }, null, 2))
      } else {
        console.log('HALT decision')
        console.log(`Escalate with scope:${latest.scope} — requires human input`)
        console.log(`Re-entry: grim mm read --role ${role} --session "${session}"`)
      }
      process.exit(4)
      return
    }
    // architecture scope → route to hierophant (not a halt)
    // If the current role sent the escalate, they should ACT to route to hierophant
    if (latest.from === role) {
      if (json) {
        console.log(JSON.stringify({
          verdict: 'ACT',
          reason: `escalate with scope:${latest.scope} — route to hierophant`,
          command: `grim mm write --role hierophant --session "${session}" --state direction --file <reply.md>`,
          owner: latest.from,
          phase: currentPhase,
          state: latest.state,
        }, null, 2))
      } else {
        console.log('ACT')
        console.log(`Escalate scope:${latest.scope} — route to hierophant`)
        console.log(`grim mm write --role hierophant --session "${session}" --state direction --file <reply.md>`)
      }
      process.exit(0)
      return
    }
  }

  // Halt predicate 4: permission — next brief requires permission
  const nextPhase = nextQueuedPhase(cwd)
  if (nextPhase && briefRequiresPermission(cwd, nextPhase)) {
    if (json) {
      console.log(JSON.stringify({ verdict: 'HALT', reason: 'permission', command: `grim mm read --role ${role} --session "${session}"`, owner, phase: currentPhase, state: latest.state }, null, 2))
    } else {
      console.log('HALT permission')
      console.log(`Phase ${nextPhase} brief requires permission — commit locally but do not push`)
      console.log(`Re-entry: grim mm read --role ${role} --session "${session}"`)
    }
    process.exit(4)
    return
  }

  // Halt predicate 5: roadmap-empty — latest accepted/archived, nothing queued
  if (TERMINAL.includes(latest.state)) {
    if (!nextPhase) {
      if (json) {
        console.log(JSON.stringify({ verdict: 'HALT', reason: 'roadmap-empty', command: null, owner, phase: currentPhase, state: latest.state }, null, 2))
      } else {
        console.log('HALT roadmap-empty')
        console.log('No queued phases in ROADMAP.md — nothing left to brief')
        console.log(`Re-entry: grim mm read --role ${role} --session "${session}"`)
      }
      process.exit(4)
      return
    }
  }

  // Fall through to computeNextMove
  const myLast = thread.filter(m => m.from === role).reduce((n, m) => Math.max(n, m.num), 0)
  const waiting = !!latest && latest.from === role
  const phaseComplete = waiting && TERMINAL.includes(latest.state)
  const nextMove = computeNextMove({ role, latest, waiting, phaseComplete })

  if (json) {
    const verdict = (waiting || !nextMove.states && !nextMove.action) ? 'WAIT' : 'ACT'
    console.log(JSON.stringify({
      verdict,
      reason: nextMove.note || null,
      command: nextMove.command || null,
      owner,
      phase: currentPhase,
      state: latest.state,
      nextMove,
    }, null, 2))
    process.exit(verdict === 'ACT' ? 0 : 3)
    return
  }

  if (waiting || (!nextMove.states && !nextMove.action)) {
    console.log('WAIT')
    console.log(nextMove.note || 'nothing to do')
    process.exit(3)
  } else {
    console.log('ACT')
    if (nextMove.command) console.log(nextMove.command)
    if (nextMove.note) console.log(nextMove.note)
    process.exit(0)
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  // Accept both `grim mm <verb> …` (dispatcher prepends 'mm') and a direct
  // `node grim-mm.js <verb> …` call from the skills.
  let argv = process.argv.slice(2)
  if (argv[0] === 'mm') argv = argv.slice(1)
  const verb = argv[0]

  const args = minimist(argv.slice(1), {
    boolean: ['all', 'json', 'force', 'force-overwrite'],
    string:  ['role', 'session', 'state', 'phase', 'file', 'body', 'from', 'to', 'out', 'scope', 'dir'],
    alias:   { d: 'dir' },
  })

  const cwd = process.cwd()
  const dir = path.join(cwd, MM)
  ensureDir(dir)
  ensureGitignore(cwd)

  // status/archive are role-agnostic — thread mechanics, not a pact voice.
  if (verb === 'status') {
    status({ dir, json: args.json })
    return
  }

  if (verb === 'archive') {
    const result = archive({ cwd, dir, phase: args.phase, from: args.from, to: args.to, out: args.out, forceOverwrite: args['force-overwrite'] })
    if (args.json) console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    else console.log(`[grim-mm] archived -> ${result.file} (${result.messageCount} messages), committed.`)
    return
  }

  const role = (args.role || '').toLowerCase()
  if (!ROLES.includes(role)) {
    fail(`--role must be one of: ${ROLES.join(', ')}`)
  }
  stampRole(dir, role, args.session)

  if (verb === 'read') {
    read({ dir, role, all: args.all, json: args.json })
    return
  }

  if (verb === 'write') {
    // body from --body, --file, or stdin (pipe-friendly)
    let body = args.body
    if (body == null && args.file) body = fs.readFileSync(args.file, 'utf8')
    if (body == null && !process.stdin.isTTY) body = fs.readFileSync('/dev/stdin', 'utf8')
    if (body == null || !String(body).trim()) {
      fail('write needs a body — pass --body "…", --file <path>, or pipe it on stdin')
    }
    write({ dir, role, state: (args.state || '').toLowerCase(), phase: args.phase, body: String(body), force: args.force, json: args.json, scope: args.scope, to: args.to })
    return
  }

  if (verb === 'next') {
    if (!args.role) fail('--role is required for next')
    if (!args.session) fail('--session is required for next')
    const nextDir = args.dir ? path.resolve(args.dir) : dir
    next({ dir: nextDir, role, session: args.session, json: args.json, budgetExceeded: args['budget-exceeded'], cwd })
    return
  }

  if (verb === 'drive') {
    // Delegate to the standalone drive script — keeps grim-mm.js lean and
    // lets the drive verb be tested/evolved independently.
    const driveArgs = ['bin/grim-mm-drive.js', ...argv.slice(1)]
    const child = require('node:child_process').spawnSync(process.execPath, driveArgs, {
      cwd,
      stdio: 'inherit',
    })
    process.exit(child.status ?? 1)
  }

  fail(`unknown verb '${verb || ''}'. Use: read | write | status | archive | next | drive`)
}

function fail(msg) {
  const e = new Error(`grim mm: ${msg}`)
  e.code = 'USAGE_ERROR'
  throw e
}

if (require.main === module) {
  try { main() } catch (e) { console.error(`grim mm: ${e.message}`); process.exit(1) }
}

module.exports = { readThread, parseName, parseHeader, status, archive, write, computeNextMove, next, briefRequiresPermission, nextQueuedPhase }
