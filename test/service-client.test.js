'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { ServiceClient } = require('../lib/service-client')

// A test subclass that exposes protected methods for testing
class TestClient extends ServiceClient {
  constructor() {
    super('test')
  }
}

describe('ServiceClient', () => {
  describe('resolveUrl()', () => {
    it('prioritizes env var over lbl-config', async () => {
      const c = new TestClient()
      // Save and restore env
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        process.env.GRIMOIRE_TEST_HOST = 'http://env-host:9999'
        assert.strictEqual(c.resolveUrl(), 'http://env-host:9999')
      } finally {
        if (orig === undefined) delete process.env.GRIMOIRE_TEST_HOST
        else process.env.GRIMOIRE_TEST_HOST = orig
      }
    })

    it('returns null when neither env nor lbl-config provides a URL', async () => {
      const c = new TestClient()
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        delete process.env.GRIMOIRE_TEST_HOST
        // lbl-config won't have 'test' key, so should be null
        assert.strictEqual(c.resolveUrl(), null)
      } finally {
        if (orig !== undefined) process.env.GRIMOIRE_TEST_HOST = orig
      }
    })
  })

  describe('baseUrl', () => {
    it('throws when no URL is resolved', async () => {
      const c = new TestClient()
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        delete process.env.GRIMOIRE_TEST_HOST
        assert.throws(() => c.baseUrl, /test: no URL resolved/)
      } finally {
        if (orig !== undefined) process.env.GRIMOIRE_TEST_HOST = orig
      }
    })

    it('returns resolved URL when available', async () => {
      const c = new TestClient()
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        process.env.GRIMOIRE_TEST_HOST = 'http://test:1234'
        assert.strictEqual(c.baseUrl, 'http://test:1234')
      } finally {
        if (orig === undefined) delete process.env.GRIMOIRE_TEST_HOST
        else process.env.GRIMOIRE_TEST_HOST = orig
      }
    })
  })

  describe('available()', () => {
    it('returns false against a dead port', async () => {
      // Use a port that is almost certainly not listening
      const c = new TestClient()
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        process.env.GRIMOIRE_TEST_HOST = 'http://127.0.0.1:1'
        const result = await c.available()
        assert.strictEqual(result, false)
      } finally {
        if (orig === undefined) delete process.env.GRIMOIRE_TEST_HOST
        else process.env.GRIMOIRE_TEST_HOST = orig
      }
    })
  })

  describe('_post()', () => {
    it('throws with service name + URL on connection refused', async () => {
      const c = new TestClient()
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        process.env.GRIMOIRE_TEST_HOST = 'http://127.0.0.1:1'
        await assert.rejects(
          c._post('/test', {}),
          /test at http:\/\/127\.0\.0\.1:1:/
        )
      } finally {
        if (orig === undefined) delete process.env.GRIMOIRE_TEST_HOST
        else process.env.GRIMOIRE_TEST_HOST = orig
      }
    })

    it('throws with "timed out after Xms" on timeout', async () => {
      const c = new TestClient()
      // Use a non-routable address that will timeout, not refuse
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        process.env.GRIMOIRE_TEST_HOST = 'http://10.255.255.1:12345'
        await assert.rejects(
          c._post('/test', {}, { timeout: 500 }),
          /timed out after 500ms/
        )
      } finally {
        if (orig === undefined) delete process.env.GRIMOIRE_TEST_HOST
        else process.env.GRIMOIRE_TEST_HOST = orig
      }
    })
  })

  describe('retry', () => {
    it('retries on failure when retries: N is set', async () => {
      const c = new TestClient()
      const orig = process.env.GRIMOIRE_TEST_HOST
      try {
        process.env.GRIMOIRE_TEST_HOST = 'http://127.0.0.1:1'
        await assert.rejects(
          c._post('/test', {}, { retries: 2 }),
          /test at http:\/\/127\.0\.0\.1:1:/
        )
      } finally {
        if (orig === undefined) delete process.env.GRIMOIRE_TEST_HOST
        else process.env.GRIMOIRE_TEST_HOST = orig
      }
    })
  })

  describe('subclass inheritance', () => {
    it('inherits all base behavior', async () => {
      class SubClient extends ServiceClient {
        constructor() {
          super('sub', { timeout: 5000, retries: 1 })
        }
      }
      const sub = new SubClient()
      assert.strictEqual(sub.serviceName, 'sub')
      assert.strictEqual(sub.timeout, 5000)
      assert.strictEqual(sub.retries, 1)
      assert.strictEqual(typeof sub.resolveUrl, 'function')
      assert.strictEqual(typeof sub.available, 'function')
      assert.strictEqual(typeof sub._post, 'function')
    })
  })
})
