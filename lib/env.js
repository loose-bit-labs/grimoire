'use strict'

/**
 * lib/env.js — Grimoire environment loader
 *
 * Resolution order for each value:
 *   1. Environment variable (process.env)
 *   2. ~/.config/lbl-config.json  (shared homelab topology)
 *   3. Hardcoded fallback
 *
 * .env in the engine root is still loaded for GRIMOIRE_ROOT and
 * GRIMOIRE_PORT, which are server-local and not in lbl-config.
 */

const fs    = require('node:fs')
const path  = require('node:path')
const os    = require('node:os')
const axios = require('axios')

// Load .env for server-local keys (GRIMOIRE_ROOT, GRIMOIRE_PORT, etc.)
const ENV_FILE = path.join(__dirname, '..', '.env')
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const LBL_CACHE_PATH = path.join(os.homedir(), '.config', 'lbl-config.json')
const LBL_META_PATH  = path.join(os.homedir(), '.config', 'lbl-config.json.meta')

// Read shared homelab topology — endpoints.<key> or use.<key> → endpoints[use.<key>]
function _lbl() {
  try { return JSON.parse(fs.readFileSync(LBL_CACHE_PATH, 'utf8')) }
  catch { return {} }
}
function lblEndpoint(key) {
  const c = _lbl()
  return c.endpoints?.[key] ?? c.endpoints?.[c.use?.[key]] ?? null
}
// Alias for internal use
const _lblEndpoint = lblEndpoint

/**
 * Fetch the canonical lbl-config from the grimoire server and refresh the
 * last-good cache. Async consumers that care about freshness call this once
 * at task start. Never throws, never deletes the cache — on any failure
 * (no server configured, unreachable, timeout) falls back to the cache on
 * disk (or {} if there is none).
 * @returns {Promise<object>}
 */
async function refreshLblCache() {
  if (!config.host) return _lbl()
  try {
    const res = await axios.get(`${config.host}/config/lbl`, { timeout: 2000 })
    const fresh = res.data
    fs.mkdirSync(path.dirname(LBL_CACHE_PATH), { recursive: true })
    fs.writeFileSync(LBL_CACHE_PATH, JSON.stringify(fresh, null, 2) + '\n')
    fs.writeFileSync(LBL_META_PATH, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source:    config.host,
    }) + '\n')
    return fresh
  } catch {
    return _lbl()
  }
}

/**
 * Remove the local lbl-config cache (and its freshness sidecar).
 * Idempotent — no-op if files are already absent.
 */
function clearLblCache() {
  try { fs.unlinkSync(LBL_CACHE_PATH) } catch { /* absent */ }
  try { fs.unlinkSync(LBL_META_PATH)  } catch { /* absent */ }
}

/**
 * Read the freshness sidecar. Returns null if absent.
 */
function lblCacheMeta() {
  try { return JSON.parse(fs.readFileSync(LBL_META_PATH, 'utf8')) }
  catch { return null }
}

const config = {
  // Path to the grimoire-kb directory (local mode)
  root:   process.env.GRIMOIRE_ROOT || null,

  // Grimoire server address (remote mode)
  host:   process.env.GRIMOIRE_HOST || _lblEndpoint('grimoire') || null,

  // Ollama base URL
  ollama: process.env.OLLAMA_HOST   || _lblEndpoint('ollama')   || 'http://aid:11434',

  // Server port (when running grim-server on this machine)
  port:   parseInt(process.env.GRIMOIRE_PORT || '3663', 10),
}

// Local mode: GRIMOIRE_ROOT is set and the KB directory exists
const isLocal = !!(config.root && fs.existsSync(config.root))

// Remote mode: GRIMOIRE_HOST is set (server running somewhere on LAN)
const isRemote = !!(config.host)

/**
 * Assert that at least one mode is available, exit with a helpful message if not.
 * @param {'local'|'remote'|'any'} required
 */
function requireMode(required = 'any') {
  if (required === 'local' && !isLocal) {
    console.error('This command requires direct KB access (GRIMOIRE_ROOT).')
    console.error('Set GRIMOIRE_ROOT in .env (server) or run grim on the KB host.')
    process.exit(1)
  }
  if (required === 'remote' && !isRemote) {
    console.error('This command requires a running Grimoire server (GRIMOIRE_HOST).')
    console.error('Set endpoints.grimoire in ~/.config/lbl-config.json, or GRIMOIRE_HOST in .env.')
    process.exit(1)
  }
  if (required === 'any' && !isLocal && !isRemote) {
    console.error('Grimoire is not configured.')
    console.error('Set GRIMOIRE_ROOT (local) or endpoints.grimoire in ~/.config/lbl-config.json (remote).')
    process.exit(1)
  }
}

/**
 * Resolve Google Custom Search API key + CX engine ID.
 *
 * Resolution order:
 *   1. Environment variables GRIMOIRE_GOOGLE_SEARCH / GRIMOIRE_GOOGLE_CX
 *   2. ~/.config/api-keys/keys.json (google-search / google-search-cx fields)
 *   3. lbl-config.json registry (google-search / google-search-cx)
 * @returns {{key: string, cx: string}|null}
 */
function resolveGoogleCseKeys() {
  // 1. Environment variables
  if (process.env.GRIMOIRE_GOOGLE_SEARCH && process.env.GRIMOIRE_GOOGLE_CX) {
    return { key: process.env.GRIMOIRE_GOOGLE_SEARCH, cx: process.env.GRIMOIRE_GOOGLE_CX }
  }

  // 2. ~/.config/api-keys/keys.json
  const apiKeysPath = path.join(os.homedir(), '.config', 'api-keys', 'keys.json')
  try {
    const keys = JSON.parse(fs.readFileSync(apiKeysPath, 'utf8'))
    const k = keys['google-search'] || keys['google-search-text']
    if (k) {
      return { key: k, cx: keys['google-search-cx'] || '' }
    }
  } catch { /* not found */ }

  // 3. lbl-config.json registry
  const lbl = _lbl()
  const gs = lbl['google-search'] || lbl.endpoints?.['google-search']
  const gc = lbl['google-search-cx'] || lbl.endpoints?.['google-search-cx']
  if (gs && gc) {
    return { key: gs, cx: gc }
  }

  return null
}

module.exports = { config, isLocal, isRemote, requireMode, lblEndpoint, refreshLblCache, clearLblCache, lblCacheMeta, resolveGoogleCseKeys }
