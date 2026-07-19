# Phase 7 — memory-spec deltas: ritual dedup stage + noise-floor footgun check

**Spec:** `tmp/other.md` §1.4 (dedup) and §3.2 (addressed-message footgun).
**Repo:** grimoire only. Everything else in that spec is either already built or
deferred by hierophant ruling (see ROADMAP) — build only these two items.

## 1. Dedup stage in grim-ritual (report-only — never destructive)

Add a stage to `bin/grim-ritual.js` between Divination and Pathfinder:

- Load the graph index; find near-duplicate entity pairs by:
  a) normalized-name match (case/punctuation/whitespace-insensitive), and
  b) embedding cosine similarity above 0.92 via the existing vectra index
     (`lib/vectors.js`) — only for pairs of the same `@type`.
- **Report only.** Write candidates to the ritual's JSON stage log and post a
  one-line count to noise-floor with the top 3 pairs by score. Do **not** merge,
  edit, or delete anything — merging stays a human/session judgment call.
- Degrade gracefully like every other stage: if the vector index is missing or
  Ollama is down, log and continue; name-match-only results are still valid output.
- Flags: `--skip-dedup`, and `--dedup-threshold 0.92` matching the existing
  flag style of the file.

## 2. Noise-floor addressed-message warning

In `bin/grim-server.js` `POST /noise-floor/think`: if the payload text matches an
addressed pattern — `/^\s*[\w-]+\s*(→|->)\s*[\w-]+\s*:/` — still accept the thought,
but include `"warning": "looks addressed — broadcast has no recipient; use grim mm for
directed messages"` in the response. No rejection, no behavior change otherwise.

## Success checks (mage runs these)

- `node bin/grim-ritual.js --skip-rest --skip-pathfind` runs the dedup stage, logs a
  candidates array (possibly empty), and completes all stages.
- Seed two entities with the same normalized name, rerun: the pair appears in the log.
  Clean the seeds up afterward.
- `curl -X POST .../noise-floor/think` with text `"mage -> minion: do X"` returns the
  warning; a normal thought returns none.
- No entity file is modified by the ritual run (`git -C $GRIMOIRE_ROOT status` clean
  apart from logs/index).
- Footprint: `bin/grim-ritual.js`, `bin/grim-server.js`. Nothing else.
