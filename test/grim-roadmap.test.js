'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { classify, cells, shortTitle, trackOf, stateWord } = require('../bin/grim-roadmap.js')

// ── classify: the tricky prose false-positives that bit us live ────────────────

describe('classify', () => {
  it('✅ accepted → done', () => assert.equal(classify('✅ accepted (`plans/reviews/phase-12.md`)'), 'done'))
  it('✅ done live → done', () => assert.equal(classify('✅ done live by hierophant (`a3e47c1`)'), 'done'))
  it('queued → open',      () => assert.equal(classify('queued (hierophant, 2026-08-04) — Track O'), 'open'))

  // ✅/accepted is authoritative — a prose "blocked" must NOT flip an accepted row
  it('"accepted (blocked on 33)" is DONE, not blocked',
    () => assert.equal(classify('✅ accepted (blocked on 33)'), 'done'))

  // ⛔ with a prose "done" ("infra done, creds not") must stay BLOCKED, not done
  it('"⛔ BLOCKED … infra done, creds not" is BLOCKED, not done',
    () => assert.equal(classify('⛔ **BLOCKED (2026-08-02)** — infra done, creds not.'), 'blocked'))

  it('tick-less "blocked" → blocked', () => assert.equal(classify('blocked on upstream'), 'blocked'))

  // wantan closes a phase with "**CLOSED <date>**" in the last cell, not ✅/accepted
  it('"CLOSED 2026-08-05" → done',
    () => assert.equal(classify('frontier blocking demonstrated; suite green — **CLOSED 2026-08-05**'), 'done'))
  // but a prose "closed <thing>" with no date must NOT count as done
  it('"closes the phase-24 gap" (no date) → open',
    () => assert.equal(classify('roll the unit; closed the phase-24 aid pin gap'), 'open'))
})

// ── cells: markdown row splitting ──────────────────────────────────────────────

describe('cells', () => {
  it('drops the empty leading/trailing pipe fields', () => {
    assert.deepEqual(cells('| 57 | plans/phase-57.md | title | queued |'),
      ['57', 'plans/phase-57.md', 'title', 'queued'])
  })
})

// ── shortTitle: prefer the bold label ──────────────────────────────────────────

describe('shortTitle', () => {
  it('extracts the **bold** title and strips backticks', () => {
    assert.equal(shortTitle('**`grim librarian` — KB durability cadence** — the KB defaulted…'),
      'grim librarian — KB durability cadence')
  })
  it('falls back to plain text when no bold', () => {
    assert.equal(shortTitle('a plain description'), 'a plain description')
  })
})

// ── trackOf ────────────────────────────────────────────────────────────────────

describe('trackOf', () => {
  it('pulls the track letter from the status', () => assert.equal(trackOf('queued — Track K; found vier', ''), 'K'))
  it('empty when no track', () => assert.equal(trackOf('queued', ''), ''))
})
