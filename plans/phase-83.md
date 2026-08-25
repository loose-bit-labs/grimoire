# Phase 83 — Research: semantic dig mode (`grim-archaeologist` + `grim-research`)

**Authority:** hierophant, 2026-08-24. **Repo:** grimoire. **Track: G-v3 (research durability).**
**Depends on:** phase 82 (the size/binary guards must exist first — semantic mode still walks the tree).

## Why

User direction (2026-08-24): a research dive doesn't need to understand *every file* in a repo. It
needs the **semantic content** — *what it does, how it's useful, why we care, what it relates to, and
what concepts it represents* — more than a per-file code/data catalog. Deep static analysis and
data-flow are still worthwhile, but a **lower-priority, opt-in, background-level** activity, not the
default dive. The standalone `/grimoire:archaeologist` catalog behavior is **unchanged** — this is a
new mode the research path selects, not a replacement (confirmed 2026-08-24).

## What lands

- **`bin/grim-archaeologist.js`** — add a `mode` option to `runDig(dir, { hints, mode })`:
  - `mode: 'catalog'` (**default**, current behavior) — per-file analysis then synthesis. Unchanged
    for the standalone skill.
  - `mode: 'semantic'` (**new**) — skip the exhaustive per-file `buildFilePrompt` loop. Instead read
    only the **spine**: README(s), the entry point(s), `package.json`/`pyproject.toml`/`Cargo.toml`,
    and the top-level directory shape (names + sizes, not contents). Feed that spine to a single
    synthesis call whose system prompt asks for: **purpose** (what it does), **usefulness** (how/why
    we'd use it), **relationships** (what it connects to / depends on / competes with), and **concepts**
    (named techniques/patterns it represents). Output the same `final.md` shape so downstream is
    unchanged. Reuse the existing size/binary guards from phase 82 on every read.
  - A new `SEMANTIC_SYSTEM` prompt constant beside `ARCH_SYSTEM`. Route the synthesis via
    `task: 'linking'` (fleet — benefits from the qwen3.8 upgrade on meinherz).
- **`bin/grim-research.js`** — `digRepo` calls `runDig(tmpDir, { hints:'', mode: 'semantic' })` so
  every dive defaults to the semantic lens. No change to how the result folds into `acquired.text`.
- **Deep analysis stays available, demoted:** `mode: 'catalog'` remains reachable (standalone skill,
  or a future opt-in `grim research --deep`). Do **not** wire a background deep-analysis queue in this
  phase — just leave the catalog mode intact and document that deep dives are opt-in. (A background
  deep-analysis tier is a later phase if we want it; not now.)

## Footprint

`bin/grim-archaeologist.js`, `bin/grim-research.js`, `test/grim-archaeologist.test.js`,
`test/grim-research.test.js`. If the standalone `/archaeologist` skill doc names the modes, update
`plugin/skills/archaeologist/SKILL.md` (mode note only).

## Success checks

- **Default unchanged:** `runDig(dir)` with no mode still produces per-file analyses + synthesis
  (existing catalog test stays green).
- **Semantic mode skips the file loop:** `runDig(fixtureRepo, { mode:'semantic' })` on a fixture with
  many small source files makes **no** per-file `buildFilePrompt` call (spy/stub the model), reads only
  README/entry/manifest, and still writes a `final.md` covering purpose/usefulness/relations/concepts.
- **Research path is semantic:** `grim research <github-url> --dry-run` invokes `digRepo` → `runDig`
  with `mode:'semantic'` (assert the arg), and the digest reflects purpose-level synthesis, not a file
  catalog.
- `node --test test/grim-archaeologist.test.js test/grim-research.test.js` green; full suite green +
  self-terminating.

## Out of scope

- Memory guards — phase 82 (assumed present).
- The durable queue / `--timeout 0` — phases 84 + 68.
- Building a background deep-analysis worker — deferred; this phase only preserves catalog mode as the
  opt-in path.
