'use strict'

/**
 * test/config-cache.test.js — lbl-config cache tests (isolated temp dir)
 *
 * Sets LBL_CACHE_PATH / LBL_META_PATH to per-test temp paths so the suite
 * never touches the live ~/.config/lbl-config.json.  Sets LOCAL_CONFIG_PATH
 * to a temp file for tests that call GrimConfig.invalidate() so they are
 * immune to config-gen.test.js modifying the real repo config in parallel.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// ── per-test helpers ──────────────────────────────────────────────────────────

function makeTestEnv() {
  const dir = path.join(os.tmpdir(), 'grim-cache-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  const cache = path.join(dir, 'lbl-config.json')
  const meta  = path.join(dir, 'lbl-config.json.meta')
  return { dir, cache, meta,
    setEnv() { process.env.LBL_CACHE_PATH = cache; process.env.LBL_META_PATH  = meta },
    cleanup() { try { fs.rmSync(this.dir, { recursive: true, force: true }) } catch {} }
  }
}

/**
 * Create a temp repo-config file and point LOCAL_CONFIG_PATH at it.
 * Returns { path, cleanup() }.
 */
function makeTestConfig() {
  const dir = path.join(os.tmpdir(), 'grim-config-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  const cfgPath = path.join(dir, 'lbl-config.json')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cfgPath, JSON.stringify({
    endpoints: { grimoire: 'http://aid:3663', aid: 'http://aid:11311' },
    use:       { grimoire: 'grimoire' },
  }, null, 2) + '\n')
  return { path: cfgPath,
    setEnv() { process.env.LOCAL_CONFIG_PATH = cfgPath },
    cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
  }
}

function writeCache(env, obj) {
  fs.mkdirSync(path.dirname(env.cache), { recursive: true })
  fs.writeFileSync(env.cache, JSON.stringify(obj, null, 2) + '\n')
}

function writeMeta(env, obj) {
  fs.mkdirSync(path.dirname(env.meta), { recursive: true })
  fs.writeFileSync(env.meta, JSON.stringify(obj, null, 2) + '\n')
}

// ── clearLblCache() ───────────────────────────────────────────────────────────

describe('clearLblCache()', () => {
  it('removes both cache and meta files', () => {
    const env = makeTestEnv()
    env.setEnv()
    writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
    writeMeta(env, { fetchedAt: '2026-01-01T00:00:00.000Z', source: 'http://aid:3663' })
    assert.ok(fs.existsSync(env.cache))
    assert.ok(fs.existsSync(env.meta))

    const { clearLblCache } = require('../lib/env')
    clearLblCache()
    assert.ok(!fs.existsSync(env.cache))
    assert.ok(!fs.existsSync(env.meta))
    env.cleanup()
  })

  it('is idempotent — no-op when files are absent', () => {
    const env = makeTestEnv()
    env.setEnv()
    const { clearLblCache } = require('../lib/env')
    clearLblCache() // should not throw
    clearLblCache() // idempotent
    env.cleanup()
  })
})

// ── lblCacheMeta() ────────────────────────────────────────────────────────────

describe('lblCacheMeta()', () => {
  it('returns null when meta file is absent', () => {
    const env = makeTestEnv()
    env.setEnv()
    const { lblCacheMeta, clearLblCache } = require('../lib/env')
    clearLblCache()
    assert.equal(lblCacheMeta(), null)
    env.cleanup()
  })

  it('returns parsed meta when file exists', () => {
    const env = makeTestEnv()
    env.setEnv()
    const { lblCacheMeta, clearLblCache } = require('../lib/env')
    writeMeta(env, { fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
    const meta = lblCacheMeta()
    assert.equal(meta.fetchedAt, '2026-08-03T12:00:00.000Z')
    assert.equal(meta.source, 'http://aid:3663')
    clearLblCache()
    env.cleanup()
  })
})

// ── GrimConfig.invalidate() ───────────────────────────────────────────────────

describe('GrimConfig.invalidate()', () => {
  it('removes cache and prints confirmation on unseeded client', async () => {
    const env = makeTestEnv()
    const cfg = makeTestConfig()
    env.setEnv()
    cfg.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    delete process.env.GRIMOIRE_ROOT
    try {
      writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
      writeMeta(env, { fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
      assert.ok(fs.existsSync(env.cache))

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
      assert.ok(!fs.existsSync(env.cache))
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      clearLblCache()
      env.cleanup()
      cfg.cleanup()
      delete process.env.LOCAL_CONFIG_PATH
    }
  })
})

// ── GrimConfig.status() ───────────────────────────────────────────────────────

describe('GrimConfig.status()', () => {
  it('shows absent cache when no cache exists', async () => {
    const env = makeTestEnv()
    env.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    clearLblCache()
    const output = await captureLog(async () => await new GrimConfig().status())
    assert.ok(output.includes('valid:  no (absent)'))
    assert.ok(output.includes('fetched: never'))
    env.cleanup()
  })

  it('shows fetched timestamp and source after sync writes meta', async () => {
    const env = makeTestEnv()
    env.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
    writeMeta(env, { fetchedAt: '2026-08-03T15:00:00.000Z', source: 'http://aid:3663' })
    try {
      const output = await captureLog(async () => await new GrimConfig().status())
      assert.ok(output.includes('valid:  yes'))
      assert.ok(output.includes('fetched: 2026-08-03T15:00:00.000Z'))
      assert.ok(output.includes('source:  http://aid:3663'))
    } finally {
      clearLblCache()
      env.cleanup()
    }
  })

  it('shows server line when cache is present', async () => {
    const env = makeTestEnv()
    env.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
    writeMeta(env, { fetchedAt: '2026-08-03T15:00:00.000Z', source: 'http://aid:3663' })
    try {
      const output = await captureLog(async () => await new GrimConfig().status())
      assert.ok(output.includes('valid:  yes'))
      assert.ok(output.includes('fetched: 2026-08-03T15:00:00.000Z'))
      assert.ok(output.includes('source:'))
    } finally {
      clearLblCache()
      env.cleanup()
    }
  })
})

// ── lblEndpoint() local-mode fallback ─────────────────────────────────────────

describe('lblEndpoint() local-mode fallback', () => {
  it('falls back to repo config when cache is absent and GRIMOIRE_ROOT is set', () => {
    const env = makeTestEnv()
    const cfg = makeTestConfig()
    env.setEnv()
    cfg.setEnv()
    const { lblEndpoint, clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    process.env.GRIMOIRE_ROOT = '/fake/grimoire-root'
    try {
      clearLblCache()
      assert.ok(!fs.existsSync(env.cache), 'cache should be absent after clearLblCache')
      const endpoint = lblEndpoint('grimoire')
      assert.equal(endpoint, 'http://aid:3663')
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      clearLblCache()
      env.cleanup()
      cfg.cleanup()
      delete process.env.LOCAL_CONFIG_PATH
    }
  })

  it('returns null for unknown endpoint even with repo fallback', () => {
    const env = makeTestEnv()
    const cfg = makeTestConfig()
    env.setEnv()
    cfg.setEnv()
    const { lblEndpoint, clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    process.env.GRIMOIRE_ROOT = '/fake/grimoire-root'
    try {
      clearLblCache()
      const endpoint = lblEndpoint('nonexistent')
      assert.equal(endpoint, null)
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      clearLblCache()
      env.cleanup()
      cfg.cleanup()
      delete process.env.LOCAL_CONFIG_PATH
    }
  })

  it('returns null when GRIMOIRE_ROOT is not set and cache is absent', () => {
    const env = makeTestEnv()
    env.setEnv()
    const { lblEndpoint, clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    delete process.env.GRIMOIRE_ROOT
    try {
      clearLblCache()
      const endpoint = lblEndpoint('grimoire')
      assert.equal(endpoint, null)
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      clearLblCache()
      env.cleanup()
    }
  })
})

// ── GrimConfig.invalidate() safety ────────────────────────────────────────────

describe('GrimConfig.invalidate() safety', () => {
  it('preserves repo bootstrap in local mode', async () => {
    const env = makeTestEnv()
    const cfg = makeTestConfig()
    env.setEnv()
    cfg.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    const origHost = process.env.GRIMOIRE_HOST
    process.env.GRIMOIRE_ROOT = '/fake/grimoire-root'
    delete process.env.GRIMOIRE_HOST
    try {
      writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
      writeMeta(env, { fetchedAt: '2026-08-03T12:00:00.000Z', source: 'http://aid:3663' })
      assert.ok(fs.existsSync(env.cache), 'cache should exist before invalidate')

      const output = await new Promise((resolve) => {
        const orig = console.log
        console.log = (...args) => resolve(args.join(' '))
        new GrimConfig().invalidate()
        console.log = orig
      })

      assert.ok(output.includes('repo bootstrap preserved'), `expected bootstrap message, got: ${output}`)
      assert.ok(fs.existsSync(env.cache))
      const cached = JSON.parse(fs.readFileSync(env.cache, 'utf8'))
      assert.equal(cached.endpoints.grimoire, 'http://aid:3663')
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      if (origHost === undefined) delete process.env.GRIMOIRE_HOST
      else process.env.GRIMOIRE_HOST = origHost
      clearLblCache()
      env.cleanup()
      cfg.cleanup()
      delete process.env.LOCAL_CONFIG_PATH
    }
  })

  it('preserves GRIMOIRE_HOST bootstrap on clients', async () => {
    const env = makeTestEnv()
    const cfg = makeTestConfig()
    env.setEnv()
    cfg.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    const origHost = process.env.GRIMOIRE_HOST
    delete process.env.GRIMOIRE_ROOT
    process.env.GRIMOIRE_HOST = 'http://aid:3663'
    try {
      writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
      assert.ok(fs.existsSync(env.cache))

      const output = await new Promise((resolve) => {
        const orig = console.log
        console.log = (...args) => resolve(args.join(' '))
        new GrimConfig().invalidate()
        console.log = orig
      })

      assert.ok(output.includes('GRIMOIRE_HOST bootstrap preserved'))
      assert.ok(fs.existsSync(env.cache))
      const cached = JSON.parse(fs.readFileSync(env.cache, 'utf8'))
      assert.equal(cached.endpoints.grimoire, 'http://aid:3663')
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      if (origHost === undefined) delete process.env.GRIMOIRE_HOST
      else process.env.GRIMOIRE_HOST = origHost
      clearLblCache()
      env.cleanup()
      cfg.cleanup()
      delete process.env.LOCAL_CONFIG_PATH
    }
  })

  it('clears fully on unseeded client with warning', async () => {
    const env = makeTestEnv()
    const cfg = makeTestConfig()
    env.setEnv()
    cfg.setEnv()
    const GrimConfig = require('../bin/grim-config')
    const { clearLblCache } = require('../lib/env')
    const origRoot = process.env.GRIMOIRE_ROOT
    const origHost = process.env.GRIMOIRE_HOST
    delete process.env.GRIMOIRE_ROOT
    delete process.env.GRIMOIRE_HOST
    try {
      writeCache(env, { endpoints: { aid: 'http://aid:3663' } })
      assert.ok(fs.existsSync(env.cache))

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
      assert.ok(!fs.existsSync(env.cache))
    } finally {
      if (origRoot === undefined) delete process.env.GRIMOIRE_ROOT
      else process.env.GRIMOIRE_ROOT = origRoot
      if (origHost === undefined) delete process.env.GRIMOIRE_HOST
      else process.env.GRIMOIRE_HOST = origHost
      clearLblCache()
      env.cleanup()
      cfg.cleanup()
      delete process.env.LOCAL_CONFIG_PATH
    }
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
