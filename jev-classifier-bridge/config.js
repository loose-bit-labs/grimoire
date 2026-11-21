'use strict'

/**
 * config.js — environment-based configuration for the classifier bridge.
 *
 * All config comes from env vars (or .env via Node's process.env).
 * No secrets in logs.
 */

const PORT = parseInt(process.env.BRIDGE_PORT || '12321', 10) || 12321
const HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const JEV_API_KEY = process.env.JEV_API_KEY || ''
const JEV_MODEL = process.env.JEV_MODEL || 'jev-latest'
const JEV_ENDPOINT = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone'
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase()
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '8000', 10) || 8000

module.exports = {
  port: PORT,
  host: HOST,
  jevApiKey: JEV_API_KEY,
  jevModel: JEV_MODEL,
  jevEndpoint: JEV_ENDPOINT,
  logLevel: LOG_LEVEL,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
}
