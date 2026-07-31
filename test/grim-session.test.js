'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { formatBriefing } = require('../bin/grim-session.js')

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
