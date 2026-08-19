#!/usr/bin/env node
'use strict'

/**
 * grim-config.js — lbl-config client (config authority CLI)
 *
 * Subcommands:
 *   get [<path>]       Fetch config from the grim-server /config/lbl route.
 *                      Falls back to reading config/lbl-config.json directly
 *                      if the fetch fails and this is a local repo checkout.
 *   sync               Fetch the full config from the server and write it to
 *                      ~/.config/lbl-config.json (last-good cache). Prints
 *                      changed keys, or "unchanged".
 *   invalidate         Discard the local cache; next resolve re-fetches from server.
 *   status             Show cache path, last-fetched timestamp, source, reachability.
 *
 * Canonical source: config/lbl-config.json in this repo (git history is
 * the change log). The server (grim-server.js) reads it fresh per request.
 */

const fs       = require('node:fs')
const os       = require('node:os')
const path     = require('node:path')
const axios    = require('axios')
const minimist = require('minimist')
const { config, refreshLblCache, clearLblCache, lblCacheMeta, _cachePath, _repoConfigPath } = require('../lib/env')

// Note: _cachePath() / _repoConfigPath() are called inline below so tests can
// override them via LBL_CACHE_PATH / _repoConfigPath() env vars without
// hitting Node's require cache.

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
      parsed = JSON.parse(fs.readFileSync(_repoConfigPath(), 'utf8'))
    } catch (e) {
      throw new Error(`Invalid lbl-config.json at ${_repoConfigPath()}: ${e.message}`)
    }
    if (!parsed.endpoints || !parsed.use) {
      throw new Error(`Invalid lbl-config.json at ${_repoConfigPath()}: missing top-level 'endpoints' or 'use' object`)
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
      if (!fs.existsSync(_repoConfigPath())) throw e
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

    const before = fs.existsSync(_cachePath()) ? this._safeParse(fs.readFileSync(_cachePath(), 'utf8')) : {}
    const fresh  = await refreshLblCache()

    const changed = this._changedKeys(before, fresh)
    if (!changed.length) console.log('unchanged')
    else console.log(`changed: ${changed.join(', ')}`)
  }

  // ── invalidate ────────────────────────────────────────────────────────────────

  /**
   * Discard the local lbl-config cache so the next resolve re-fetches from the server.
   * Safe: in local mode (GRIMOIRE_ROOT set), preserves a bootstrap entry so the box
   * never strands with zero endpoints. On clients, preserves GRIMOIRE_HOST if set.
   * Idempotent — no-op if cache is already absent.
   */
  invalidate() {
    const isLocal = !!process.env.GRIMOIRE_ROOT
    const hasHost = !!process.env.GRIMOIRE_HOST

    // Preserve bootstrap for local mode: write a minimal cache with the repo's
    // canonical grimoire endpoint so resolution never returns null.
    if (isLocal) {
      try {
        const repoCfg = JSON.parse(fs.readFileSync(_repoConfigPath(), 'utf8'))
        const grimoireEndpoint = repoCfg.endpoints?.grimoire
        if (!grimoireEndpoint) {
          console.error('error: repo config has no endpoints.grimoire — cannot bootstrap')
          console.error('Set endpoints.grimoire in config/lbl-config.json, or run `grim config sync` after seeding GRIMOIRE_HOST.')
          process.exit(1)
        }
        const bootstrap = {
          endpoints: { grimoire: grimoireEndpoint },
          use:       { grimoire: 'grimoire' },
        }
        fs.mkdirSync(path.dirname(_cachePath()), { recursive: true })
        fs.writeFileSync(_cachePath(), JSON.stringify(bootstrap, null, 2) + '\n')
        fs.writeFileSync(path.join(path.dirname(_cachePath()), 'lbl-config.json.meta'),
          JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'repo-bootstrap' }) + '\n')
        console.log('cache cleared (repo bootstrap preserved)')
        return
      } catch (e) {
        // Repo config absent — fall through to full clear
        console.error(`warning: could not read repo config for bootstrap: ${e.message}`)
      }
    }

    // Client mode: preserve GRIMOIRE_HOST if set so sync can re-populate cache
    if (hasHost) {
      const bootstrap = {
        endpoints: { grimoire: process.env.GRIMOIRE_HOST },
        use:       { grimoire: 'grimoire' },
      }
      fs.mkdirSync(path.dirname(_cachePath()), { recursive: true })
      fs.writeFileSync(_cachePath(), JSON.stringify(bootstrap, null, 2) + '\n')
      fs.writeFileSync(path.join(path.dirname(_cachePath()), 'lbl-config.json.meta'),
        JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'env-bootstrap' }) + '\n')
      console.log('cache cleared (GRIMOIRE_HOST bootstrap preserved)')
      return
    }

    // Unseeded client with no bootstrap: clear and warn
    clearLblCache()
    console.log('cache cleared')
    console.error('warning: no GRIMOIRE_HOST and no repo config — run `grim config sync` after setting endpoints.grimoire')
  }

  // ── status ────────────────────────────────────────────────────────────────────

  /**
   * Show cache path, last-fetched timestamp, source URL, and server reachability.
   */
  async status() {
    const meta = lblCacheMeta()
    const hasCache = fs.existsSync(_cachePath())

    console.log(`  cache:  ${_cachePath()}`)
    if (hasCache) {
      console.log(`  valid:  yes`)
    } else {
      console.log(`  valid:  no (absent)`)
    }
    if (meta) {
      console.log(`  fetched: ${meta.fetchedAt}`)
      console.log(`  source:  ${meta.source}`)
    } else {
      console.log(`  fetched: never`)
    }

    // Check server reachability
    if (config.host) {
      try {
        await axios.get(`${config.host}/config/lbl`, { timeout: 2000 })
        console.log(`  server: reachable`)
      } catch {
        console.log(`  server: unreachable`)
      }
    } else {
      console.log(`  server: not configured`)
    }
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
  async gen(format) {
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
   * Emits bare hostnames (no .grim suffix) — the canonical scheme per phase 44.
   * @param {object} endpoints
   */
  async _genHosts(endpoints) {
    const entries = Object.entries(endpoints).sort((a, b) => a[0].localeCompare(b[0]))
    const dns = require('node:dns').promises
    const lines = await Promise.all(
      entries.map(async ([key, url]) => {
        const parsed = new URL(url)
        const host = parsed.hostname
        // Resolve hostname to IP if it looks like a hostname (not an IP literal)
        const ip = await this._resolveHost(dns, host)
        return `${ip} ${key}`
      })
    )
    console.log(lines.join('\n'))
  }

  /**
   * Resolve a hostname to an IP address. Returns the input if resolution fails.
   * @param {object} dns — require('node:dns').promises
   * @param {string} hostname
   * @returns {Promise<string>}
   */
  async _resolveHost(dns, hostname) {
    try {
      const { address } = await dns.lookup(hostname)
      return address || hostname
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
   * Uses bare hostnames (no .grim suffix) — the canonical scheme per phase 44.
   * @param {object} endpoints
   */
  _genCaddy(endpoints) {
    const blocks = []
    for (const [key, url] of Object.entries(endpoints).sort((a, b) => a[0].localeCompare(b[0]))) {
      blocks.push(`${key} {\n    reverse_proxy ${url}\n}`)
    }
    console.log(blocks.join('\n\n'))
  }

  // ── CLI ───────────────────────────────────────────────────────────────────────

  async main() {
    const args = minimist(process.argv.slice(3))
    const sub  = args._[0]

    if (sub === 'get')     return this.get(args._[1])
    if (sub === 'sync')    return this.sync()
    if (sub === 'invalidate') return this.invalidate()
    if (sub === 'status')  return this.status()
    if (sub === 'gen')     return this.gen(args._[1])

    // Direct invocation: `node bin/grim-config.js gen <format>` (no 'config' token)
    const knownFormats = ['hosts', 'probes', 'caddy']
    if (knownFormats.includes(sub)) return this.gen(sub)

    console.error('Usage: grim config <get [<path>]|sync|invalidate|status|gen <hosts|probes|caddy>>')
    process.exit(1)
  }
}

if (require.main === module) {
  new GrimConfig().main().catch(e => { console.error(e.message); process.exit(1) })
}

module.exports = GrimConfig
