'use strict'

/**
 * ner-client.js — HTTP client for the Grimoire NER service (grimoire.local:3773)
 *
 * Wraps /ner, /relations, and /extract endpoints with graceful degradation
 * — if the service is down, all calls return empty results without throwing.
 */

const { ServiceClient } = require('./service-client')

const NER_TIMEOUT = 10_000

class NERClient extends ServiceClient {
  constructor() {
    super('ner', { timeout: NER_TIMEOUT })
  }

  /** Extract named entities using GLiNER. Graceful degradation. */
  async extractEntities(text, entityTypes) {
    try {
      const body = { text }
      if (entityTypes) body.entity_types = entityTypes
      const data = await this._post('/ner', body)
      return data.entities || []
    } catch {
      return []
    }
  }

  /** Extract relation triples using Rebel. Graceful degradation. */
  async extractRelations(text, maxLength = 256) {
    try {
      const data = await this._post('/relations', { text, max_length: maxLength })
      return data.relations || []
    } catch {
      return []
    }
  }

  /** Extract entities + relations in one call. Graceful degradation. */
  async extract(entityTypes) {
    try {
      const body = { text: entityTypes.text }
      if (entityTypes.entityTypes) body.entity_types = entityTypes.entityTypes
      const data = await this._post('/extract', body)
      return { entities: data.entities || [], relations: data.relations || [] }
    } catch {
      return { entities: [], relations: [] }
    }
  }

  /** Check if the NER service is reachable. */
  async available() {
    return super.available()
  }
}

// Module-level singleton for backward-compatible function exports
const client = new NERClient()

/**
 * @param {string} text
 * @param {string[]} [entityTypes]
 * @returns {Promise<Array<{text:string, type:string, score:number}>>}
 */
async function extractEntities(text, entityTypes) {
  return client.extractEntities(text, entityTypes)
}

/**
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {Promise<Array<{head:string, type:string, tail:string}>>}
 */
async function extractRelations(text, maxLength) {
  return client.extractRelations(text, maxLength)
}

/**
 * @param {string} text
 * @param {string[]} [entityTypes]
 * @returns {Promise<{entities: Array, relations: Array}>}
 */
async function extract(text, entityTypes) {
  return client.extract(text, entityTypes)
}

/**
 * @returns {Promise<boolean>}
 */
async function nerAvailable() {
  return client.available()
}

const NER_BASE = client.resolveUrl() || 'http://aid:3773'

module.exports = { extractEntities, extractRelations, extract, nerAvailable, NER_BASE }
