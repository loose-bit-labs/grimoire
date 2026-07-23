'use strict'

/**
 * service-client.js — base class for Grimoire service HTTP clients
 *
 * Resolves service URLs through env → lbl-config → fallback.
 * Owns timeout, fail-fast errors, availability probes, and opt-in retry.
 */

const axios = require('axios')
const { lblEndpoint } = require('./env')

class ServiceClient {
  /**
   * @param {string} serviceName — key used for env var and lbl-config lookup
   * @param {object} [opts]
   * @param {number} [opts.timeout] — default request timeout in ms
   * @param {number} [opts.retries] — default retry count (0 = no retry)
   */
  constructor(serviceName, opts = {}) {
    this.serviceName = serviceName
    this.timeout = opts.timeout ?? 10_000
    this.retries = opts.retries ?? 0
    this._axios = axios.create({ timeout: this.timeout })
  }

  /** Resolve the service base URL. Throws if no source provides one. */
  get baseUrl() {
    const url = this.resolveUrl()
    if (!url) {
      const key = this._envKey()
      throw new Error(
        `${this.serviceName}: no URL resolved — set ${key} or endpoints.${this.serviceName} in lbl-config`
      )
    }
    return url
  }

  /** Look up the env var name for this service. */
  _envKey() {
    return `GRIMOIRE_${this.serviceName.toUpperCase()}_HOST`
  }

  /**
   * Resolve URL: env var > lbl-config > null.
   * @returns {string|null}
   */
  resolveUrl() {
    const envKey = this._envKey()
    return process.env[envKey] || lblEndpoint(this.serviceName) || null
  }

  /**
   * Check if the service is reachable. Returns boolean, never throws.
   * @returns {Promise<boolean>}
   */
  async available() {
    try {
      await this._axios.get(`${this.baseUrl}/health`, { timeout: 3_000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Make a POST request. Throws on failure with service+URL context.
   * @param {string} endpoint
   * @param {object} body
   * @param {object} [opts] — per-call { timeout, retries } overrides
   * @returns {Promise<object>}
   */
  async _post(endpoint, body, opts = {}) {
    const timeout = opts.timeout ?? this.timeout
    const retries = opts.retries ?? this.retries
    const url = `${this.baseUrl}${endpoint}`

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this._axios.post(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout,
        })
        return res.data
      } catch (err) {
        if (attempt === retries) {
          const name = this.serviceName
          const base = this.baseUrl
          const detail = err.code === 'ECONNABORTED'
            ? `timed out after ${timeout}ms`
            : err.message.split('\n')[0]
          throw new Error(`${name} at ${base}: ${detail}`)
        }
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)))
      }
    }
  }
}

module.exports = { ServiceClient }
