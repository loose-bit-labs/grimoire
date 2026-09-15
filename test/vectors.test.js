'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { capForEmbed, EMBED_MAX_CHARS } = require('../lib/vectors.js')

describe('capForEmbed', () => {
  // WHY: nomic-embed-text 500s ("input length exceeds the context length") on
  // over-long text. Before the cap, one oversized entity aborted the whole embed
  // batch — this pins that a long description is truncated, not passed through.
  it('leaves short text untouched', () => {
    assert.equal(capForEmbed('a short description'), 'a short description')
  })
  it('truncates text longer than the cap to exactly the cap', () => {
    const long = 'x'.repeat(EMBED_MAX_CHARS + 5000)
    assert.equal(capForEmbed(long).length, EMBED_MAX_CHARS)
  })
  it('keeps the head (name+description lead) when truncating', () => {
    const long = 'HEAD-SIGNAL ' + 'x'.repeat(EMBED_MAX_CHARS)
    assert.ok(capForEmbed(long).startsWith('HEAD-SIGNAL '))
  })
  it('handles null/undefined without throwing', () => {
    assert.equal(capForEmbed(null), '')
    assert.equal(capForEmbed(undefined), '')
  })
})
