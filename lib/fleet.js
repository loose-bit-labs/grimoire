'use strict'

/**
 * fleet.js — the fleet roster, single-sourced.
 *
 * One roster, two lenses: the KB registry (entities tagged
 * `hardware/inventory`) owns the box LIST; `$GRIMOIRE_ROOT/rig.json` is a
 * keyed overlay carrying the per-host service-check definitions. A box
 * registered in the KB after the last hand-edit appears here with no
 * rig.json change.
 *
 * Box shape (what `grim rig` and the telemetry generators consume):
 *   { host, label, aliases, services, note?, skip? }
 */

const fs      = require('node:fs')
const path    = require('node:path')
const axios   = require('axios')
const { scanHostEntities } = require('../bin/grim-host')

const INVENTORY_TIMEOUT_MS = 5000

/**
 * Read the service-check overlay (rig.json). Returns [] when the file is
 * absent (the overlay is optional — the registry is the roster); parse
 * errors warn on stderr and degrade to [] rather than taking the roster down.
 */
function readOverlay(rigPath) {
  if (!rigPath || !fs.existsSync(rigPath)) return []
  try {
    const rig = JSON.parse(fs.readFileSync(rigPath, 'utf8'))
    return Array.isArray(rig) ? rig : []
  } catch (e) {
    process.stderr.write(`fleet: failed to parse overlay ${rigPath} — ${e.message} — overlay ignored\n`)
    return []
  }
}

/**
 * Local registry scan — hardware/inventory entities under <root>/entities.
 * Missing entities dir (or scan failure) degrades to [] with a note; the
 * overlay still stands on its own.
 */
function loadRegistryLocal(root) {
  if (!root) return []
  const entitiesDir = path.join(root, 'entities')
  if (!fs.existsSync(entitiesDir)) return []
  try {
    return scanHostEntities(root)
  } catch (e) {
    process.stderr.write(`fleet: registry scan failed (${e.message}) — overlay only\n`)
    return []
  }
}

/**
 * The box list from the registry: local scan under config.root, else
 * GET {config.host}/api/hosts/inventory (phase 64). Never throws
 * `local KB required` — a client box derives the roster over HTTP.
 * Degrades to [] (stderr note) when neither source is available so the
 * overlay still stands on its own.
 */
async function fetchRegistry(config) {
  if (config.root) return loadRegistryLocal(config.root)

  if (!config.host) {
    process.stderr.write('fleet: no local KB and no grimoire server resolved — registry unavailable, overlay only\n')
    return []
  }

  try {
    const res = await axios.get(`${config.host}/api/hosts/inventory`, { timeout: INVENTORY_TIMEOUT_MS })
    return Array.isArray(res.data) ? res.data : []
  } catch (e) {
    process.stderr.write(`fleet: could not fetch host inventory from ${config.host}/api/hosts/inventory — ${e.message} — overlay only\n`)
    return []
  }
}

const dedupe = arr => [...new Set(arr.filter(Boolean))]

const matchesHost = (entry, host) =>
  entry.host === host || (Array.isArray(entry.aliases) && entry.aliases.includes(host))

function boxFromEntry(entry, host) {
  return {
    host,
    label: entry.label || host,
    aliases: dedupe([host, ...(entry.aliases || [])]),
    services: entry.services || [],
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.skip ? { skip: true } : {}),
  }
}

/**
 * Merge the registry roster with the rig.json overlay.
 * - every registry host gets a box; a matching overlay entry (by host or
 *   alias) attaches services/label/aliases/note/skip,
 * - a registry host with no overlay entry gets `services: []`,
 * - an overlay entry whose host is not in the registry is still included
 *   (nothing silently lost while a box is unregistered),
 * - output is sorted by host for stable, deterministic display + generators.
 */
function mergeFleet(registry, overlay) {
  registry = registry || []
  overlay  = overlay || []
  const used = new Set()
  const boxes = registry
    .map(e => e && e.name)
    .filter(Boolean)
    .sort()
    .map(host => {
      const idx = overlay.findIndex((o, i) => !used.has(i) && matchesHost(o, host))
      if (idx >= 0) used.add(idx)
      return boxFromEntry(idx >= 0 ? overlay[idx] : {}, host)
    })

  for (const [i, entry] of overlay.entries()) {
    if (used.has(i)) continue
    boxes.push(boxFromEntry(entry, entry.host))
  }

  return boxes.sort((a, b) => a.host.localeCompare(b.host))
}

/**
 * The single entry point. `config` = { root, host } (lib/env shape, or a
 * minimal equivalent from a generator). `rigPath` overrides the overlay
 * location (default: $root/rig.json; no overlay when there is no root).
 */
async function loadFleet(config, rigPath = null) {
  const overlayPath = rigPath || (config.root ? path.join(config.root, 'rig.json') : null)
  const overlay  = readOverlay(overlayPath)
  const registry = await fetchRegistry(config)
  return mergeFleet(registry, overlay)
}

/**
 * Sync, local-only derivation — for callers that run where the KB is local
 * and can't await (the telemetry generators). No HTTP, no fallbacks beyond
 * what loadRegistryLocal gives: missing registry → overlay only.
 */
function loadFleetLocal(root, rigPath = null) {
  const overlayPath = rigPath || (root ? path.join(root, 'rig.json') : null)
  const overlay  = readOverlay(overlayPath)
  const registry = loadRegistryLocal(root)
  return mergeFleet(registry, overlay)
}

module.exports = { loadFleet, loadFleetLocal, mergeFleet, readOverlay, fetchRegistry, INVENTORY_TIMEOUT_MS }
