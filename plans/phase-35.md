# Phase 35 — paper reader + multi-source synthesis with provenance

**Authority:** hierophant, 2026-07-29. **Repo:** grimoire only. Track G-v2.
**Depends on 33 (+34).** Closes v2: read the paper too, then synthesize *across* all
gathered sources into one evidence-grounded entity — with source tracking. Track G-v2
complete after this.

## Why

Discovery (33) + repo dig (34) gather sources; a research entity should be *synthesized*
from all of them with each claim attributable to where it came from — landing page vs
repo vs paper. This is deliberately Hindsight's "Observations — evidence-grounded,
source-tracked beliefs," earned as a byproduct of real research. It also feeds the future
memory-consolidation track (provenance-at-write is what consolidation reads).

## What lands

1. **Paper reader:** for each `discovered` resource of `type: paper` (arxiv), fetch the
   readable form — arxiv `/abs/<id>` for abstract + metadata, and the **ar5iv HTML**
   (`ar5iv.org/abs/<id>` or `arxiv.org` HTML) for the methods/results sections (avoid the
   PDF binary). Extract the substantive text, bounded. One paper this phase; graceful on
   failure (note `paper: failed`, keep going).
2. **Multi-source synthesis with provenance:** the judge/extraction now runs over the
   *combined* sources — landing page + repo (34) + paper (35) — and produces an entity
   whose description/claims carry a **`sources` list** (each source URL + what it
   contributed). Store `sources` on the filed entity. For a genuine research (not a quick
   capture) drop, run synthesis with **thinking on** — this is the one place the extra
   reasoning earns its cost (contrast: v1 ran `think=false` over a shell).
3. **Re-file supersedes the shell entity:** researching a URL already filed as a thin stub
   updates it in place (`tome_update`) with the deepened, sourced content rather than
   duplicating. The provisional `system_hindsight` becomes the real thing.
4. **`--json`** carries `sources` so downstream (and grim-tavern) can show provenance.

## Out of scope / do NOT

- Not KB-wide consolidation / temporal retrieval / BM25 — that's the separate memory track
  (Track J), which *reads* the provenance this phase writes. Don't build it here.
- No PDF parsing (use ar5iv/abs HTML). No multi-paper. No new heavy deps.

## Success checks (mage runs these)

- `grim research https://hindsight.vectorize.io/` (full v2: 33+34+35) → the filed
  `system_hindsight` entity is **materially richer** than the 1129-char v1 paraphrase:
  it reflects the paper's actual mechanisms (TEMPR's four strategies, Observation
  consolidation) and the repo's real shape, with a `sources` list naming page + repo +
  paper. Paste the before/after.
- A drop with no paper → synthesis still runs over page(+repo), `sources` reflects what was
  actually used, no crash.
- Re-running on an already-filed URL updates in place (no duplicate entity).
- Footprint: `bin/grim-research.js`, tests (paper fetch + synthesis-with-sources +
  update-in-place), KB note. Track G-v2 marked complete in ROADMAP.
