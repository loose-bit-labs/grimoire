#!/usr/bin/env node
'use strict'

/**
 * grim-portal.js — open a portal into Claude Code running on a local model.
 *
 * The Node successor to ado.sh. What the portal owns that the shell script
 * didn't: it stands up its OWN reverse-proxy in-process and points
 * ANTHROPIC_BASE_URL at it, so every request Claude Code makes passes through
 * here before it reaches the real llama-server.
 *
 * The proxy runs an async FILTER PIPELINE over every content block before
 * forwarding. The default filter strips `image` blocks so a text-only model
 * (e.g. Qwen3.8-Flash-Next, no matching mmproj) doesn't choke when a tool result
 * carries a screenshot. Claude Code has no per-model vision toggle (verified:
 * `customModels`/`supportsVision` are not Claude Code settings), so the wire is
 * the only lever — and the portal owns it. Filters are async, so one can call a
 * local service instead of dropping: the opt-in `caption` filter fans images to
 * a local llava and splices the caption back as text. Add a media capability
 * (audio transcription, PDF OCR, …) by writing a filter and registering a name.
 *
 * Host resolution goes through lib/env.js → lbl-config (endpoints/use); nothing
 * is hardcoded. The plugin marketplace is served straight from this repo. The
 * proxy lives and dies with the launch (up before `claude`, down on exit/signal).
 *
 * Upstream resolution is most-explicit-first: PORTAL_UPSTREAM (full URL) →
 * PORTAL_HOST (a bare host, built into http://<host>:<port>, NO config lookup) →
 * lblEndpoint(PORTAL_ENDPOINT) (the config-driven fallback).
 *
 * Positional: `grim portal <host> [claude args…]` — a leading bare token is the
 * llama-server host (direct, no config lookup); everything after passes to claude.
 *
 * Env (all optional):
 *   PORTAL_HOST       bare llama-server host — direct, skips lbl-config entirely
 *   PORTAL_UPSTREAM_PORT  upstream llama-server port with PORTAL_HOST  (default 11311)
 *   PORTAL_UPSTREAM   full llama-server base URL, verbatim
 *   PORTAL_ENDPOINT   lbl-config key (endpoints[key] or endpoints[use[key]])  (default 'coding')
 *   PORTAL_MODEL      override the resolved model id        (default <clean-name>.<host>)
 *   PORTAL_KEY        ANTHROPIC_AUTH_TOKEN                  (default HOLE)
 *   PORTAL_PORT       proxy listen port                     (default 13431)
 *   PORTAL_STUB       image replacement text (strip filter, caption fallback)
 *   PORTAL_FILTERS    comma-separated filter pipeline       (default 'strip'; also 'caption')
 *   PORTAL_VISION_ENDPOINT  llava/Ollama base URL for 'caption'  (default: lbl-config use.ollama)
 *   PORTAL_VISION_MODEL     vision model for 'caption'           (default: lbl-config models.vision)
 *   PORTAL_DRYRUN=1   resolve + start proxy + self-test, but don't spawn claude
 *   CLAUDE_CODE_MODEL_CONTEXT_LIMIT                          (default 180081)
 *
 * Extra CLI args pass straight through to `claude`.
 */

const http  = require('node:http')
const fs    = require('node:fs')
const os    = require('node:os')
const path  = require('node:path')
const { spawn } = require('node:child_process')
const { lblEndpoint, lblConfig } = require('../lib/env.js')

const REPO = path.resolve(__dirname, '..')

// ── Content filters ───────────────────────────────────────────────────────────
// A filter transforms ONE content block on its way to the model. It declares a
// `name`, a `matches(block)` predicate, and an async `apply(block, ctx)` that
// returns a replacement block, an array of blocks (expand), or null (drop). They
// run in registration order; the first to match a block wins. `apply` is async
// so a filter can call out to a local service — caption an image via llava,
// transcribe audio, OCR a PDF — rather than only strip. Add a media capability
// by writing a filter class and registering a name in FILTER_REGISTRY.

// Default: neutralise `image` blocks into a text stub. Cheap, no dependencies.
class StripImageFilter {
  constructor({ stub } = {}) {
    this.name = 'strip'
    this.stub = stub || '[image omitted — text-only model]'
  }
  matches(b) { return b && b.type === 'image' }
  async apply() { return { type: 'text', text: this.stub } }
}

// Opt-in: caption an `image` block via a local llava (Ollama). Endpoint + model
// come from lbl-config (no hardcoded host). Fail-OPEN — any error (no endpoint,
// timeout, bad response) degrades to the strip stub, so a flaky vision service
// can never break a request. This is the "one host does the images, another the
// text" idea, realised at the wire.
class LlavaCaptionFilter {
  constructor({ endpoint, model, stub, prompt, timeout } = {}) {
    this.name     = 'caption'
    this.endpoint = endpoint
    this.model    = model || 'llava:latest'
    this.stub     = stub || '[image omitted — text-only model]'
    this.prompt   = prompt || 'Describe this image in one or two sentences.'
    this.timeout  = Number(timeout || 30000)
  }
  matches(b) { return b && b.type === 'image' }
  async apply(b) {
    const data = b && b.source && b.source.data
    if (!this.endpoint || !data) return { type: 'text', text: this.stub }
    try {
      const caption = await this._ollamaCaption(data)
      return { type: 'text', text: caption ? `[image: ${caption}]` : this.stub }
    } catch (e) {
      console.error(`⚠ caption filter → strip fallback: ${e.message}`)
      return { type: 'text', text: this.stub }
    }
  }
  _ollamaCaption(imageB64) {
    const url = new URL(`${this.endpoint}/api/generate`)
    const payload = JSON.stringify({ model: this.model, prompt: this.prompt, images: [imageB64], stream: false })
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, res => {
        const c = []; res.on('data', d => c.push(d))
        res.on('end', () => { try { resolve((JSON.parse(Buffer.concat(c).toString('utf8')).response || '').trim()) } catch (e) { reject(e) } })
      })
      req.on('error', reject)
      req.setTimeout(this.timeout, () => req.destroy(new Error('llava timeout')))
      req.write(payload); req.end()
    })
  }
}

// name → factory. `ctx` carries { stub } plus lazily-resolved services so a
// factory stays free of hardcoded hosts. Register new media handlers here.
const FILTER_REGISTRY = {
  strip:   ctx => new StripImageFilter({ stub: ctx.stub }),
  caption: ctx => new LlavaCaptionFilter({ endpoint: ctx.visionEndpoint, model: ctx.visionModel, stub: ctx.stub }),
}

// ── The proxy ───────────────────────────────────────────────────────────────
// Reverse-proxies to the real llama-server. Mutates only the REQUEST (runs the
// filter pipeline over every content block); the response — SSE streams
// included — is piped back raw. Non-/v1/messages is a transparent passthrough.
class PortalProxy {
  constructor({ port, upstream, filters, stub } = {}) {
    this.port     = Number(port || 13431)
    this.upstream = new URL(upstream || 'http://localhost:11311')
    this.filters  = filters && filters.length ? filters : [new StripImageFilter({ stub })]
    this.handled  = 0
    this.server   = null
  }

  // Run the filter pipeline over every content block, recursing into nested
  // tool_result `.content[]` (the real source — a tool returning media). Async:
  // a filter may call out to a local service. Returns how many blocks it changed.
  async transform(body) {
    let n = 0
    const walk = async blocks => {
      if (!Array.isArray(blocks)) return blocks
      const out = []
      for (let cur of blocks) {
        if (cur && cur.type === 'tool_result' && Array.isArray(cur.content)) {
          cur = { ...cur, content: await walk(cur.content) }
        }
        const f = this.filters.find(f => f.matches(cur))
        if (!f) { out.push(cur); continue }
        const r = await f.apply(cur, { proxy: this }); n++
        if (r == null) continue
        if (Array.isArray(r)) out.push(...r); else out.push(r)
      }
      return out
    }
    if (Array.isArray(body.messages)) {
      for (const m of body.messages) if (Array.isArray(m.content)) m.content = await walk(m.content)
    }
    if (Array.isArray(body.system)) body.system = await walk(body.system)
    this.handled += n
    return n
  }

  handleMessages(req, res) {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      let raw = Buffer.concat(chunks), n = 0
      try {
        const body = JSON.parse(raw.toString('utf8'))
        n = await this.transform(body)
        if (n) raw = Buffer.from(JSON.stringify(body))
      } catch (e) {
        console.error(`⚠ /v1/messages body not JSON, passing raw: ${e.message}`)
      }
      if (n) console.log(`🧹 filtered ${n} block(s) this turn (total ${this.handled})`)
      this.forward(req, res, raw)
    })
    req.on('error', e => this.fail(res, e))
  }

  passthrough(req, res) {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => this.forward(req, res, Buffer.concat(chunks)))
    req.on('error', e => this.fail(res, e))
  }

  forward(req, res, bodyBuf) {
    const headers = { ...req.headers, host: this.upstream.host }
    if (bodyBuf.length) headers['content-length'] = Buffer.byteLength(bodyBuf)
    else delete headers['content-length']
    const up = http.request({
      protocol: this.upstream.protocol,
      hostname: this.upstream.hostname,
      port:     this.upstream.port,
      method:   req.method,
      path:     req.url,
      headers,
    }, upRes => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res) })
    up.on('error', e => this.fail(res, e))
    if (bodyBuf.length) up.write(bodyBuf)
    up.end()
  }

  fail(res, err) {
    console.error(`💥 upstream error: ${err.message}`)
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'portal_upstream_error', message: err.message } }))
  }

  start(cb) {
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url.startsWith('/v1/messages')) return this.handleMessages(req, res)
      return this.passthrough(req, res)
    })
    // localhost-only: this proxy carries the auth token; nothing off-box needs it.
    this.server.listen(this.port, '127.0.0.1', cb)
    return this.server
  }

  stop() { if (this.server) this.server.close() }
}

// ── The launcher ──────────────────────────────────────────────────────────────
class Portal {
  constructor(env = process.env) {
    this.env         = env
    this.endpointKey = env.PORTAL_ENDPOINT || 'coding'
    // Args after the subcommand. Dispatched via `grim portal …`, grim.js runs us
    // in-process with argv intact, so the 'portal' token sits at argv[2].
    const args = process.argv.slice(process.argv[2] === 'portal' ? 3 : 2)
    // A leading BARE token (not a --flag) is a positional host: `grim portal tbona`.
    // Everything after it passes through to claude.
    const posHost = (args[0] && !args[0].startsWith('-')) ? args.shift() : null
    this.claudeArgs = args
    // Upstream resolution, most-explicit first:
    //   1. PORTAL_UPSTREAM — a full base URL, verbatim
    //   2. positional host / PORTAL_HOST — a bare host, built into
    //      http://<host>:<PORTAL_UPSTREAM_PORT> (direct, NO lbl-config lookup)
    //   3. lblEndpoint(PORTAL_ENDPOINT) — the config-driven fallback
    const hostArg    = posHost || env.PORTAL_HOST
    this.upstream    = env.PORTAL_UPSTREAM
      || (hostArg && `http://${hostArg}:${env.PORTAL_UPSTREAM_PORT || 11311}`)
      || lblEndpoint(this.endpointKey)
    this.proxyPort   = Number(env.PORTAL_PORT || 13431)
    this.key         = env.PORTAL_KEY || 'HOLE'
    // Claude Code renamed this window var; set the LIVE name (older name kept for
    // back-compat). Without it, an unrecognised local model name makes Claude Code
    // assume a 200k window and auto-compact early.
    this.ctxTokens   = env.CLAUDE_CODE_MAX_CONTEXT_TOKENS || env.CLAUDE_CODE_MODEL_CONTEXT_LIMIT || '180081'
    this.settings    = path.join(os.homedir(), '.claude', 'the-local-llm-settings.json')
    this.marketplace = REPO                       // repo self-hosts as the marketplace
    this.dryRun      = !!env.PORTAL_DRYRUN
    if (!this.upstream) {
      throw new Error(`no upstream resolved — pass a host (grim portal <host>), set PORTAL_UPSTREAM to a URL, or PORTAL_ENDPOINT to a known lbl-config endpoints/use key (tried '${this.endpointKey}')`)
    }
    this.host  = new URL(this.upstream).hostname
    this.proxy = new PortalProxy({ port: this.proxyPort, upstream: this.upstream, filters: this.buildFilters() })
  }

  // Build the filter pipeline from PORTAL_FILTERS (comma-separated, default
  // 'strip'). Vision endpoint/model for the caption filter resolve from
  // lbl-config at build time — no hardcoded host.
  buildFilters() {
    const ctx = {
      stub:           this.env.PORTAL_STUB,
      visionEndpoint: this.env.PORTAL_VISION_ENDPOINT || lblEndpoint('ollama'),
      visionModel:    this.env.PORTAL_VISION_MODEL || (lblConfig().models || {}).vision,
    }
    const names = (this.env.PORTAL_FILTERS || 'strip').split(',').map(s => s.trim()).filter(Boolean)
    return names.map(name => {
      const make = FILTER_REGISTRY[name]
      if (!make) throw new Error(`unknown PORTAL_FILTER '${name}' — known: ${Object.keys(FILTER_REGISTRY).join(', ')}`)
      return make(ctx)
    })
  }

  httpGetJson(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, res => {
        const c = []
        res.on('data', d => c.push(d))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))) }
          catch (e) { reject(new Error(`bad JSON from ${url}: ${e.message}`)) }
        })
      })
      req.on('error', reject)
      req.setTimeout(5000, () => req.destroy(new Error(`timeout querying ${url}`)))
    })
  }

  // Turn the server's raw model name (often a full gguf path with a shard
  // suffix) into a readable id: basename, drop -00001-of-00003 and .gguf.
  cleanLabel(name) {
    return path.basename(String(name))
      .replace(/-\d{5}-of-\d{5}/i, '')
      .replace(/\.gguf$/i, '')
  }

  async resolveModel() {
    if (this.env.PORTAL_MODEL) return this.env.PORTAL_MODEL
    const data = await this.httpGetJson(`${this.upstream}/v1/models`)
    const raw = data?.models?.[0]?.name || data?.data?.[0]?.id
    if (!raw) throw new Error(`could not read a model name from ${this.upstream}/v1/models`)
    return `${this.cleanLabel(raw)}.${this.host}`
  }

  settingsJson() {
    return {
      extraKnownMarketplaces: {
        'local-plugins': { source: { source: 'directory', path: this.marketplace } },
      },
      enabledPlugins: { 'grimoire@local-plugins': true },
      promptSuggestionEnabled: false,
      env: {
        CLAUDE_CODE_ENABLE_TELEMETRY: '0',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      },
      attribution: { commit: '', pr: '' },
      plansDirectory: './plans',
      prefersReducedMotion: true,
      terminalProgressBarEnabled: false,
      effortLevel: 'high',
      statusLine: { type: 'command', command: 'node ~/.claude/statusline.js' },
    }
  }

  writeSettings() {
    fs.mkdirSync(path.dirname(this.settings), { recursive: true })
    fs.writeFileSync(this.settings, JSON.stringify(this.settingsJson(), null, 2))
  }

  childEnv(model) {
    return {
      ...this.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${this.proxyPort}/`,
      ANTHROPIC_AUTH_TOKEN: this.key,
      ANTHROPIC_MODEL: model,
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: this.ctxTokens,      // live var (2.1.x)
      CLAUDE_CODE_MODEL_CONTEXT_LIMIT: this.ctxTokens,     // legacy var, older CLIs
    }
  }

  // Fire one request through the proxy to prove the whole path is live.
  selfTest() {
    return new Promise(resolve => {
      const payload = JSON.stringify({ model: 'x', max_tokens: 1,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] })
      const req = http.request({
        hostname: '127.0.0.1', port: this.proxyPort, method: 'POST', path: '/v1/messages',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      req.on('error', () => resolve('ERR'))
      req.write(payload); req.end()
    })
  }

  async main() {
    const model = await this.resolveModel()
    await new Promise((res, rej) => { this.proxy.start(res).on('error', rej) })
    this.writeSettings()

    const pipeline = this.proxy.filters.map(f => f.name).join(' → ')
    console.log(`🌀 portal → ${this.upstream}  (proxy :${this.proxyPort}, filters: ${pipeline})`)
    console.log(`   model: ${model}`)

    const cleanup = () => this.proxy.stop()

    if (this.dryRun) {
      const code = await this.selfTest()
      console.log(`   dry-run self-test: proxy→upstream POST /v1/messages → ${code}`)
      console.log(`   settings written: ${this.settings}`)
      console.log(`   would launch: claude --model ${model} --settings ${this.settings} ${this.claudeArgs.join(' ')}`.trim())
      cleanup()
      return
    }

    const child = spawn('claude',
      ['--model', model, '--settings', this.settings, ...this.claudeArgs],
      { stdio: 'inherit', env: this.childEnv(model) })

    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(sig); cleanup() })
    child.on('close', code => { cleanup(); process.exit(code ?? 0) })
    child.on('error', e => { console.error(`💥 failed to launch claude: ${e.message}`); cleanup(); process.exit(1) })
  }
}

if (require.main === module) {
  Promise.resolve().then(() => new Portal().main())
    .catch(e => { console.error(`💥 portal: ${e.message}`); process.exit(1) })
}

module.exports = { Portal, PortalProxy, StripImageFilter, LlavaCaptionFilter, FILTER_REGISTRY }
