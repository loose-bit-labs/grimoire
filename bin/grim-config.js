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
const { config } = require('../lib/env')

const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'config', 'lbl-config.json')
const CACHE_PATH        = path.join(os.homedir(), '.config', 'lbl-config.json')

class GrimConfig {

  // ── local fallback ────────────────────────────────────────────────────────────

  _loadLocal() {
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

    const res    = await axios.get(`${config.host}/config/lbl`, { timeout: 5000 })
    const fresh  = res.data
    const before = fs.existsSync(CACHE_PATH) ? this._safeParse(fs.readFileSync(CACHE_PATH, 'utf8')) : {}

    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(fresh, null, 2) + '\n')

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

  // ── CLI ───────────────────────────────────────────────────────────────────────

  async main() {
    const args = minimist(process.argv.slice(3))
    const sub  = args._[0]

    if (sub === 'get')  return this.get(args._[1])
    if (sub === 'sync') return this.sync()

    console.error('Usage: grim config <get [<path>]|sync>')
    process.exit(1)
  }
}

if (require.main === module) {
  new GrimConfig().main().catch(e => { console.error(e.message); process.exit(1) })
}

module.exports = GrimConfig
