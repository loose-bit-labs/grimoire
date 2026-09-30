#!/usr/bin/env node
'use strict'

/**
 * grim-secret-guard.js — PreToolUse hook guard for the Read tool.
 *
 * Phase 98 (plans/phase-98.md) — first slice of the safe-AI-workspace sandbox:
 * `secretDeny`. Blocks Claude Code's `Read` tool from opening a short, explicit
 * deny-list of secret-shaped paths: `~/.ssh/**`, `~/.config/api-keys/**`,
 * `~/.aws/**`, and any file whose basename contains `.env`.
 *
 * NOT covered (see plans/phase-98.md "Explicitly NOT covered"): `Bash` reads of
 * the same paths (cat/grep/etc.) — a harder, deferred, semantic gate. This hook
 * only sees `Read` tool calls.
 *
 * Hook contract (verified against the current Claude Code hooks docs,
 * https://code.claude.com/docs/en/hooks, 2026-09-29 — this repo had no prior
 * hooks convention to mirror):
 *   - Claude Code invokes the PreToolUse hook command with the tool-call JSON
 *     on stdin: { tool_name, tool_input: { file_path, ... }, ... }.
 *   - Exit code 2 blocks the tool call; stderr is surfaced to the user/model
 *     as the block reason. Exit code 0 allows it (no stdout JSON needed for
 *     this simple case — the docs also support a
 *     `hookSpecificOutput.permissionDecision` JSON-on-stdout form, but the
 *     exit-2 + stderr form is the simpler mechanism and is what this v1 slice
 *     uses).
 */

const fs   = require('node:fs')
const os   = require('node:os')
const path = require('node:path')

// Directories (relative to $HOME) whose entire contents are denied.
const DENY_DIRS = ['.ssh', path.join('.config', 'api-keys'), '.aws']

/**
 * Pure path-matching logic — no I/O, unit-testable in isolation.
 * Returns the deny pattern that matched, or null if the path is allowed.
 *
 * @param {string} filePath - path from tool_input.file_path (may be relative,
 *   absolute, or '~'-prefixed)
 * @param {string} [homeDir] - injectable for tests; defaults to os.homedir()
 * @returns {string|null}
 */
function matchDenyList(filePath, homeDir = os.homedir()) {
  if (!filePath || typeof filePath !== 'string') return null

  const expanded = filePath === '~' || filePath.startsWith('~' + path.sep) || filePath.startsWith('~/')
    ? path.join(homeDir, filePath.slice(1))
    : filePath
  const resolved = path.resolve(expanded)

  for (const dir of DENY_DIRS) {
    const base = path.resolve(homeDir, dir)
    if (resolved === base || resolved.startsWith(base + path.sep)) {
      return `~/${dir}/**`
    }
  }

  // Any file whose *basename* contains ".env" — deliberately narrow (v1 slice):
  // matching on the full path would also trip on an unrelated directory named
  // e.g. ".env-notes", which isn't itself a secret. "keys.json.bak" sitting in
  // an unrelated directory must NOT match the api-keys rule above, and by the
  // same logic a file merely living near something env-ish shouldn't match here.
  if (path.basename(resolved).includes('.env')) {
    return '*.env*'
  }

  return null
}

class GrimSecretGuard {
  /**
   * Decide whether to block, given the raw stdin JSON from the hook.
   * Pulled apart from main() so it's testable without touching stdin/exit.
   * @param {string} rawStdin
   * @returns {{block: boolean, filePath?: string, pattern?: string}}
   */
  run(rawStdin) {
    let payload = {}
    try {
      payload = JSON.parse(rawStdin || '{}')
    } catch (e) {
      // Malformed/absent input: fail open. This hook only ever narrows an
      // already-permitted Read; it must never itself be the reason a normal
      // session breaks.
      return { block: false }
    }

    const filePath = payload && payload.tool_input && payload.tool_input.file_path
    const pattern = matchDenyList(filePath)
    if (pattern) return { block: true, filePath, pattern }
    return { block: false }
  }

  main() {
    let raw = ''
    try {
      raw = fs.readFileSync(0, 'utf8')
    } catch (e) {
      raw = ''
    }

    const result = this.run(raw)
    if (result.block) {
      console.error(
        `grim-secret-guard: blocked Read of ${JSON.stringify(result.filePath)} — matches deny pattern ${result.pattern}`
      )
      process.exit(2)
    }
    process.exit(0)
  }
}

if (require.main === module) {
  new GrimSecretGuard().main()
}

module.exports = { GrimSecretGuard, matchDenyList, DENY_DIRS }
