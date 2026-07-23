# Phase 15 — feature requests: capture intent, list it per project

**Authority:** hierophant, 2026-07-23. **Repo:** grimoire only. Track G closer.
Depends on phase 14 (`grim research` core) — do not start before 14 is accepted.

Half the backlog isn't a link to research — it's intent: "Npc system needs gossip
mechanism", a mod reference for the game, a level-design idea. Those deserve a
first-class shape so a project can answer *"what have I wanted to add to you?"*

## What lands

1. **Fourth classification** in `grim research`: `feature-request`. Triggers when the
   drop reads as an intent/idea/reference-for-a-project rather than a thing to
   identify (THE ARCHIVIST judges; a `--feature` flag forces it). No web acquisition —
   the note (plus any referenced URL, fetched as supporting context) *is* the content.
2. **New entity shape:** feature-request entities — a `@type` of `CreativeWork` (or a
   documented `meta_feature_request_*` id convention, mage's call on cleanest fit),
   `related_to` the target `project_*`, tagged `needs-triage`. Carries the idea, the
   source drop, and the date. **These are capture only — never auto-promoted to
   ROADMAP phases. Promotion is a deliberate hierophant read.**
3. **`grim features <project>`** and **`grim features --all`** — a read command over
   the graph listing feature-request entities, grouped by project, `needs-triage`
   first. `--json` for machine use. This is the payoff view.

## Out of scope / do NOT

- No roadmap/phase-brief generation, no `.mm/` writes, no auto-triage. Capture + list
  only. The hierophant→mage loop stays the only path from idea to built phase.
- No edits to the url/reddit/term paths from phase 14 beyond adding the branch.
- No Discord/flimflam — phase 16.

## Success checks (mage runs these)

- `grim research "Npc system needs gossip mechanism"` files a `feature-request`
  entity routed to the game project, tag `needs-triage`, zero web fetch.
- `grim features <that project>` lists it; `grim features --all` groups every
  project's pile; `--json` parses.
- A url-drop that's clearly a feature reference (e.g. the threejs procedural-dungeon
  repo) fetches the repo for context **and** files as a feature-request routed to the
  game project — not a bare reference.
- Feature-request entities never appear in ROADMAP or `.mm/` (grep proves it).
- Footprint: `bin/grim-research.js`, `bin/grim-features.js` (or a `features`
  subcommand — pick one, keep it small), `bin/grim.js` dispatch, one test file, one
  KB entity documenting the feature-request convention.
