#!/usr/bin/env node
'use strict'

/**
 * grim-mm.js — The Postbox. Mechanics of the .mm/ message thread.
 *
 * The mage/minion/hierophant pact converses through `.mm/` — an append-only
 * thread of message files. This script owns every fiddly bit those skills kept
 * getting wrong: making `.mm/`, gitignoring it, stamping the session's role for
 * the HUD, sequencing the NNNN counter, the `phase · state` header, and working
 * out what's unread. The skills supply judgment; this supplies plumbing.
 *
 * Messages: `.mm/NNNN-<role>.md`. First line: `phase: <N> · state: <state>`.
 * Roles: mage | minion | hierophant.   `.mm/` is gitignored — history is sacred.
 *
 * CLI (called directly by the skills, or via `grim mm`):
 *   grim mm read  --role mage --session "$CLAUDE_CODE_SESSION_ID"
 *   grim mm read  --role hierophant --session "$ID" --all      # whole thread, cold start
 *   grim mm write --role minion --session "$ID" --state report --file /tmp/report.md
 *   echo "body" | grim mm write --role mage --session "$ID" --state revise --phase 3
 *
 * read  → stamps role, prints unread inbox (messages above your last) + waiting status.
 * write → stamps role, prepends the header, appends the next NNNN-<role>.md.
 */

const fs       = require('node:fs')
const path     = require('node:path')
const minimist = require('minimist')
const { execFileSync } = require('node:child_process')

const ROLES  = ['mage', 'minion', 'hierophant']
const STATES = ['brief', 'report', 'revise', 'accepted', 'question', 'blocked', 'direction', 'escalate']
// Who each role listens to, so a role's inbox stays on its own layer of the pact:
// the minion hears only the mage; the mage hears the minion below and the
// hierophant above; the hierophant reads the whole thread (use --all).
const LISTENS = { minion: ['mage'], mage: ['minion', 'hierophant'], hierophant: ['mage', 'minion', 'hierophant'] }
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

// One parsed message file: { num, role, file, phase, state, body, raw }.
// `role` is normalized (overseer → hierophant); `file` keeps the original name.
function parseName(file) {
  const m = /^(\d+)-([a-z]+)\.md$/.exec(file)
  if (!m) return null
  return { num: parseInt(m[1], 10), role: ROLE_ALIASES[m[2]] || m[2], file }
}

function parseHeader(raw) {
  const first = (raw.split('\n', 1)[0] || '')
  const phase = (/phase:\s*([^\s·]+)/i.exec(first) || [])[1] || null
  const state = (/state:\s*([a-z]+)/i.exec(first) || [])[1] || null
  return { phase, state }
}

function readThread(dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names
    .map(parseName)
    .filter(Boolean)
    .map(m => {
      const raw = fs.readFileSync(path.join(dir, m.file), 'utf8')
      return { ...m, raw, ...parseHeader(raw) }
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
  if (latest.role !== role && TERMINAL.includes(latest.state)) {
    return { note: 'phase accepted by another role; idle until next brief' }
  }
  const states = legalReplyStates(role, latest.role, latest.state)
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
  const myLast = thread.filter(m => m.role === role).reduce((n, m) => Math.max(n, m.num), 0)
  const waiting = !!latest && latest.role === role
  // Inbox: messages above my last one from a role I listen to. --all dumps the
  // entire thread verbatim (the hierophant arrives cold and reads everything).
  const inbox = all
    ? thread
    : thread.filter(m => m.num > myLast && m.role !== role && LISTENS[role].includes(m.role))

  const phaseComplete = waiting && TERMINAL.includes(latest.state)
  const nextMove      = computeNextMove({ role, latest, waiting, phaseComplete })

  if (json) {
    console.log(JSON.stringify({
      role, count: thread.length, waiting, phaseComplete,
      latest: latest && { num: latest.num, role: latest.role, state: latest.state, phase: latest.phase },
      inbox: inbox.map(m => ({ num: m.num, role: m.role, state: m.state, phase: m.phase, body: m.raw })),
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
  if (latest && latest.role !== role && TERMINAL.includes(latest.state) && !all) {
    console.log(`PHASE ACCEPTED by ${latest.role} — #${String(latest.num).padStart(PAD, '0')} (phase ${latest.phase}). Nothing for you to do.`)
    console.log(`\n${'─'.repeat(72)}\n${latest.file}  (from ${latest.role}, state: ${latest.state}, phase: ${latest.phase})\n${'─'.repeat(72)}`)
    console.log(latest.raw.trimEnd())
    console.log(`\nIDLE — the phase is closed; the next brief is the mage's move. Wait, then re-run \`grim mm read\` when nudged. Do NOT read .mm/ files by hand.`)
    return
  }
  console.log(`UNREAD: ${inbox.length} message(s)` +
    (latest ? ` — latest is #${String(latest.num).padStart(PAD, '0')}-${latest.role} (state: ${latest.state}, phase: ${latest.phase})` : ''))
  for (const m of inbox) {
    console.log(`\n${'─'.repeat(72)}\n${m.file}  (from ${m.role}, state: ${m.state}, phase: ${m.phase})\n${'─'.repeat(72)}`)
    console.log(m.raw.trimEnd())
  }
  if (!all) printFooter(nextMove)
}

function write({ dir, role, state, phase, body, force, json }) {
  if (!STATES.includes(state)) {
    throw new Error(`invalid --state '${state}'. One of: ${STATES.join(', ')}`)
  }
  const thread = readThread(dir)
  const latest = thread[thread.length - 1] || null

  // Don't fire a second message while your own is the latest unanswered one
  // (the don't-double-send rule the skills keep tripping on). --force overrides.
  // Exception: if your own latest is TERMINAL (accepted), no reply is owed — so a
  // follow-up is legitimate. This is exactly the mage archiving an `accepted` and
  // then briefing the next phase: two mage messages in a row. Don't make that
  // require --force, or the mage hand-writes .mm/ files and the thread rots.
  const latestTerminal = latest && TERMINAL.includes(latest.state)
  if (latest && latest.role === role && !force && !latestTerminal) {
    throw new Error(
      `your message #${String(latest.num).padStart(PAD, '0')} is already the latest unanswered one.\n` +
      `  Wait for a reply, or pass --force if the user told you to send anyway.`)
  }

  const nextNum  = (latest ? latest.num : 0) + 1
  const usePhase = phase != null ? phase : (latest && latest.phase != null ? latest.phase : '0')
  const file     = `${String(nextNum).padStart(PAD, '0')}-${role}.md`
  const header   = `phase: ${usePhase} · state: ${state}`
  const content  = `${header}\n\n${body.trim()}\n`

  fs.writeFileSync(path.join(dir, file), content, 'utf8')

  if (json) {
    console.log(JSON.stringify({ file, num: nextNum, role, state, phase: usePhase }, null, 2))
  } else {
    console.log(`[grim-mm] wrote ${dir}/${file}`)
    console.log(`  ${header}`)
  }
}

function status({ dir, json }) {
  const thread = readThread(dir)
  const latest = thread[thread.length - 1] || null
  const owner  = latest ? (TERMINAL.includes(latest.state) ? latest.role : NEXT_OWNER[latest.role]) : null

  if (json) {
    console.log(JSON.stringify({
      count: thread.length,
      latest: latest && { num: latest.num, role: latest.role, state: latest.state, phase: latest.phase },
      owner,
    }, null, 2))
    return
  }

  if (!latest) { console.log(`[grim-mm] status: EMPTY — no messages yet.`); return }
  console.log(`[grim-mm] status: ${thread.length} message(s) — latest #${String(latest.num).padStart(PAD, '0')}-${latest.role} (${latest.state}, phase ${latest.phase}) — next move: ${owner}`)
}

// Concatenate one phase's messages, in order, to plans/reviews/phase-N.md and
// commit it. Report-only in spirit: refuses on an open phase or an existing
// file (unless --force-overwrite) rather than silently clobbering history.
function archive({ cwd, dir, phase, forceOverwrite }) {
  const thread  = readThread(dir)
  const phaseMessages = thread.filter(m => m.phase === String(phase))
  if (!phaseMessages.length) throw new Error(`no messages found for phase ${phase}`)

  const latest = phaseMessages[phaseMessages.length - 1]
  if (!TERMINAL.includes(latest.state)) {
    throw new Error(`phase ${phase} is not accepted yet (latest: #${String(latest.num).padStart(PAD, '0')}-${latest.role}, state: ${latest.state}) — refusing to archive an open phase`)
  }

  const outPath = path.join(cwd, 'plans', 'reviews', `phase-${phase}.md`)
  if (fs.existsSync(outPath) && !forceOverwrite) {
    throw new Error(`${outPath} already exists — pass --force-overwrite to replace`)
  }

  const content = phaseMessages
    .map(m => `## ${String(m.num).padStart(PAD, '0')}-${m.role} (${m.state})\n\n${m.raw.trim()}\n`)
    .join('\n')

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, content, 'utf8')

  execFileSync('git', ['add', outPath], { cwd })
  execFileSync('git', ['commit', '-m', `mm: archive phase ${phase} review thread`], { cwd })

  return { file: outPath, messageCount: phaseMessages.length }
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
    string:  ['role', 'session', 'state', 'phase', 'file', 'body'],
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
    if (args.phase == null) fail('archive needs --phase N')
    const result = archive({ cwd, dir, phase: args.phase, forceOverwrite: args['force-overwrite'] })
    if (args.json) console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    else console.log(`[grim-mm] archived phase ${args.phase} -> ${result.file} (${result.messageCount} messages), committed.`)
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
    write({ dir, role, state: (args.state || '').toLowerCase(), phase: args.phase, body: String(body), force: args.force, json: args.json })
    return
  }

  fail(`unknown verb '${verb || ''}'. Use: read | write | status | archive`)
}

function fail(msg) {
  console.error(`grim mm: ${msg}`)
  process.exit(1)
}

if (require.main === module) {
  try { main() } catch (e) { console.error(`grim mm: ${e.message}`); process.exit(1) }
}

module.exports = { readThread, parseName, parseHeader, status, archive, computeNextMove }
