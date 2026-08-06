#!/usr/bin/env node
'use strict'

/**
 * grim-mm-drive.js — Autopact drive verb.
 *
 * Thin driver for the mage/minion self-driving loop. One tick:
 *   1. Run `grim mm next --role <r> --session <s> --json`
 *   2. Parse the JSON verdict
 *   3. Print a machine-readable `DRIVE:` line + re-entry command
 *   4. Exit with the matching code
 *
 * Exit codes:
 *   0 — ACT  (loop skill performs the judgment work, then writes back)
 *   3 — WAIT (reschedule a longer wakeup)
 *   4 — HALT (print reason, stop the loop via ScheduleWakeup stop)
 *
 * Budget: the loop skill counts tokens and passes `--budget-exceeded` when
 * over budget; drive just relays the flag through to `next`.
 *
 * CLI:
 *   grim mm drive --role <mage|minion> --session <s> [--budget-tokens N]
 *   grim mm drive --role <r> --session <s> --budget-exceeded
 */

const { spawnSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
// Identity check inlined to avoid circular dep with grim-mm.js (which
// requires this module at its top, before its exports are assigned).
function assertRealIdentity(cwd) {
  let name, email
  try {
    name  = execFileSync('git', ['config', 'user.name'],  { cwd, encoding: 'utf8' }).trim()
    email = execFileSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8' }).trim()
  } catch (e) {
    throw new Error(
      `grim mm: git identity check failed — ${e.message}. ` +
      `Set a real identity (\`git config user.name/email\`) or unset a bad local override — the pact never invents one.`
    )
  }
  // Empty name or email
  if (!name || !email) throw new Error(
    `grim mm: refusing to commit: git identity looks like a placeholder ('${name} <${email}>'). ` +
    `Set a real identity (\`git config user.name/email\`) or unset a bad local override — the pact never invents one.`
  )
  // Name is a single short token (≤ 2 chars) — e.g. "T", "a"
  if (name.split(/\s+/).length === 1 && name.length <= 2) throw new Error(
    `grim mm: refusing to commit: git identity looks like a placeholder ('${name} <${email}>'). ` +
    `Set a real identity (\`git config user.name/email\`) or unset a bad local override — the pact never invents one.`
  )
  // Trivial email shapes
  if (email === 't@t' || email === 'test@test' || email === 'a@a') throw new Error(
    `grim mm: refusing to commit: git identity looks like a placeholder ('${name} <${email}>'). ` +
    `Set a real identity (\`git config user.name/email\`) or unset a bad local override — the pact never invents one.`
  )
  // Single-char local + single-char domain
  const [local, domain] = email.split('@')
  if (local.length <= 1 && domain.length <= 1) throw new Error(
    `grim mm: refusing to commit: git identity looks like a placeholder ('${name} <${email}>'). ` +
    `Set a real identity (\`git config user.name/email\`) or unset a bad local override — the pact never invents one.`
  )
  // No dot in domain (catches localhost, host, etc.)
  if (!domain.includes('.')) throw new Error(
    `grim mm: refusing to commit: git identity looks like a placeholder ('${name} <${email}>'). ` +
    `Set a real identity (\`git config user.name/email\`) or unset a bad local override — the pact never invents one.`
  )
}

// Decision-scope tags the hierophant must never rule on — those belong to the
// user. If drive sees an ACT with a direction command while the thread's latest
// message is an escalate tagged with one of these, something bypassed next()'s
// halt predicate and we fail loud.
const DECISION_SCOPES = new Set(['scope', 'product', 'external'])

function drive({ role, session, budgetExceeded, cwd, dir }) {
  // Resolve grim-mm.js relative to this script's location, not cwd.
  // The .mm pact lives in arbitrary repos; bin/grim-mm.js is only in the
  // grimoire install, never in the target repo.
  const mmScript = path.resolve(__dirname, 'grim-mm.js')
  const args = [mmScript, 'next', '--role', role, '--session', session, '--json']
  if (dir) args.push('--dir', dir)
  if (budgetExceeded) args.push('--budget-exceeded')

  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  })

  // next exits 0 (ACT), 3 (WAIT), or 4 (HALT). Any other status is a real error.
  if (result.status !== 0 && result.status !== 3 && result.status !== 4) {
    const err = (result.stderr || '').trim()
    console.error(`grim mm drive: next failed: ${err || result.stderr}`)
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(result.stdout || '{}')
  } catch {
    console.error(`grim mm drive: next returned invalid JSON`)
    process.exit(1)
  }

  const { verdict, reason, command, owner, phase, state, scope } = data

  if (verdict === 'ACT') {
    // Identity preflight: refuse to proceed if git identity is a placeholder.
    // This catches the model-improvised `git config user.name T` incident pattern
    // before any pact commit can poison history.
    try { assertRealIdentity(cwd) } catch (e) {
      console.error(`grim mm drive: ${e.message}`)
      process.exit(1)
    }
    // Authority guard: hierophant must never write a direction answering a
    // decision-scope escalation — that's a user-only ruling.
    if (role === 'hierophant' && command && command.includes('--state direction')
        && state === 'escalate' && scope && DECISION_SCOPES.has(scope)) {
      console.error(
        `grim mm drive: guard — hierophant direction on scope:${scope} escalation ` +
        `is reserved for the user. next should have HALTed.`
      )
      process.exit(1)
    }
    console.log(`DRIVE: ACT ${command || ''}`)
    process.exit(0)
  }

  if (verdict === 'WAIT') {
    console.log(`DRIVE: WAIT ${owner || 'other'}`)
    process.exit(3)
  }

  // HALT
  const reEntry = command || `grim mm read --role ${role} --session "${session}"`
  console.log(`DRIVE: HALT ${reason || 'unknown'}`)
  console.log(`Re-entry: ${reEntry}`)
  process.exit(4)
}

function main() {
  const argv = process.argv.slice(2)
  // Accept both `grim mm drive …` and direct `node grim-mm-drive.js …`
  const start = argv[0] === 'mm' ? 1 : 0
  const args = argv.slice(start)

  // Minimal flag parsing — no minimist dependency needed for this thin wrapper
  const flags = { role: null, session: null, budgetTokens: null, budgetExceeded: false, dir: null }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--role' && args[i + 1]) { flags.role = args[++i] }
    else if (a === '--session' && args[i + 1]) { flags.session = args[++i] }
    else if (a === '--budget-tokens' && args[i + 1]) { flags.budgetTokens = parseInt(args[++i], 10) }
    else if (a === '--budget-exceeded') { flags.budgetExceeded = true }
    else if (a === '--dir' && args[i + 1]) { flags.dir = args[++i] }
  }

  if (!flags.role) {
    console.error('grim mm drive: --role is required')
    process.exit(1)
  }
  if (!flags.session) {
    console.error('grim mm drive: --session is required')
    process.exit(1)
  }

  const budgetExceeded = flags.budgetExceeded || (Number.isFinite(flags.budgetTokens) && flags.budgetTokens <= 0)
  drive({
    role: flags.role,
    session: flags.session,
    budgetExceeded,
    cwd: process.cwd(),
    dir: flags.dir,
  })
}

if (require.main === module) {
  try { main() } catch (e) { console.error(`grim mm drive: ${e.message}`); process.exit(1) }
}

module.exports = { drive }
