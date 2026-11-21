#!/usr/bin/env node
'use strict'

/**
 * jev-classifier-bridge — HTTP server that translates OpenAI Chat Completions
 * wire format to Jev TypeSafe Choice primitive.
 *
 * Designed for qwen-code's Auto Mode classifier fallback.
 * When qwen-code's classifier drops out, this service provides the judgment.
 *
 * The bridge translates, never judges. Jev makes the risk assessment.
 */

const http = require('http')
const { port, host, logLevel } = require('./config')
const { buildJevRequest, mapVerdict, formatOpenAIResponse, callJev } = require('./translator')

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(level, obj) {
  if (logLevel === 'debug' && level === 'debug') return
  const levels = { debug: 0, info: 1, warn: 2, error: 3 }
  if ((levels[level] ?? 1) < (levels[logLevel] ?? 1)) return

  const record = Object.assign({ level, ts: new Date().toISOString() }, obj)
  process.stdout.write(JSON.stringify(record) + '\n')
}

// ─── Request handler ─────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const start = Date.now()

  // Only POST to /v1/chat/completions
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  // Read request body
  const chunks = []
  const body = await new Promise((resolve, reject) => {
    req.on('data', chunk => { chunks.push(chunk) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

  log('debug', { bodyLen: body.length, bodyPreview: body.slice(0, 100) })

  let openaiRequest
  try {
    openaiRequest = JSON.parse(body)
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    log('warn', { method: 'POST', path: req.url, status: 400, error: 'invalid JSON' })
    return
  }

  // Validate minimal structure
  if (!Array.isArray(openaiRequest.messages)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing messages array' }))
    log('warn', { method: 'POST', path: req.url, status: 400, error: 'missing messages' })
    return
  }

  // Translate → Jev → verdict → OpenAI
  let jevResponse
  let verdict

  try {
    const jevRequest = buildJevRequest(openaiRequest)
    jevResponse = await callJev(jevRequest)

    verdict = mapVerdict(jevResponse)
  } catch (err) {
    // Fail-safe: Jev error → block
    log('warn', { error: err.message, method: 'POST', path: req.url })
    verdict = { shouldBlock: true, reason: `jev error: ${err.message}` }
  }

  const response = formatOpenAIResponse(verdict, openaiRequest)
  const durationMs = Date.now() - start

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(response))

  log('info', {
    method: 'POST',
    path: req.url,
    status: 200,
    durationMs,
    jevVerdict: jevResponse?.answers?.verdict?.choice ?? null,
    shouldBlock: verdict.shouldBlock,
  })
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest)

server.listen({ port, host }, () => {
  log('info', { event: 'listening', host, port })
})

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', { event: 'shutdown', signal: 'SIGTERM' })
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000) // force exit after 3s
})

process.on('SIGINT', () => {
  log('info', { event: 'shutdown', signal: 'SIGINT' })
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000)
})
