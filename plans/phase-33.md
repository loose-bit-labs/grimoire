# Phase 33 — grim research: autonomous resource discovery (link-scan + search fallback)

**Authority:** hierophant, 2026-07-29. **Repo:** grimoire only. Track G-v2 (research
brain). Foundation of v2 — 34/35 build on it. The thesis: *one drop in, the tool finds
what's worth reading itself.* If the human has to name the repo, the tool failed.

## Why

`bin/grim-research.js` acquire is a single raw `httpGet` + `extractText` with **no link
discovery**. On `hindsight.vectorize.io` (a React SPA) it got ~1742 prompt-tokens of shell
and never noticed the page points at a GitHub repo and an arxiv paper — where all the
substance lives. Discovery must be automatic and must survive thin/SPA pages.

## What lands

1. **Link-scan the acquired text** for high-value resources (deterministic, Rule 5):
   `github.com/<org>/<repo>`, `arxiv.org/abs/<id>` (and `/pdf/`), `doi.org`, and obvious
   docs links. Normalize + dedup. Return a typed list: `{type: repo|paper|doc, url}`.
2. **Thin-yield detection → search fallback.** If `extractText` yields below a threshold
   (e.g. < ~600 chars of real text → SPA/marketing shell), **reuse the existing CSE→DDG
   search** (the term-classification path already has it) to find canonical resources:
   query `"<page title or drop> github"` and `"<title> arxiv paper"`, take the top hit of
   each, classify by host. This is what surfaces the repo when the SPA shell hides the
   `href`. No new dep — reuse `googleCseSearch`/`ddgSearch`.
3. **Expose discovery in the pipeline + `--json`**: the acquired object gains
   `discovered: [{type, url, via: 'link-scan'|'search'}]`. Bound it: **max ~4 resources,
   depth 1** (discovered resources are NOT themselves re-scanned in this phase).
4. **`--dry-run` prints the discovered list** so the acceptance test is observable without
   writing the KB.

## Out of scope / do NOT

- No fetching/digging of the discovered resources yet (that's 34 for repos, 35 for
  papers). This phase only *finds* them.
- No headless browser / JS rendering — the search fallback deliberately sidesteps that.
  Do not add a heavy rendering dep.
- No new npm deps; reuse the existing http + search helpers.

## Success checks (mage runs these, pastes output)

- `grim research --dry-run https://hindsight.vectorize.io/` → `discovered` includes the
  Hindsight **GitHub repo** and the **arxiv paper**, found via the search fallback (the
  page is a thin SPA). This is THE test — paste the discovered list.
- A content-rich page with inline github/arxiv links → they're found via link-scan
  (`via: 'link-scan'`), no search needed.
- A plain article with no such links → `discovered: []`, no crash, normal digest still
  produced.
- Bounded: never returns more than the cap; depth-1 only.
- Footprint: `bin/grim-research.js`, tests (link-scan unit + thin-yield→search path,
  mock the search), KB entity note on the discovery contract.
