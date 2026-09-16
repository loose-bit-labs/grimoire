# Phase 91 — KB Capture Quality I: ingest reads content, never mints failure stubs

**Authority:** hierophant, 2026-09-16. **Repo:** grimoire. **Track: KB Capture Quality.**
**Depends on:** nothing (independent of the bounty-board MVP; can run in parallel).

## Why (the evidence)

The KB is losing critical detail at the front door. A worked example: `~/tmp/sunfounder-PiPowerUPS.md`
(a full product spec — 5V/3A, 7.4V 2000mAh, ASIN, purchase date) produced **zero** structured capture;
instead the pipeline shredded a *different* note into 24 `research/acquisition-failed` stub entities,
each **named after a raw sentence, heading, or URL** ("* The Shared Ground: Tie a GND wire…"). Two
mechanical faults, both in `bin/grim-research.js`:

1. **Local content is routed to web acquisition.** The drop classifier treats every line/bullet/heading
   of pasted or ingested text as a "term to search" or "URL to fetch". Wiring bullets and spec rows become
   DuckDuckGo searches that 404, then failure stubs. The content was *in hand* and never read.
2. **Failed acquisition mints a durable entity.** `stubJudgment` (grim-research.js:601-615) returns a
   `DefinedTerm` named `drop` tagged `research/acquisition-failed`. One garbage node per failed line →
   the 24 we just swept. (The no-hallucinated-digest instinct there is correct; minting a node is not.)

## What lands

**A. Read-local-first.** Before any drop is classified as `url`/`term`/`reddit`, if the drop *is* local
content (multi-line text, a spec/table, a file path that exists, a markdown bullet/heading) it goes to the
**judge as content**, not to acquisition. A one-line heading or bare URL is a lead; a paragraph or a file is
content. Add a `classifyDrop` guard: `kind: 'content'` short-circuits acquisition.

**B. No failure stubs in the graph.** `stubJudgment` must **not** create a KB entity. Failed acquisitions
append to a **single** rolling backlog (a `research/backlog` entity, or `<root>/research/backlog.jsonl`) —
url + reason + date — so a lead is never lost but never pollutes entity search. Model:
`concept_research_backlog_failed_url_acquisitions_2026_09` (created during the 2026-09-16 sweep) is the
shape to extend, not re-invent.

**C. Concept-named entities.** When the judge *does* produce an entity, the name is the judged concept
(`name` from the JSON), never the raw drop text. Enforce: reject/througfix a name that is a full sentence
(>~8 words or ending in punctuation) or a URL — fall back to the judged title.

**D. Structured docs → structured capture.** When a drop is a spec sheet / table / product page (detected:
`Brand`/`Model`/`ASIN`/key:value density), the judge prompt asks for the salient fields (specs, ids, dates)
in the description, not a one-line vibe. The PiPower entity
(`concept_sunfounder_pipower_v2_raspberry_pi_ups`) is the target quality bar.

## Footprint

`bin/grim-research.js` (classifyDrop guard, stubJudgment → backlog, name guard, judge prompt for structured
docs), `test/research-capture.test.js`. Touch `lib/*` only if the backlog writer belongs there.

## Success checks

- Ingesting `~/tmp/sunfounder-PiPowerUPS.md` (or a fixture of it) yields **one** entity with the real specs
  (voltage, battery, ASIN present in description) — **zero** `acquisition-failed` entities.
- A note with 10 wiring bullets + 2 headings yields entities for the *concepts*, none named after a bullet,
  and **no** graph nodes for failed sub-lookups (backlog only).
- A genuinely-unreachable URL drop → **one** backlog append, **zero** new entities.
- No entity is created whose `name` is a full sentence or a URL.
- `node --test test/research-capture.test.js` green; full suite green + self-terminating.

## Out of scope

Archaeologist depth (that's **phase 92**). No re-fetch of the backlog URLs (phase-90 acquisition layer owns
that). No migration tool — the 2026-09-16 manual sweep already cleared the existing 24 stubs.
