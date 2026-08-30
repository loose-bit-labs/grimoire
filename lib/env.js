'use strict'

/**
 * lib/env.js — Grimoire environment loader
 *
 * Resolution order for each value:
 *   1. Environment variable (process.env)
 *   2. ~/.config/lbl-config.json  (shared homelab topology, deep-merged over
 *      the repo's canonical config/lbl-config.json as a floor — a
 *      present-but-partial cache can no longer hide a key the repo defines)
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

function _cachePath() { return process.env.LBL_CACHE_PATH || path.join(os.homedir(), '.config', 'lbl-config.json') }
function _metaPath()  { return process.env.LBL_META_PATH  || path.join(os.homedir(), '.config', 'lbl-config.json.meta') }
function _repoConfigPath() { return process.env.LOCAL_CONFIG_PATH || path.join(__dirname, '..', 'config', 'lbl-config.json') }

// Read shared homelab topology — endpoints.<key> or use.<key> → endpoints[use.<key>]
// The repo's canonical config (config/lbl-config.json) is a merge-floor: the
// user-space cache is deep-merged over it, so a present-but-partial (decayed
// stub) cache can no longer remove a key the repo defines. Precedence:
// env var (applied by consumers) > cache overlay > repo floor.
function _mergeFloor(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return overlay ?? base
  if (!base  || typeof base  !== 'object' || Array.isArray(base))  return overlay
  const out = { ...base }
  for (const [k, v] of Object.entries(overlay)) out[k] = _mergeFloor(base[k], v)
  return out
}
function _floor() {
  try { return JSON.parse(fs.readFileSync(_repoConfigPath(), 'utf8')) }
  catch { return {} }   // repo config absent (bare install) — floor is empty
}
function _lbl() {
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(_cachePath(), 'utf8')) }
  catch { /* cache absent or unreadable — floor alone */ }
  return _mergeFloor(_floor(), cache)
}
// Full merged config (repo floor + cache overlay) — for consumers that need
// sections other than endpoints/use (models, ports, keys).
function lblConfig() { return _lbl() }
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
    fs.mkdirSync(path.dirname(_cachePath()), { recursive: true })
    fs.writeFileSync(_cachePath(), JSON.stringify(fresh, null, 2) + '\n')
    fs.writeFileSync(_metaPath(), JSON.stringify({
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
  try { fs.unlinkSync(_cachePath()) } catch { /* absent */ }
  try { fs.unlinkSync(_metaPath())  } catch { /* absent */ }
}

/**
 * Read the freshness sidecar. Returns null if absent.
 */
function lblCacheMeta() {
  try { return JSON.parse(fs.readFileSync(_metaPath(), 'utf8')) }
  catch { return null }
}

const config = {
  // Path to the grimoire-kb directory (local mode)
  root:   process.env.GRIMOIRE_ROOT || null,

  // Grimoire server address (remote mode)
  host:   process.env.GRIMOIRE_HOST || _lblEndpoint('grimoire') || null,

  // Ollama base URL
  ollama: process.env.OLLAMA_HOST   || _lblEndpoint('ollama')   || 'http://aid:11434',  // nohost — last-resort static fallback; env > cache > floor precede it

  // Prometheus URL
  prometheus: process.env.PROMETHEUS_HOST || _lblEndpoint('prometheus') || null,

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

module.exports = { config, isLocal, isRemote, requireMode, lblEndpoint, lblConfig, refreshLblCache, clearLblCache, lblCacheMeta, resolveGoogleCseKeys, _cachePath, _metaPath, _repoConfigPath }
