'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { matchDenyList, GrimSecretGuard, DENY_DIRS } = require('../bin/grim-secret-guard.js')

const HOME = '/home/testuser'

// ── matchDenyList — pure path-matching logic ───────────────────────────────────

describe('matchDenyList', () => {
  it('blocks a file directly under ~/.ssh', () => {
    assert.equal(matchDenyList(path.join(HOME, '.ssh', 'id_rsa'), HOME), '~/.ssh/**')
  })

  it('blocks a file nested deeper under ~/.ssh', () => {
    assert.equal(matchDenyList(path.join(HOME, '.ssh', 'sockets', 'agent'), HOME), '~/.ssh/**')
  })

  it('blocks a file under ~/.config/api-keys', () => {
    assert.equal(
      matchDenyList(path.join(HOME, '.config', 'api-keys', 'keys.json'), HOME),
      '~/.config/api-keys/**'
    )
  })

  it('blocks a file under ~/.aws', () => {
    assert.equal(matchDenyList(path.join(HOME, '.aws', 'credentials'), HOME), '~/.aws/**')
  })

  it('blocks a .env file', () => {
    assert.equal(matchDenyList('/mnt/project/.env', HOME), '*.env*')
  })

  it('blocks a .env variant (.env.local)', () => {
    assert.equal(matchDenyList('/mnt/project/.env.local', HOME), '*.env*')
  })

  it('resolves a ~-prefixed path before matching', () => {
    assert.equal(matchDenyList('~/.ssh/id_rsa', HOME), '~/.ssh/**')
  })

  it('allows an ordinary repo file', () => {
    assert.equal(matchDenyList('/mnt/eighty/userspace/vgvm/src/me/grimoire/README.md', HOME), null)
  })

  it('allows null/undefined/empty file_path (fail open on missing data)', () => {
    assert.equal(matchDenyList(null, HOME), null)
    assert.equal(matchDenyList(undefined, HOME), null)
    assert.equal(matchDenyList('', HOME), null)
  })

  // Near-miss: this is the case the phase-98 brief calls out explicitly —
  // a file that merely LOOKS related must not match a directory-scoped rule.
  it('does NOT block keys.json.bak sitting in an unrelated directory', () => {
    assert.equal(matchDenyList('/mnt/eighty/backups/keys.json.bak', HOME), null)
  })

  it('does NOT block a directory that only shares a prefix with a deny dir', () => {
    // ~/.ssh-backup is not ~/.ssh — must not match on string prefix alone
    assert.equal(matchDenyList(path.join(HOME, '.ssh-backup', 'notes.txt'), HOME), null)
  })

  it('does NOT block a file that merely contains "env" without the dot', () => {
    assert.equal(matchDenyList('/mnt/project/environment.js', HOME), null)
  })

  it('DENY_DIRS is the exact three directories the brief names', () => {
    assert.deepEqual(DENY_DIRS, ['.ssh', path.join('.config', 'api-keys'), '.aws'])
  })
})

// ── GrimSecretGuard.run — stdin-JSON decision layer ────────────────────────────

describe('GrimSecretGuard.run', () => {
  const guard = new GrimSecretGuard()

  it('blocks when tool_input.file_path matches the deny list', () => {
    const stdin = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: path.join(require('node:os').homedir(), '.ssh', 'id_rsa') },
    })
    const result = guard.run(stdin)
    assert.equal(result.block, true)
    assert.equal(result.pattern, '~/.ssh/**')
  })

  it('allows an ordinary Read', () => {
    const stdin = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '/mnt/eighty/userspace/vgvm/src/me/grimoire/README.md' },
    })
    assert.equal(guard.run(stdin).block, false)
  })

  it('fails open on malformed JSON (never breaks a normal session)', () => {
    assert.equal(guard.run('not json').block, false)
  })

  it('fails open on empty stdin', () => {
    assert.equal(guard.run('').block, false)
  })

  it('fails open when tool_input is missing', () => {
    assert.equal(guard.run(JSON.stringify({ tool_name: 'Read' })).block, false)
  })
})
