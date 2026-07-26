'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// We need to test classify with --feature flag and listFeatures
const { classify, listFeatures } = require('../bin/grim-research.js')
const grimFeatures = require('../bin/grim-features.js')

// ── classify() with --feature flag ────────────────────────────────────────────

describe('classify() with feature flag', () => {
  it('returns feature-request type when forceFeature is true', () => {
    const result = classify('NPC system needs gossip mechanism', true)
    assert.strictEqual(result.type, 'feature-request')
    assert.strictEqual(result.term, 'NPC system needs gossip mechanism')
  })

  it('still classifies URLs normally when forceFeature is false', () => {
    const urlResult = classify('https://github.com/foo/bar', false)
    assert.strictEqual(urlResult.type, 'url')

    const termResult = classify('ZLUDA', false)
    assert.strictEqual(termResult.type, 'term')
  })
})

// ── listFeatures() ────────────────────────────────────────────────────────────

describe('listFeatures()', () => {
  it('returns empty array when no feature-request entities exist', async () => {
    // Capture stdout
    const originalLog = console.log
    const outputs = []
    console.log = (...args) => { outputs.push(args.join(' ')) }

    try {
      await grimFeatures.listFeatures({ json: true })
      const lastOutput = JSON.parse(outputs[outputs.length - 1])
      assert.strictEqual(lastOutput.count, 0)
      assert.ok(Array.isArray(lastOutput.features))
    } finally {
      console.log = originalLog
    }
  })
})
