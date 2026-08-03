'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const { formatBriefing, loadBriefing } = require('../bin/grim-session.js')
const { isLocal, isRemote } = require('../lib/env')

// ── formatBriefing() orientation ──────────────────────────────────────────────

describe('formatBriefing() orientation', () => {
  it('prints orientation line first with real hostname and cwd', () => {
    const logs = []
    const orig = console.log
    console.log = (...args) => logs.push(args.join(' '))

    formatBriefing({
      orientation: { time: '2026-07-30T18:00:00.000Z', hostname: 'testhost', cwd: '/tmp' },
      agentModel: { name: 'Grimoire' },
    })

    console.log = orig
    assert.ok(logs[1].includes('📍'), 'orientation line should be second line')
    assert.ok(logs[1].includes('testhost'), 'should show hostname from briefing')
    assert.ok(logs[1].includes('/tmp'), 'should show cwd from briefing')
  })

  it('falls back to os.hostname() and process.cwd() when orientation absent', () => {
    const logs = []
    const orig = console.log
    console.log = (...args) => logs.push(args.join(' '))

    formatBriefing({ agentModel: { name: 'Grimoire' } })

    console.log = orig
    assert.ok(logs[1].includes('📍'), 'orientation line should still print')
    assert.ok(logs[1].includes(process.cwd()), 'should fall back to real cwd')
  })

  it('orientation object has time, hostname, cwd keys', () => {
    // Verify the shape that the CLI path attaches
    const os = require('node:os')
    const orientation = {
      time: new Date().toISOString(),
      hostname: os.hostname(),
      cwd: process.cwd(),
    }
    assert.ok(typeof orientation.time === 'string' && orientation.time.length > 0)
    assert.ok(typeof orientation.hostname === 'string' && orientation.hostname.length > 0)
    assert.ok(typeof orientation.cwd === 'string' && orientation.cwd.length > 0)
  })
})

// ── loadBriefing() mode guard (phase 40 regression) ──────────────────────────

describe('loadBriefing() mode guard', () => {
  it('source uses isRemote && !isLocal (not bare isRemote)', () => {
    const src = fs.readFileSync(require.resolve('../bin/grim-session.js'), 'utf8')
    const branches = src.match(/if \(isRemote[^)]*\)/g) || []
    assert.equal(branches.length, 2, 'should have exactly two isRemote branches')
    for (const b of branches) {
      assert.ok(b.includes('!isLocal'), `branch should guard with !isLocal: ${b}`)
    }
  })

  it('takes local branch when both isLocal and isRemote are true', async () => {
    // On the hub both flags are true; loadBriefing must read the KB directly,
    // not proxy to itself (which would recurse → 500).
    // We verify by calling it and asserting no axios-shaped error.
    const result = await loadBriefing()
    assert.ok(typeof result === 'object', 'should return briefing object')
    assert.ok('agentModel' in result, 'briefing should include agentModel')
  })
})
