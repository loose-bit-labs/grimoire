# Phase 90 — Acquisition layer: clone, render, and refuse thin hauls

**Authority:** grimoire session on aid, 2026-09-07 (user-directed). **Repo:** grimoire. **Track: G-v3 cont. (research dig).**
**Depends on:** 84 (queue), 89 (dig-clone hardening). Requirements already recorded: `meta_technique_swandive_dive_acquisition_rules_playwright_for_reddit_clone_` (2026-08-07 — still unimplemented).

## Why

Empirical, from the phase-85 backfill drain (verified 2026-09-07): 2 of 10 dives are **duds** —
`prime-agent` and `RPLidar C1M1-R2` landed as entities whose entire "digest" is a raw page/title
string (`Already known: [...] — Acquired text from <title>`). The prime-agent drop points at a GitHub
repo, which the raw `httpGet + extractText` path can only ever answer with the HTML shell. The v1
acquire path is one fetch with no JS render, no clone, and **no minimum-haul floor** — a title-only
fetch is recorded as `researched`, so failure masquerades as success and the queue never retries.

The recorded acquisition rules were written on 2026-08-07 and nothing implemented them. Dives going
forward (bounty board, swandive drops) are only worth the model tokens if the haul is real.

## What lands

- **Host-routed acquisition in `bin/grim-research.js`**:
  - **Repo URLs** (github.com / gitlab.com, direct drops — not just link-scanned ones): route to the
    phase-89 clone path — `git clone --depth 1` into `~/src/3rd/<repo>` and read the local tree
    (README + catalogable surface), never the rendered site. Clone failure (auth/junk) stays a
    graceful dig-failure.
  - **JS-blocked hosts** (reddit.com, x.com): fetch via a **headless browser** (Playwright chromium is
    present on this machine via the plugin ecosystem; pick the acquisition dep deliberately, it is a
    footprint decision). A challenge/block page is *not* a haul.
  - Everything else: existing raw-fetch path unchanged.
- **Thin-haul floor**: if acquired text is below a small threshold (say < ~400 chars) or the fetch
  landed on a login/challenge/title-only shell, mark `acquisitionFailed: true` with a `reason` — do
  **not** write a title-only entity, do not mark the entry `researched`. Queue semantics stay: failed
  is terminal and deliverable (the 🩸 embed), not a silent dud.
- **Backfill the two duds**: prime-agent + RPLidar entries get re-acquired under the new rules as the
  acceptance demonstration (re-enqueue with fresh ids; old entities superseded or updated).

## Footprint

`bin/grim-research.js` (acquire dispatch + thin-haul floor), `test/grim-research.test.js`, possibly a
new `package.json` dep (playwright-core pointing at the system chromium — decide in review). Nothing
in the queue/transport layer.

## Success checks

- A GitHub repo drop → entity digest reflects README/source content (multi-paragraph), not a title.
- A reddit thread drop → digest reflects thread/comment text (or fails loud, never a challenge page).
- A title-only fetch is recorded `failed` with `reason: thin-haul`, never `researched`.
- The two backfilled duds re-run and produce real digests.
- Full test suite green vs baseline.

## Out of scope

- Per-site extractors, archive/cache tiers, parallel acquisition. The link-scan dig path is untouched
  except via the shared clone helper.
