'use strict'

/**
 * ner-client.js — HTTP client for the Grimoire NER service (aid:3773)
 *
 * Wraps /ner, /relations, and /extract endpoints with graceful degradation
 * — if the service is down, all calls return empty results without throwing.
 */

const axios = require('axios')

const NER_BASE    = process.env.GRIMOIRE_NER_HOST || 'http://aid:3773'
const NER_TIMEOUT = 10_000

async function _post(path, body) {
  const res = await axios.post(`${NER_BASE}${path}`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: NER_TIMEOUT,
  })
  return res.data
}

/**
 * Extract named entities using GLiNER.
 * @param {string} text
 * @param {string[]} [entityTypes]
 * @returns {Promise<Array<{text:string, type:string, score:number}>>}
 */
async function extractEntities(text, entityTypes) {
  try {
    const body = { text }
    if (entityTypes) body.entity_types = entityTypes
    const data = await _post('/ner', body)
    return data.entities || []
  } catch {
    return []
  }
}

/**
 * Extract relation triples using Rebel.
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {Promise<Array<{head:string, type:string, tail:string}>>}
 */
async function extractRelations(text, maxLength = 256) {
  try {
    const data = await _post('/relations', { text, max_length: maxLength })
    return data.relations || []
  } catch {
    return []
  }
}

/**
 * Extract entities + relations in one call.
 * @param {string} text
 * @param {string[]} [entityTypes]
 * @returns {Promise<{entities: Array, relations: Array}>}
 */
async function extract(text, entityTypes) {
  try {
    const body = { text }
    if (entityTypes) body.entity_types = entityTypes
    const data = await _post('/extract', body)
    return { entities: data.entities || [], relations: data.relations || [] }
  } catch {
    return { entities: [], relations: [] }
  }
}

/**
 * Check if the NER service is reachable.
 * @returns {Promise<boolean>}
 */
async function nerAvailable() {
  try {
    await axios.get(`${NER_BASE}/health`, { timeout: 3_000 })
    return true
  } catch {
    return false
  }
}

module.exports = { extractEntities, extractRelations, extract, nerAvailable, NER_BASE }
