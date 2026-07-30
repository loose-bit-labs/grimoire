#!/usr/bin/env node
'use strict'

/**
 * grim-research.js — The link-backlog brain
 *
 * Given one drop (a URL, a bare term, or a short note), it:
 *   1. Classify → url | reddit | term
 *   2. Dedup via oracle search — if already known, short-circuit
 *   3. Acquire — fetch + extract text
 *   4. Judge via THE ARCHIVIST (Ollama) — what it is, why it matters, target project
 *   5. File one KB entity
 *   6. Return a one-paragraph digest
 *
 * CLI:
 *   grim research https://github.com/...          Research a URL
 *   grim research https://reddit.com/r/...        Research a Reddit post
 *   grim research "ZLUDA"                         Research a term
 *   grim research "some note" --project foo       Force project route
 *   grim research --dry-run https://...           Classify+acquire+judge, no write
 *   grim research --json https://...              JSON output
 *   grim research --timeout 30000 "term"          Custom timeout
 */

const path    = require('node:path')
const http    = require('node:http')
const https   = require('node:https')
const minimist = require('minimist')
const { askJSON }       = require('./model-ask')
const { loadGraph }     = require('../lib/graph')
const { writeEntity }   = require('../lib/entities')
const { search }        = require('./grim-oracle')
const { config, isLocal, resolveGoogleCseKeys } = require('../lib/env')

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// Reddit (and some other sites) 403 requests with no User-Agent header at all.
const USER_AGENT = 'grim-research/1.0 (grimoire link-backlog research tool)'

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeout) }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow single redirect
          httpGet(res.headers.location, timeout).then(resolve).catch(reject)
        } else if (res.statusCode !== 200) {
          resolve(null)
        } else {
          resolve(body)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

// ── Lightweight HTML text extractor ───────────────────────────────────────────
//
// Strips script/style/nav/header/footer, extracts main content heuristically,
// converts to plain text. No headless browser, no external deps.

function extractText(html) {
  if (!html) return ''

  // Strip script and style tags
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  // Remove HTML tags but keep newlines for readability
  text = text.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|section|article|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '-')

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim()

  // Remove very short fragments (likely navigation artifacts)
  const paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 50)
  return paragraphs.join('\n\n')
}

// ── Link scan ─────────────────────────────────────────────────────────────────
//
// Deterministic regex pass over acquired text to find high-value resources
// (GitHub repos, arxiv papers, DOIs, docs links). Returns a deduped, capped
// list of {type, url} objects. Depth-1 only — discovered resources are not
// re-scanned (that's phase 34/35).

const THIN_YIELD_THRESHOLD = 600 // chars of real text before we call it a SPA shell
const DISCOVERY_CAP = 4

// Known patterns — order matters for type assignment (first match wins)
// All regexes use the 'g' flag so exec() advances through all matches.
const LINK_PATTERNS = [
  // arxiv abs and pdf
  { re: /arxiv\.org\/abs\/([\d\.]+)/g, type: 'paper', fix: (m) => `https://arxiv.org/abs/${m[1]}` },
  { re: /arxiv\.org\/pdf\/([\d\.]+)(?=\.pdf|$)/g, type: 'paper', fix: (m) => `https://arxiv.org/pdf/${m[1]}` },
  // DOI
  { re: /doi\.org\/(?:10\.\d{4,}\/[^\s"'>]+)/g, type: 'paper', fix: (m) => `https://${m[0]}` },
  // GitHub org/repo (full URLs and bare references in text)
  { re: /github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)/g, type: 'repo', fix: (m) => `https://github.com/${m[1]}/${m[2]}` },
  // Generic docs links (hosted docs sites)
  { re: /docs?\.(?:github\.io|readthedocs\.io|npmjs\.com\/package)\/[^\s"'>]+/g, type: 'doc', fix: (m) => m[0].replace(/\s+$/, '') },
]

function scanLinks(text) {
  if (!text) return []
  const found = new Map() // url → {type, url}
  for (const { re, type, fix } of LINK_PATTERNS) {
    let m
    while ((m = re.exec(text)) !== null) {
      const url = fix(m)
      if (!found.has(url)) {
        found.set(url, { type, url })
      }
    }
  }
  return Array.from(found.values()).slice(0, DISCOVERY_CAP)
}

// ── Thin-yield detection ──────────────────────────────────────────────────────
//
// If extractText yields below threshold, the page is likely a SPA or marketing
// shell — fall back to search to find the canonical repo/paper.

function detectThinYield(acquired) {
  return !!acquired.text && acquired.text.length < THIN_YIELD_THRESHOLD
}

// ── Search fallback ───────────────────────────────────────────────────────────
//
// Reuses the existing CSE→DDG search path (same as acquireTerm) to find
// canonical resources when the page itself is thin. Queries for github and
// arxiv hits, classifies by host, returns up to CAP resources.

async function searchForResources(title, drop) {
  const query = title !== drop ? `${title} github` : `${drop} github`
  const results = await acquireTerm({ term: query })
  if (results.failed || !results.text) return []

  // Pull out any github/arxiv/doi links from the search result page
  const links = scanLinks(results.text)

  // Also try an arxiv-specific query
  const arxivResults = await acquireTerm({ term: `${title} arxiv paper` })
  if (!arxivResults.failed && arxivResults.text) {
    const arxivLinks = scanLinks(arxivResults.text)
    for (const link of arxivLinks) {
      if (!links.find((l) => l.url === link.url)) {
        links.push({ ...link, via: 'search' })
      }
    }
  }

  return links.slice(0, DISCOVERY_CAP)
}

// ── Classify ──────────────────────────────────────────────────────────────────

function classify(drop, forceFeature = false) {
  const url = drop.trim()

  // --feature flag forces feature-request type
  if (forceFeature) {
    return { type: 'feature-request', term: url }
  }

  // Reddit shortlink or full URL
  if (/^https?:\/\/(www\.)?reddit\.com\//i.test(url) || /^https?:\/\/(www\.)?redd\.it\//i.test(url)) {
    return { type: 'reddit', url }
  }

  // Any URL
  if (/^https?:\/\//i.test(url)) {
    return { type: 'url', url }
  }

  // Bare term or short note
  return { type: 'term', term: url }
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

async function checkDedup(query) {
  try {
    const graph = await loadGraph()
    const results = search(graph, { query, limit: 5 })
    // Only consider it a dedup if the best match has a meaningful score (≥ 40 = desc/phrase match)
    if (results.length > 0 && results[0].score >= 40) {
      const best = results[0]
      return {
        deduped: true,
        entityId: best.entity['@id'],
        digest: `Already known: [${best.entity['@id']}] ${best.entity.name} — ${best.entity.description?.slice(0, 200) || 'no description'}`,
      }
    }
  } catch (e) { /* oracle unavailable, proceed */ }
  return { deduped: false }
}

// Export for testing
module.exports = {
  classify, checkDedup, acquire, acquireUrl, acquireReddit, researchDrop,
  isRedditShortlink, buildCseUrl, scanLinks, detectThinYield, searchForResources,
}

// ── Acquire ───────────────────────────────────────────────────────────────────

async function acquireUrl(info) {
  const html = await httpGet(info.url, 15000)
  if (!html) return { title: info.url, text: '[fetch failed]', failed: true }

  // Try to extract title
  let title = info.url
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) title = titleMatch[1].trim()

  const text = extractText(html)
  return { title, text, html }
}

// Both old-style shortlinks (redd.it/xyz) and the newer mobile-share links
// (reddit.com/r/.../s/xyz) 302-redirect to the real post and need resolving
// before `.json` can be appended — appending it to the shortlink itself is
// not a valid API path and silently fails.
function isRedditShortlink(url) {
  return /^https?:\/\/(www\.)?redd\.it\//i.test(url) ||
    /^https?:\/\/(www\.)?reddit\.com\/r\/[^/]+\/s\//i.test(url)
}

function resolveRedirect(url, timeout = 5000) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeout) }, res => {
      res.resume() // discard body, we only want the Location header
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(res.headers.location)
      } else {
        resolve(url)
      }
    })
    req.on('error', () => resolve(url))
  })
}

async function acquireReddit(info) {
  let apiUrl = info.url
  if (isRedditShortlink(apiUrl)) {
    apiUrl = await resolveRedirect(apiUrl)
  }
  // Append .json for Reddit API — must land before any query string (shortlink
  // redirects carry share-tracking params like ?share_id=...&utm_term=1), or
  // Reddit serves its HTML bot-check page instead of the JSON API response.
  const [pathPart, queryPart] = apiUrl.split('?')
  apiUrl = pathPart.replace(/\/?$/, '/.json') + (queryPart ? `?${queryPart}` : '')

  const json = await httpGet(apiUrl, 15000)
  if (!json) return { title: 'Reddit post', text: '[fetch failed]', failed: true }

  try {
    const data = JSON.parse(json)
    const post = data[0]?.data?.children?.[0]?.data
    if (!post) return { title: 'Reddit post', text: '[parse failed]', failed: true }

    const title = post.title || 'Untitled Reddit post'
    const selftext = post.selftext || ''
    const comments = (data[1]?.data?.children || [])
      .slice(0, 20)
      .map(c => c.data?.body?.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map(c => `> ${c}`)
      .join('\n\n')

    return { title, text: [selftext, comments].filter(Boolean).join('\n\n') }
  } catch {
    return { title: 'Reddit post', text: '[parse failed]', failed: true }
  }
}

function buildCseUrl(term, keys) {
  return `https://www.googleapis.com/customsearch/v1?key=${keys.key}&cx=${keys.cx}&q=${encodeURIComponent(term)}&num=1`
}

async function acquireTerm(info) {
  const keys = resolveGoogleCseKeys()

  if (keys && keys.key && keys.cx) {
    // Google Custom Search JSON API
    const cseUrl = buildCseUrl(info.term, keys)
    const json = await httpGet(cseUrl, 15000)
    if (json) {
      try {
        const data = JSON.parse(json)
        const items = data.items || []
        if (items.length > 0) {
          // Fetch the top result's text
          const topUrl = items[0].link
          const html = await httpGet(topUrl, 15000)
          const title = items[0].title || info.term
          if (!html) return { title, text: '[no content]', failed: true }
          return { title, text: extractText(html) }
        }
      } catch { /* CSE parse failed, fall through to DDG */ }
    }
  }

  // DuckDuckGo HTML scrape fallback
  const ddgHtml = await httpGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(info.term)}`, 15000)
  if (!ddgHtml) return { title: info.term, text: '[search failed]', failed: true }

  // Extract first result URL from DDG HTML
  // DDG wraps URLs in redirect links: //duckduckgo.com/l/?uddg=...
  const urlMatch = ddgHtml.match(/class="result__a"[^>]*href="([^"]+)"/)
  if (!urlMatch) return { title: info.term, text: '[no results]', failed: true }

  let topUrl = urlMatch[1]
  // Handle protocol-relative redirect URLs
  if (topUrl.startsWith('//')) {
    const uddgMatch = topUrl.match(/uddg=([^&]+)/)
    if (uddgMatch) {
      topUrl = decodeURIComponent(uddgMatch[1])
    } else {
      topUrl = 'https:' + topUrl
    }
  }
  const html = await httpGet(topUrl, 15000)
  if (!html) return { title: info.term, text: '[no content]', failed: true }
  return { title: info.term, text: extractText(html) }
}

async function acquire(classification, projectOverride) {
  if (classification.type === 'feature-request') {
    // No web acquisition — the note text IS the content
    return { title: classification.term, text: classification.term }
  }
  if (classification.type === 'url') return acquireUrl(classification)
  if (classification.type === 'reddit') return acquireReddit(classification)
  if (classification.type === 'term') return acquireTerm(classification)
  return { title: classification.term || classification.url, text: '[unknown type]' }
}

// ── Judge (THE ARCHIVIST) ─────────────────────────────────────────────────────

const RESEARCH_JUDGE_SYSTEM = `You are THE ARCHIVIST. You judge acquired research material and decide how to file it in a knowledge graph.

Given the original drop and acquired text, output a JSON object with:
- "type": "SoftwareApplication" (for tools/repos/frameworks) or "DefinedTerm" (for concepts/ideas, including feature-requests)
- "name": concise display name
- "description": 1-2 sentences — what this IS, written for a reader with no prior context
- "project": the best-matching project entity ID from this list, or null if no match:
{projects}
- "tags": string array (domain/X, research/YYYY-MM-DD)
- "digest": a one-paragraph summary of why this matters and what it is

Return ONLY valid JSON. No markdown, no commentary.`

// Acquisition genuinely failed (fetch/parse error, no results) — don't hand
// placeholder text like "[fetch failed]" to the judge as if it were real
// content; the model will narrate fluently around missing data and produce
// a plausible-looking digest for something that was never actually read.
function stubJudgment(drop, classification, acquired) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    type: 'DefinedTerm',
    // Always key off the actual drop, never acquired.title — on failure,
    // title is either absent or a generic placeholder ("Reddit post"),
    // and two different failed drops of the same type would otherwise
    // collide onto the same entity and silently overwrite each other.
    name: drop,
    description: `Reference stub — acquisition failed for "${drop}" (${classification.type}: ${acquired.text}). Filed for manual follow-up.`,
    project: null,
    tags: ['domain/research', 'research/acquisition-failed', `research/${today}`],
    digest: `Could not acquire content for "${drop}" — ${acquired.text}. Filed as a plain reference stub, no summary was generated.`,
  }
}

async function judge(drop, classification, acquired, timeout) {
  // Get existing project entities for context
  let projectList = ''
  try {
    const graph = await loadGraph()
    const projects = Object.values(graph.entities || {}).filter(e => e['@type'] === 'Project')
    projectList = projects.map(p => `  - ${p['@id']}: ${p.name} — ${p.description?.slice(0, 120) || ''}`).join('\n')
    if (!projectList) projectList = '  (none)'
  } catch { projectList = '(unavailable)' }

  const prompt = RESEARCH_JUDGE_SYSTEM
    .replace('{projects}', projectList)
    .replace('{projects}', projectList) // double-replace for safety

  const fullText = [
    `DROP: ${drop}`,
    `TYPE: ${classification.type}`,
    `TITLE: ${acquired.title}`,
    `TEXT:\n${acquired.text?.slice(0, 8000) || '[empty]'}`,
  ].join('\n\n')

  try {
    const result = await askJSON({
      prompt: fullText,
      system: prompt,
      task: 'extraction',
      timeout,
    })
    return result
  } catch (e) {
    // Fallback: produce a minimal judgment without Ollama
    return {
      type: 'DefinedTerm',
      name: classification.type === 'term' ? drop : acquired.title,
      description: `Research drop: ${drop} (${classification.type}). Acquired text from ${acquired.title}.`,
      project: null,
      tags: ['domain/research', `research/${new Date().toISOString().slice(0, 10)}`],
      digest: `Research on "${drop}" — ${classification.type} source. ${acquired.text?.slice(0, 200) || 'No content acquired.'}`,
    }
  }
}

// ── File ──────────────────────────────────────────────────────────────────────

function fileEntity(judgment, drop, classification, acquired) {
  const tags = [...(judgment.tags || [])]

  // Feature-request entities get needs-triage tag
  if (classification.type === 'feature-request') {
    const today = new Date().toISOString().slice(0, 10)
    if (!tags.includes('research/feature-request')) tags.push('research/feature-request')
    if (!tags.includes('needs-triage')) tags.push('needs-triage')
    if (!tags.includes(`research/${today}`)) tags.push(`research/${today}`)
  }

  const entity = {
    '@type': judgment.type || 'DefinedTerm',
    name: judgment.name,
    description: judgment.description,
    tags,
    relationships: {},
    metadata: {
      source: 'research',
      drop,
      dropType: classification.type,
      dropUrl: classification.url || null,
      dateAcquired: new Date().toISOString().slice(0, 10),
      title: acquired.title,
    },
  }

  // Route to project if confident
  if (judgment.project) {
    entity.relationships = { works_on: [judgment.project] }
  }

  return writeEntity(entity)
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function researchDrop(drop, opts = {}) {
  const { json, dryRun, project: projectOverride, timeout = 60000, feature } = opts

  // 1. Classify
  const classification = classify(drop, feature)

  // 2. Dedup
  const dedupQuery = classification.type === 'term' ? classification.term : classification.url
  const dedup = await checkDedup(dedupQuery)
  if (dedup.deduped) {
    const output = { drop, deduped: true, entityId: dedup.entityId, digest: dedup.digest }
    if (json) console.log(JSON.stringify(output, null, 2))
    else console.log(`\n  Already known: ${dedup.digest}`)
    return output
  }

  // 3. Acquire
  const acquired = await acquire(classification, projectOverride)

  // 3b. Discover — link-scan acquired text; if thin, fall back to search
  const discovered = []
  const linkHits = scanLinks(acquired.html || acquired.text)
  discovered.push(...linkHits.map((l) => ({ ...l, via: 'link-scan' })))

  if (detectThinYield(acquired) && linkHits.length === 0) {
    const searchHits = await searchForResources(acquired.title, drop)
    discovered.push(...searchHits.map((l) => ({ ...l, via: 'search' })))
  }

  // Cap at DISCOVERY_CAP total
  const discoveredCapped = discovered.slice(0, DISCOVERY_CAP)

  // 4. Judge — skip the model entirely on a genuine acquisition failure
  const judgment = acquired.failed
    ? stubJudgment(drop, classification, acquired)
    : await judge(drop, classification, acquired, timeout)

  // 5. File (unless dry-run)
  let result = {
    drop,
    type: classification.type,
    title: acquired.title,
    project: judgment.project || null,
    digest: judgment.digest || '',
    deduped: false,
    acquisitionFailed: !!acquired.failed,
    discovered: discoveredCapped,
  }

  if (!dryRun && isLocal) {
    const { id, file, created } = fileEntity(judgment, drop, classification, acquired)
    result.entityId = id
    result.file = file
    result.created = created
    // Rebuild the graph index so an immediate re-run of the same drop can
    // find it via checkDedup() — otherwise the just-written entity is
    // invisible to oracle search until the next scheduled scribe pass.
    require('./grim-scribe').scribe()
  } else if (dryRun) {
    result.dryRun = true
  }

  // 6. Output
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`\n  ${judgment.digest || result.digest}`)
    if (discoveredCapped.length > 0) {
      console.log(`  Discovered ${discoveredCapped.length} resource(s):`)
      for (const d of discoveredCapped) {
        console.log(`    [${d.type}] ${d.url}  (via ${d.via})`)
      }
    }
    if (result.entityId) console.log(`  Filed: ${result.entityId}`)
    if (dryRun) console.log(`  (dry-run, not written)`)
  }

  return result
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  // grim.js dispatcher passes cmd as argv[2]; skip it if present
  const argvStart = (process.argv[2] === 'research') ? 3 : 2
  const args = minimist(process.argv.slice(argvStart), {
    string: ['project', 'timeout'],
    boolean: ['json', 'dry-run', 'feature'],
    alias: { j: 'json', d: 'dry-run', p: 'project', t: 'timeout', f: 'feature' },
    unknown: [() => true], // allow positional args
  })

  const drop = args._[0]
  if (!drop) {
    console.error('Usage: grim research <drop> [--json] [--dry-run] [--project <id>] [--timeout <ms>]')
    console.error('  drop: a URL, a Reddit link, or a bare term to research')
    process.exit(1)
  }

  researchDrop(drop, {
    json: args.json,
    dryRun: args['dry-run'],
    project: args.project,
    timeout: parseInt(args.timeout, 10) || 60000,
    feature: args.feature,
  }).catch(e => {
    console.error(`grim research: ${e.message}`)
    process.exit(1)
  })
}
