# Phase 34 — grim research digs discovered repos via grim archaeologist

**Authority:** hierophant, 2026-07-29. **Repo:** grimoire only. Track G-v2.
**Depends on phase 33** (discovery). Composition, not new machinery: route a discovered
repo to the specialist grimoire already owns.

## Why

Discovery (33) finds the repo; a "research assistant" must then actually *read* it — README,
structure, key files — not just note the URL. Grimoire already has that: `grim
archaeologist` (`bin/grim-archaeologist.js`), the token-efficient 6-phase repo cataloger
(Ollama for heavy analysis). Don't reinvent repo-reading — dispatch to it.

## What lands

1. **Dispatch step:** for each `discovered` resource of `type: repo`, grim research invokes
   the archaeologist and folds its result into the research output. **First read
   `bin/grim-archaeologist.js`'s usage** (it parses argv via minimist, ~line 859+) to learn
   whether it takes a repo URL or a local path:
   - if URL: pass it directly;
   - if local path: shallow-clone to a temp dir (`git clone --depth 1`) first, then hand
     off, then clean up the temp dir.
2. **Bounded + graceful:** dig at most **one** repo (the top discovered repo) this phase;
   respect a timeout; if the clone/catalog fails, degrade — keep the base digest, note the
   repo as `dig: failed` with the reason, never crash the whole research call.
3. **Fold the archaeologist's findings into the digest** the judge sees, so the filed
   entity reflects the repo's actual content (language, structure, purpose) — not the
   landing page. Attribute it (`source: <repo-url> via archaeologist`) — this feeds the
   provenance model in phase 35.
4. **`--dry-run`** shows the archaeologist summary without writing the KB.

## Out of scope / do NOT

- Not papers (phase 35). Not multi-repo (one repo this phase). Don't modify
  grim-archaeologist itself — call it as-is; if its interface is genuinely unusable from a
  subprocess, stop and raise a `question`, don't refactor it.
- Don't leave temp clones on disk. No new deps beyond `git` (already required).

## Success checks (mage runs these)

- `grim research --dry-run https://hindsight.vectorize.io/` (with 33 landed) → the
  discovered Hindsight repo is cloned/cataloged and the summary includes real repo facts
  (languages, clients Python/TS/Go, structure) that the landing page alone never had.
  Paste it.
- Repo dig failure (bad URL / clone fails) → base digest still returns, `dig: failed` noted,
  exit 0, temp dir cleaned.
- Footprint: `bin/grim-research.js`, tests (dispatch + failure-degradation, mock the
  archaeologist call), KB note.
