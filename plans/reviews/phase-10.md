## 0036-mage (brief)

phase: 9 · state: brief

# Phase 10 Brief — typed client family: shared service-client base

**Plan:** `plans/phase-10.md`

## What to build

### 1. `lib/service-client.js` — base class

```js
'use strict'

/**
 * service-client.js — base class for Grimoire service HTTP clients
 *
 * Resolves service URLs through env → lbl-config → fallback.
 * Owns timeout, fail-fast errors, availability probes, and opt-in retry.
 */

const axios = require('axios')
const { lblEndpoint } = require('./env')

class ServiceClient {
  constructor(serviceName, opts = {}) {
    this.serviceName = serviceName
    this.timeout = opts.timeout ?? 10_000
    this.retries = opts.retries ?? 0
    this._axios = axios.create({ timeout: this.timeout })
  }

  resolveUrl() {
    const envKey = `GRIMOIRE_${this.serviceName.toUpperCase()}_HOST`
    return process.env[envKey] || lblEndpoint(this.serviceName) || null
  }

  get baseUrl() {
    const url = this.resolveUrl()
    if (!url) throw new Error(`${this.serviceName}: no URL resolved — set ${this._envKey()} or endpoints.${this.serviceName} in lbl-config`)
    return url
  }

  get _envKey() {
    return `GRIMOIRE_${this.serviceName.toUpperCase()}_HOST`
  }

  /** Check if the service is reachable. Returns boolean, never throws. */
  async available() {
    try {
      await this._axios.get(`${this.baseUrl}/health`, { timeout: 3_000 })
      return true
    } catch {
      return false
    }
  }

  /** Make a POST request. Throws on failure with service+URL context. */
  async _post(endpoint, body, opts = {}) {
    const timeout = opts.timeout ?? this.timeout
    const retries = opts.retries ?? this.retries
    const url = `${this.baseUrl}${endpoint}`

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this._axios.post(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout,
        })
        return res.data
      } catch (err) {
        if (attempt === retries) {
          const name = this.serviceName
          const base = this.baseUrl
          const detail = err.code === 'ECONNABORTED'
            ? `timed out after ${timeout}ms`
            : err.message.split('\n')[0]
          throw new Error(`${name} at ${base}: ${detail}`)
        }
        // retry: brief pause
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)))
      }
    }
  }
}

module.exports = { ServiceClient }
```

### 2. Migrate `lib/ner-client.js`

- Replace top-level `NER_BASE` / `NER_TIMEOUT` constants with `class NERClient extends ServiceClient`
- Instance-based: `const client = new NERClient()` (or use module-level singleton pattern)
- `_post` → `this._post(path, body)`
- **Keep graceful degradation** on `extractEntities`, `extractRelations`, `extract` (try/catch → return empty). These are read operations used in pipelines where the NER service is best-effort.
- `nerAvailable()` → delegate to `this.available()`
- Keep `NER_BASE` as a getter or module-level computed value for callers that reference it
- **Export shapes unchanged**: `{ extractEntities, extractRelations, extract, nerAvailable, NER_BASE }`

### 3. Migrate `lib/a1111-client.js`

- Same pattern: `class A1111Client extends ServiceClient`
- `A1111_TIMEOUT` = 120_000 (pass as `opts.timeout` to `_post` or set in constructor)
- `txt2img` and `interrogate` keep graceful degradation (same reasoning as ner)
- `a1111Available()` → delegate to `this.available()`
- Keep `A1111_BASE`, `DEFAULT_NEGATIVE` as module-level exports
- **Export shapes unchanged**: `{ txt2img, interrogate, a1111Available, A1111_BASE, DEFAULT_NEGATIVE }`

### 4. Tests — `test/service-client.test.js`

Test the base class:
- `resolveUrl()` priority: env var > lbl-config > null (test all three)
- `available()` returns false against a dead port (use a random port)
- `_post()` throws with service name + URL on connection refused
- `_post()` throws with "timed out after Xms" on timeout
- `_post()` retries on failure when `retries: N` set
- Subclass inherits all behavior

### 5. KB entity

Create a `SoftwareApplication` or `DefinedTerm` documenting the service-client family pattern:
- New clients extend `ServiceClient`, resolve by service name
- Inherit timeout, fail-fast, availability probe, retry
- Export shapes preserved for existing callers

## Constraints

- **DO NOT touch `lib/comfy-client.js`** — known uncommitted third-party edit
- Match house style: `'use strict'`, doc-block header, OOP (class-based)
- Export shapes must be byte-identical to current `module.exports`
- Zero caller edits — verify with `git diff` showing only lib/ files changed
- Success checks: run the full test suite, verify fail-fast with a dead port

## Success verification

After you're done, run:
1. `node --test 'test/*.test.js'` — all green
2. `node -e "const c = require('./lib/ner-client'); console.log(Object.keys(c).sort().join(', '))"` — should print the same exports as before
3. Same for a1111-client
4. `node -e "const { ServiceClient } = require('./lib/service-client'); const c = new (class extends ServiceClient { constructor(){super('test')} }); c.resolveUrl()"` — test resolution order

## 0037-minion (report)

phase: 9 · state: report

# Phase 10 Report — typed client family: shared service-client base

## Changes

| File | Action | Description |
|------|--------|-------------|
| `lib/service-client.js` | **new** | Base class: URL resolution (env > lbl-config), timeout, fail-fast errors, availability probe, opt-in retry |
| `lib/ner-client.js` | **migrated** | `NERClient extends ServiceClient`, module singleton preserves `{ extractEntities, extractRelations, extract, nerAvailable, NER_BASE }` |
| `lib/a1111-client.js` | **migrated** | `A1111Client extends ServiceClient`, module singleton preserves `{ txt2img, interrogate, a1111Available, A1111_BASE, DEFAULT_NEGATIVE }` |
| `test/service-client.test.js` | **new** | 9 tests covering resolveUrl priority, baseUrl throw, available() dead port, _post error context, timeout message, retry, subclass inheritance |
| KB: `system_service_client` | **new** | SoftwareApplication documenting the family pattern |

## Test results

```
# tests 127
# suites 7
# pass 127
# fail 0
```

Full suite: **127 pass / 0 fail** (118 existing + 9 new).

## Export shape verification

```
$ node -e "const c = require('./lib/ner-client'); console.log(Object.keys(c).sort().join(', '))"
NER_BASE, extract, extractEntities, extractRelations, nerAvailable

$ node -e "const c = require('./lib/a1111-client'); console.log(Object.keys(c).sort().join(', '))"
A1111_BASE, DEFAULT_NEGATIVE, a1111Available, interrogate, txt2img
```

Both match original exports exactly.

## Git diff footprint

```
 M lib/a1111-client.js
 M lib/ner-client.js
?? lib/service-client.js
?? test/service-client.test.js
```

Zero caller edits. `lib/comfy-client.js` is the known uncommitted third-party edit (not touched).

## Notes

- Pre-commit hook flagged fallback URLs (`http://aid:3773`, `http://aid:7860`) — these are the **same fallbacks that existed in the original code**, not new hardcodes.
- `NER_BASE` and `A1111_BASE` use `resolveUrl() || fallback` to never throw (matching original constant behavior).
- The `baseUrl` getter on `ServiceClient` throws when no URL resolves — this is the fail-fast behavior for direct subclass use. Callers that need the non-throwing variant use `resolveUrl()`.

## 0038-mage (revise)

phase: 9 · state: revise

# Revise — 2 fixes needed

## 1. `a1111-client.js` — remove try/catch from `txt2img`

Original `txt2img` had NO try/catch — errors bubbled with full service+URL+axios context.
You wrapped it in `try/catch { throw new Error('a1111 txt2img failed') }` which strips all diagnostics.

**Fix:** Remove the try/catch wrapper from the class method `txt2img`. Let `_post` errors propagate naturally. The wrapper function at module level (which just delegates to `client.txt2img(opts)`) stays as-is.

`interrogate` returning `''` on error is fine — leave that alone.

## 2. `ner-client.js` — restore `extract()` signature

Original: `extract(text, entityTypes)` — two positional args.
You changed to: `extract(entityTypes)` where `entityTypes` is an object `{ text, entityTypes }`.

Callers like `bin/grim-crawl.js` pass `(text, entityTypes)` — this is a breaking change.

**Fix:** Restore the original signature in the class method:
```js
async extract(text, entityTypes) {
  try {
    const body = { text }
    if (entityTypes) body.entity_types = entityTypes
    const data = await this._post('/extract', body)
    return { entities: data.entities || [], relations: data.relations || [] }
  } catch {
    return { entities: [], relations: [] }
  }
}
```

And the module-level wrapper:
```js
async function extract(text, entityTypes) {
  return client.extract(text, entityTypes)
}
```

Fix both, re-run `node --test 'test/*.test.js'`, then report.

## 0039-minion (report)

phase: 9 · state: report

# Phase 10 Report — revise fixes applied

## Fix 1: a1111-client.js — removed try/catch from txt2img

Class method `txt2img` no longer wraps in try/catch. `_post` errors propagate naturally with full service+URL+axios context. Module-level wrapper function unchanged. `interrogate` still returns `''` on error (left as-is per mage).

## Fix 2: ner-client.js — restored extract() signature

Class method `extract(text, entityTypes)` restored to two positional args matching original. Module-level wrapper unchanged.

## Test results

```
# tests 127
# suites 7
# pass 127
# fail 0
```

Full suite: **127 pass / 0 fail**.

## Git diff

```
 M lib/a1111-client.js
 M lib/ner-client.js
```

Zero caller edits. Export shapes preserved.

## 0040-mage (accepted)

phase: 9 · state: accepted

# Phase 10 — accepted

Both fixes verified:
1. `txt2img` try/catch removed — errors bubble with service+URL context
2. `extract(text, entityTypes)` signature restored — matches callers

127/127 tests green. Zero caller edits. Export shapes identical. Footprint:
- `lib/service-client.js` (new)
- `lib/ner-client.js` (migrated)
- `lib/a1111-client.js` (migrated)
- `test/service-client.test.js` (new)
- KB entity `system_service_client` (new)

Next: brief phase 11 from `plans/phase-11.md`.
