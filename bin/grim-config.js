#!/usr/bin/env node
'use strict'

/**
 * grim-config.js — lbl-config client (config authority CLI)
 *
 * Subcommands:
 *   get [<path>]   Fetch config from the grim-server /config/lbl route.
 *                  Falls back to reading config/lbl-config.json directly
 *                  if the fetch fails and this is a local repo checkout.
 *   sync           Fetch the full config from the server and write it to
 *                  ~/.config/lbl-config.json (last-good cache). Prints
 *                  changed keys, or "unchanged".
 *
 * Canonical source: config/lbl-config.json in this repo (git history is
 * the change log). The server (grim-server.js) reads it fresh per request.
 */

const fs       = require('node:fs')
const os       = require('node:os')
const path     = require('node:path')
const axios    = require('axios')
const minimist = require('minimist')
const { config, refreshLblCache } = require('../lib/env')

const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'config', 'lbl-config.json')
const CACHE_PATH        = path.join(os.homedir(), '.config', 'lbl-config.json')

class GrimConfig {

  // ── config loading ────────────────────────────────────────────────────────────

  _loadLocal() {
    return this._loadConfig()
  }

  /**
   * Parse and validate the local config file.
   * @returns {object}
   */
  _loadConfig() {
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'))
    } catch (e) {
      throw new Error(`Invalid lbl-config.json at ${LOCAL_CONFIG_PATH}: ${e.message}`)
    }
    if (!parsed.endpoints || !parsed.use) {
      throw new Error(`Invalid lbl-config.json at ${LOCAL_CONFIG_PATH}: missing top-level 'endpoints' or 'use' object`)
    }
    return parsed
  }

  _dotGet(obj, dotPath) {
    return dotPath.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj)
  }

  // ── get ───────────────────────────────────────────────────────────────────────

  async get(dotPath) {
    let result
    try {
      if (!config.host) throw new Error('no server configured')
      const res = await axios.get(`${config.host}/config/lbl`, {
        params:  dotPath ? { path: dotPath } : {},
        timeout: 5000,
      })
      result = dotPath ? res.data.value : res.data
    } catch (e) {
      if (!fs.existsSync(LOCAL_CONFIG_PATH)) throw e
      const cfg = this._loadLocal()
      result = dotPath ? this._dotGet(cfg, dotPath) : cfg
      if (dotPath && result === undefined) throw new Error(`path not found: ${dotPath}`)
    }

    if (typeof result === 'object') console.log(JSON.stringify(result, null, 2))
    else console.log(result)
  }

  // ── sync ──────────────────────────────────────────────────────────────────────

  async sync() {
    if (!config.host) { console.error('No server configured (endpoints.grimoire in ~/.config/lbl-config.json or GRIMOIRE_HOST).'); process.exit(1) }

    const before = fs.existsSync(CACHE_PATH) ? this._safeParse(fs.readFileSync(CACHE_PATH, 'utf8')) : {}
    const fresh  = await refreshLblCache()

    const changed = this._changedKeys(before, fresh)
    if (!changed.length) console.log('unchanged')
    else console.log(`changed: ${changed.join(', ')}`)
  }

  _safeParse(text) {
    try { return JSON.parse(text) } catch { return {} }
  }

  _changedKeys(before, after, prefix = '') {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
    const changed = []
    for (const key of keys) {
      const path_  = prefix ? `${prefix}.${key}` : key
      const b = before?.[key]
      const a = after?.[key]
      if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && !Array.isArray(a)) {
        changed.push(...this._changedKeys(b, a, path_))
      } else if (JSON.stringify(a) !== JSON.stringify(b)) {
        changed.push(path_)
      }
    }
    return changed
  }

  // ── gen ───────────────────────────────────────────────────────────────────────

  /**
   * Generate derived views from the config registry.
   * @param {string} format — 'hosts', 'probes', or 'caddy'
   */
  gen(format) {
    const cfg = this._loadConfig()
    const endpoints = cfg.endpoints

    if (!endpoints || typeof endpoints !== 'object' || Object.keys(endpoints).length === 0) {
      console.error('Error: no endpoints defined in config')
      process.exit(1)
    }

    switch (format) {
      case 'hosts': return this._genHosts(endpoints)
      case 'probes': return this._genProbes(endpoints)
      case 'caddy': return this._genCaddy(endpoints)
      default:
        console.error(`Usage: grim config gen <hosts|probes|caddy>`)
        process.exit(1)
    }
  }

  /**
   * Generate /etc/hosts-style block.
   * @param {object} endpoints
   */
  _genHosts(endpoints) {
    const lines = []
    for (const [key, url] of Object.entries(endpoints).sort((a, b) => a[0].localeCompare(b[0]))) {
      const parsed = new URL(url)
      const host = parsed.hostname
      // Resolve hostname to IP if it looks like a hostname (not an IP literal)
      const ip = this._resolveHost(host)
      lines.push(`${ip} ${key}.grim`)
    }
    console.log(lines.join('\n'))
  }

  /**
   * Resolve a hostname to an IP address. Returns the input if resolution fails.
   * @param {string} hostname
   * @returns {string}
   */
  _resolveHost(hostname) {
    try {
      const dns = require('node:dns')
      const result = dns.lookup(hostname, { all: false })
      return result || hostname
    } catch {
      return hostname
    }
  }

  /**
   * Generate JSON probe list.
   * @param {object} endpoints
   */
  _genProbes(endpoints) {
    const probes = []
    for (const [key, url] of Object.entries(endpoints).sort((a, b) => a[0].localeCompare(b[0]))) {
      probes.push({ name: key, url })
    }
    console.log(JSON.stringify(probes, null, 2))
  }

  /**
   * Generate Caddyfile text.
   * @param {object} endpoints
   */
  _genCaddy(endpoints) {
    const blocks = []
    for (const [key, url] of Object.entries(endpoints).sort((a, b) => a[0].localeCompare(b[0]))) {
      blocks.push(`${key}.grim {\n    reverse_proxy ${url}\n}`)
    }
    console.log(blocks.join('\n\n'))
  }

  // ── CLI ───────────────────────────────────────────────────────────────────────

  async main() {
    const args = minimist(process.argv.slice(3))
    const sub  = args._[0]

    if (sub === 'get')  return this.get(args._[1])
    if (sub === 'sync') return this.sync()
    if (sub === 'gen')  return this.gen(args._[1])

    // Direct invocation: `node bin/grim-config.js gen <format>` (no 'config' token)
    const knownFormats = ['hosts', 'probes', 'caddy']
    if (knownFormats.includes(sub)) return this.gen(sub)

    console.error('Usage: grim config <get [<path>]|sync|gen <hosts|probes|caddy>>')
    process.exit(1)
  }
}

if (require.main === module) {
  new GrimConfig().main().catch(e => { console.error(e.message); process.exit(1) })
}

module.exports = GrimConfig
