'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const { clearLblCache, lblCacheMeta } = require('../lib/env')

const CACHE_PATH = path.join(os.homedir(), '.config', 'lbl-config.json')
const META_PATH  = path.join(os.homedir(), '.config', 'lbl-config.json.meta')

function writeCache(obj) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(obj, null, 2) + '\n')
}

function writeMeta(obj) {
  fs.mkdirSync(path.dirname(META_PATH), { recursive: true })
  fs.writeFileSync(META_PATH, JSON.stringify(obj, null, 2) + '\n')
}

function cleanup() {
  try { fs.unlinkSync(CACHE_PATH) } catch {}
  try { fs.unlinkSync(META_PATH)  } catch {}
}

describe('clearLblCache()', () => {
  it('removes both cache and meta files', () => {
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    writeMeta({ fetchedAt: '2026-01-01T00:00:00.000Z', source: 'http://aid:3663' })
    assert.ok(fs.existsSync(CACHE_PATH))
    assert.ok(fs.existsSync(META_PATH))

    clearLblCache()

    assert.ok(!fs.existsSync(CACHE_PATH))
    assert.ok(!fs.existsSync(META_PATH))
  })

  it('is idempotent — no-op when files are absent', () => {
    cleanup()
    assert.ok(!fs.existsSync(CACHE_PATH))
    assert.ok(!fs.existsSync(META_PATH))
    // Should not throw
    clearLblCache()
    assert.ok(!fs.existsSync(CACHE_PATH))
    assert.ok(!fs.existsSync(META_PATH))
  })
})

describe('lblCacheMeta()', () => {
  it('returns null when meta file is absent', () => {
    cleanup()
    assert.equal(lblCacheMeta(), null)
  })

  it('returns parsed meta when file exists', () => {
    writeMeta({ fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
    const meta = lblCacheMeta()
    assert.equal(meta.fetchedAt, '2026-08-03T12:00:00.000Z')
    assert.equal(meta.source, 'http://aid:3663')
    cleanup()
  })
})

describe('GrimConfig.invalidate()', () => {
  const GrimConfig = require('../bin/grim-config')

  it('removes cache and prints confirmation', async () => {
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    writeMeta({ fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
    assert.ok(fs.existsSync(CACHE_PATH))

    const output = await new Promise((resolve) => {
      const orig = console.log
      console.log = ( ...args) => resolve(args.join(' '))
      new GrimConfig().invalidate()
      console.log = orig
    })

    assert.equal(output, 'cache cleared')
    assert.ok(!fs.existsSync(CACHE_PATH))
    assert.ok(!fs.existsSync(META_PATH))
    cleanup()
  })
})

describe('GrimConfig.status()', () => {
  const GrimConfig = require('../bin/grim-config')

  it('shows absent cache when no cache exists', async () => {
    cleanup()
    const output = await captureLog(async () => await new GrimConfig().status())
    assert.ok(output.includes('valid:  no (absent)'))
    assert.ok(output.includes('fetched: never'))
  })

  it('shows fetched timestamp and source after sync writes meta', async () => {
    // We can't easily mock the server, so just verify the meta file is read correctly
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    writeMeta({ fetchedAt: '2026-08-03T15:00:00.000Z', source: 'http://aid:3663' })

    const output = await captureLog(async () => await new GrimConfig().status())
    assert.ok(output.includes('valid:  yes'))
    assert.ok(output.includes('fetched: 2026-08-03T15:00:00.000Z'))
    assert.ok(output.includes('source:  http://aid:3663'))

    cleanup()
  })

  it('shows server line when cache is present', async () => {
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    writeMeta({ fetchedAt: '2026-08-03T15:00:00.000Z', source: 'http://aid:3663' })
    const output = await captureLog(async () => await new GrimConfig().status())
    assert.ok(output.includes('valid:  yes'))
    assert.ok(output.includes('fetched: 2026-08-03T15:00:00.000Z'))
    assert.ok(output.includes('source:'))
    cleanup()
  })
})

async function captureLog(fn) {
  const captured = []
  const orig = console.log
  console.log = (...args) => captured.push(args.join(' '))
  try {
    const result = fn()
    if (result && typeof result.then === 'function') await result
  } finally { console.log = orig }
  return captured.join('\n')
}
