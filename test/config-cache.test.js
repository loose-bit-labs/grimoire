'use strict'

const { describe, it, before, after, afterEach } = require('node:test')
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
  const originalRoot = process.env.GRIMOIRE_ROOT

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.GRIMOIRE_ROOT
    else process.env.GRIMOIRE_ROOT = originalRoot
    cleanup()
  })

  it('removes cache and prints confirmation on unseeded client', async () => {
    delete process.env.GRIMOIRE_ROOT
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    writeMeta({ fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
    assert.ok(fs.existsSync(CACHE_PATH))

    const logs = []
    const errors = []
    const output = await new Promise((resolve) => {
      const origLog = console.log
      const origErr = console.error
      console.log = (...args) => logs.push(args.join(' '))
      console.error = (...args) => errors.push(args.join(' '))
      new GrimConfig().invalidate()
      console.log = origLog
      console.error = origErr
      resolve({ log: logs.join('\n'), err: errors.join('\n') })
    })

    assert.ok(output.log.includes('cache cleared'))
    assert.ok(output.err.includes('warning'))
    assert.ok(!fs.existsSync(CACHE_PATH))
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

describe('lblEndpoint() local-mode fallback', () => {
  const { lblEndpoint } = require('../lib/env')
  const originalEnv = process.env.GRIMOIRE_ROOT

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GRIMOIRE_ROOT
    else process.env.GRIMOIRE_ROOT = originalEnv
    cleanup()
  })

  it('falls back to repo config when cache is absent and GRIMOIRE_ROOT is set', () => {
    process.env.GRIMOIRE_ROOT = '/fake/grimoire-root'
    cleanup()
    // Repo config exists with grimoire endpoint
    const endpoint = lblEndpoint('grimoire')
    assert.equal(endpoint, 'http://aid:3663')
  })

  it('returns null for unknown endpoint even with repo fallback', () => {
    process.env.GRIMOIRE_ROOT = '/fake/grimoire-root'
    cleanup()
    const endpoint = lblEndpoint('nonexistent')
    assert.equal(endpoint, null)
  })

  it('returns null when GRIMOIRE_ROOT is not set and cache is absent', () => {
    delete process.env.GRIMOIRE_ROOT
    cleanup()
    const endpoint = lblEndpoint('grimoire')
    assert.equal(endpoint, null)
  })
})

describe('GrimConfig.invalidate() safety', () => {
  const GrimConfig = require('../bin/grim-config')
  const originalEnv = process.env.GRIMOIRE_ROOT
  const originalHost = process.env.GRIMOIRE_HOST

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GRIMOIRE_ROOT
    else process.env.GRIMOIRE_ROOT = originalEnv
    if (originalHost === undefined) delete process.env.GRIMOIRE_HOST
    else process.env.GRIMOIRE_HOST = originalHost
    cleanup()
  })

  it('preserves repo bootstrap in local mode', async () => {
    process.env.GRIMOIRE_ROOT = '/fake/grimoire-root'
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    writeMeta({ fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
    assert.ok(fs.existsSync(CACHE_PATH))

    const output = await new Promise((resolve) => {
      const orig = console.log
      console.log = (...args) => resolve(args.join(' '))
      new GrimConfig().invalidate()
      console.log = orig
    })

    assert.ok(output.includes('repo bootstrap preserved'))
    assert.ok(fs.existsSync(CACHE_PATH))
    // Cache should have grimoire endpoint from repo
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    assert.equal(cached.endpoints.grimoire, 'http://aid:3663')
  })

  it('preserves GRIMOIRE_HOST bootstrap on clients', async () => {
    delete process.env.GRIMOIRE_ROOT
    process.env.GRIMOIRE_HOST = 'http://aid:3663'
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    assert.ok(fs.existsSync(CACHE_PATH))

    const output = await new Promise((resolve) => {
      const orig = console.log
      console.log = (...args) => resolve(args.join(' '))
      new GrimConfig().invalidate()
      console.log = orig
    })

    assert.ok(output.includes('GRIMOIRE_HOST bootstrap preserved'))
    assert.ok(fs.existsSync(CACHE_PATH))
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    assert.equal(cached.endpoints.grimoire, 'http://aid:3663')
  })

  it('clears fully on unseeded client with warning', async () => {
    delete process.env.GRIMOIRE_ROOT
    delete process.env.GRIMOIRE_HOST
    writeCache({ endpoints: { aid: 'http://aid:3663' } })
    assert.ok(fs.existsSync(CACHE_PATH))

    const logs = []
    const origLog = console.log
    const origErr = console.error
    await new Promise((resolve) => {
      console.log = (...args) => logs.push('log: ' + args.join(' '))
      console.error = (...args) => logs.push('err: ' + args.join(' '))
      new GrimConfig().invalidate()
      console.log = origLog
      console.error = origErr
      resolve()
    })

    assert.ok(logs.some(l => l.includes('cache cleared')))
    assert.ok(logs.some(l => l.includes('warning')))
    assert.ok(!fs.existsSync(CACHE_PATH))
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
