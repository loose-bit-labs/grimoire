# Phase 14 — `grim research`: the link-backlog brain

**Authority:** hierophant, 2026-07-23. **Repo:** grimoire only. Track G. Spec origin:
the `tmp/hi/idk.md` backlog + the design dialogue (2026-07-23). Reuses THE ARCHIVIST
(`grim ingest`'s Ollama judgment) and oracle dedup — this is the *acquisition* front
half those were missing.

## What lands

`bin/grim-research.js` + `grim research <drop>` subcommand. Given one drop (a URL, a
bare term, or a short note), it:

1. **Classify** → `url` | `reddit` | `term`. (Feature-request classification is
   phase 15 — this phase files an unroutable note as a plain reference stub, no crash.)
2. **Dedup first** — `oracle` search the KB; if already known, short-circuit with a
   "saved before" digest and do **not** re-fetch or re-write.
3. **Acquire:**
   - `url` — fetch + readability-style main-text extract (a lightweight extractor;
     no headless browser).
   - `reddit` — resolve via the `.json` API (append `.json`, parse selftext/title),
     never scrape the JS page.
   - `term` — **Google Custom Search JSON API**, key + `cx` resolved from
     `config/lbl-config.json` via `lib/env.js` (add `google-search`/`google-search-cx`
     keys to the registry). **Fallback:** if no key present, scrape
     `html.duckduckgo.com/html`. Fetch the top result's text for judging.
4. **Judge** — hand acquired text to THE ARCHIVIST (reuse `grim ingest`'s Ollama
   layer): what it is, why future-you cares, and a best-guess **target project**
   (match against existing `project_*` entities in the KB).
5. **File** — write one KB entity (`SoftwareApplication` for tools/repos,
   `DefinedTerm` for concepts), `related_to` the routed `project_*` when confident,
   tagged. Metadata `source: research`, the original drop, and the date.
6. **Return** — a one-paragraph digest to stdout; `--json` emits
   `{drop, type, entityId, project, digest, deduped}` for callers (flimflam).

Flags: `--json`, `--dry-run` (classify+acquire+judge, no write), `--project <id>`
(force the route), `--timeout <ms>`.

## Out of scope / do NOT

- No feature-request entity type, no `grim features` view — phase 15.
- No Discord, no flimflam changes — phase 16.
- No headless browser, no Selenium/Playwright. Fetch + parse only.
- No batch/queue mode; one drop per invocation (a caller loops).

## Success checks (mage runs these)

- `grim research https://github.com/... --dry-run` extracts real repo text and
  produces a sane digest + project guess.
- `grim research <a reddit /s/ shortlink>` resolves via `.json` and summarizes the
  actual post (not a login wall).
- `grim research "ZLUDA"` returns a correct identification (CUDA-on-AMD) — with a key
  present via CSE, and with the key absent via the DDG fallback (test both paths;
  stub/mocked HTTP acceptable for the offline test, one live smoke run for real).
- Running the same drop twice: second run reports `deduped: true`, writes nothing.
- Real-backlog smoke: feed 3 assorted `tmp/hi/idk.md` lines, entities land in the KB
  routed to plausible projects.
- Footprint: `bin/grim-research.js`, `bin/grim.js` (dispatch entry),
  `config/lbl-config.json` (+ its schema/validation if any), `lib/env.js` (resolver
  for the new keys), one test file, one KB entity documenting the tool.
