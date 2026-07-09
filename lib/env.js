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

const fs   = require('node:fs')
const path = require('node:path')
const os   = require('node:os')

// Load .env for server-local keys (GRIMOIRE_ROOT, GRIMOIRE_PORT, etc.)
const ENV_FILE = path.join(__dirname, '..', '.env')
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

// Read shared homelab topology — endpoints.grimoire, use.ollama → endpoints[use.ollama]
function _lbl() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'lbl-config.json'), 'utf8')) }
  catch { return {} }
}
function _lblEndpoint(key) {
  const c = _lbl()
  return c.endpoints?.[key] ?? c.endpoints?.[c.use?.[key]] ?? null
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

module.exports = { config, isLocal, isRemote, requireMode }
