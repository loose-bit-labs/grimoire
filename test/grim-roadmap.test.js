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
  // wantan phases 1–6 use a BARE bold **CLOSED** (no date) — must still count as done
  it('bare "**CLOSED**" (no date) → done',
    () => assert.equal(classify('USER eyeball: KILL/CONTINUE — **CLOSED** (CONTINUE)'), 'done'))
  // but a prose "closed <thing>" with no date/bold must NOT count as done
  it('"closes the phase-24 gap" (no date, no bold) → open',
    () => assert.equal(classify('roll the unit; closed the phase-24 aid pin gap'), 'open'))

  // A ✅ that marks a *satisfied dependency* is NOT this phase's done-tick (phase 74
  // was counted done live because "depends on 72+73 ✅" leaked into the DONE test).
  it('"…MVP priority; depends on 72+73 ✅" is OPEN, not done',
    () => assert.equal(classify('**MVP — priority after phase 87**; depends on 72+73 ✅'), 'open'))
  it('a real done-tick still wins even with a satisfied-dep clause after it',
    () => assert.equal(classify('✅ accepted (#0399) — Track G-v3; depends 68 + 82 (both satisfied)'), 'done'))
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

// ── stateWord: only emit a real workflow word, never scraped prose ──────────────
// wantan's last column is prose ("Gate to pass"), not a status. Its first word
// ("USER…", "tests…", "upscale…") must NOT surface as a state — that was the
// "no idea what this is trying to tell me" garbage column. Fall back to 'open'.

describe('stateWord', () => {
  it('keeps a real status word', () => assert.equal(stateWord('queued (hierophant, 2026-08-06) — Track Q'), 'queued'))
  it('blocked wins', () => assert.equal(stateWord('⛔ BLOCKED — creds not'), 'blocked'))
  it('done wins', () => assert.equal(stateWord('✅ accepted (#0242)'), 'done'))
  it('"USER eyeball: KILL/CONTINUE" → open, not "user"', () => assert.equal(stateWord('**USER eyeball: KILL/CONTINUE.**'), 'open'))
  it('"tests green + live expand" → open, not "tests"', () => assert.equal(stateWord('tests green + live expand of hamster-disco'), 'open'))
  it('"upscale-gate rejection…" → open, not "upscale"', () => assert.equal(stateWord('upscale-gate rejection demonstrated'), 'open'))
  it('a satisfied-dependency ✅ does not read as done', () => assert.equal(stateWord('**MVP — priority after phase 87**; depends on 72+73 ✅'), 'open'))
})
