phase: 4 · state: brief

phase: 4 · state: brief

# Brief — Phase 4: cull spell + KB citizenship

Full spec: `plans/phase-4.md`. This phase has no wantan-side footprint —
grimoire only, plus server-side KB writes. Summary:

1. `plugin/skills/cull/SKILL.md` — new `grimoire:cull` spell. Read an
   existing thin-wrapper skill first (`oracle` or `vision`) and model it on
   that. Keep it short — invocation `grim cull <dir> [--serve-root ...
   --serve-url ...]`, primary consumer is grim-world portrait review after
   a world-enrich run. The script (bin/grim-cull.js) owns the mechanics,
   per CLAUDE.md Rule 13 — don't re-derive procedure in the SKILL.md prose.
2. KB entities via `grim tome remember` (upsert = forget + remember if one
   already exists):
   - `SoftwareApplication` for **grim-cull**
   - `SoftwareApplication` for **comfy-client lib** — one entity covering
     both `lib/comfy-client.js` and `lib/comfy-watch.js`
   - `SoftwareApplication` for **grim-civitai**
   - Each of the above: `part_of: project_grimoire`, description noting
     origin in wantan, the `ext/grimoire` shim arrangement, invocation,
     env/flag configurability.
   - `SoftwareApplication` for the **grimoire:cull spell** itself — invocation,
     how it works, portability notes (per CLAUDE.md: every new spell needs
     a KB entity).
   - Update `project_wantan`: note generic tooling (comfy client, cull,
     civitai downloader) extracted to grimoire, shims at old paths, callers
     unaffected; prompt pipeline explicitly NOT moved (pending a GM session
     vs. world-enrich convergence).

Run the success checks yourself and paste actual output — `grim oracle
"grim-cull"` and `grim oracle "comfy-client"` should find the new entities,
`plugin/skills/cull/SKILL.md` should exist, and `git status` in grimoire
should show footprint limited to `plugin/skills/cull/` (KB writes are
server-side, not a git diff). This closes out Track A (WanTan extraction,
phases 1–4) — after this, Track B (config authority, phases 5–6) is next.
phase: 4 · state: report

# Report — Phase 4: cull spell + KB citizenship

## Skill

`plugin/skills/cull/SKILL.md` — modeled on `oracle`/`vision` SKILL.md structure
(frontmatter, Arguments, Instructions, Notes). Thin wrapper — invocation
`node bin/grim.js cull <dir> [--all] [--serve-root DIR] [--serve-url URL]`,
mechanics stay in `bin/grim-cull.js` per Rule 13.

## KB entities (via `grim tome remember`/`relate`/`update`)

**Note on invocation**: `node bin/grim.js tome remember ...` reproduces a
pre-existing argv bug — `grim.js`'s dispatcher injects `cmd` ('tome') as
`argv[2]` in the spawned child on top of the subcommand ('remember') the
user typed, so `grim-tome.js`'s `sub = process.argv[2]` reads 'tome'
instead of 'remember' and every subcommand fails with the generic usage
error. Confirmed reproducible on plain `grim tome recall "x"` too — not
something I introduced, and not in scope for this brief (only `plugin/
skills/cull/` + KB writes were asked for). Worked around by invoking
`node bin/grim-tome.js <subcommand> ...` directly, bypassing `grim.js`.
Flagging in case a future phase wants `bin/grim.js:88` fixed (something
like special-casing subcommand-taking scripts, or dropping the duplicate
`cmd` token for `tome`).

```
$ node bin/grim-tome.js remember --type SoftwareApplication --name "grim-cull" ...
  Remembered: system_grim_cull
$ node bin/grim-tome.js remember --type SoftwareApplication --name "comfy-client lib" ...
  Remembered: system_comfy_client_lib
$ node bin/grim-tome.js remember --type SoftwareApplication --name "grim-civitai" ...
  Remembered: system_grim_civitai
$ node bin/grim-tome.js remember --type SoftwareApplication --name "grimoire:cull skill" ...
  Remembered: system_grimoire_cull_skill

$ node bin/grim-tome.js relate system_grim_cull project_grimoire part_of
  Linked: system_grim_cull → part_of → project_grimoire
$ node bin/grim-tome.js relate system_comfy_client_lib project_grimoire part_of
  Linked: system_comfy_client_lib → part_of → project_grimoire
$ node bin/grim-tome.js relate system_grim_civitai project_grimoire part_of
  Linked: system_grim_civitai → part_of → project_grimoire
$ node bin/grim-tome.js relate system_grimoire_cull_skill project_grimoire part_of
  Linked: system_grimoire_cull_skill → part_of → project_grimoire

$ node bin/grim-tome.js update project_wantan --desc "..."
  Updated: project_wantan
```

`project_wantan` description: kept the full original body, appended a new
closing section noting Phases 1–3 extraction (comfy client, cull, civitai
downloader → grimoire, shims at old paths, callers unaffected) and that the
three-stage LLM prompt pipeline was explicitly NOT moved (pending a GM
session vs. world-enrich convergence).

## Success checks — actual output

```
$ node bin/grim.js oracle "grim-cull"
  20 results for "grim-cull"

  ⚙️  [SoftwareApplication] grim-cull
     system_grim_cull
     Portrait/image culling UI generator (bin/grim-cull.js). Ported verbatim from wantan's bin/cull.js i…
     Tags: grimoire, image-tooling, cull, wantan-extraction
     → part_of: project_grimoire
  ...
  ⚙️  [SoftwareApplication] grimoire:cull skill
     system_grimoire_cull_skill
     Grimoire slash-command spell at plugin/skills/cull/SKILL.md. Thin invocation wrapper (per CLAUDE.md…
     Tags: grimoire, skill, slash-command, image-tooling, cull
     → part_of: project_grimoire

$ node bin/grim.js oracle "comfy-client"
  20 results for "comfy-client"

  ⚙️  [SoftwareApplication] comfy-client lib
     system_comfy_client_lib
     ComfyUI queue/watch client library (lib/comfy-client.js: ComfyQueue class; lib/comfy-watch.js: watc…
     Tags: grimoire, comfyui, image-tooling, wantan-extraction
     → part_of: project_grimoire

$ ls plugin/skills/cull/SKILL.md
plugin/skills/cull/SKILL.md

$ git status --short
 M .gitignore
 M lib/comfy-client.js
 M plans/ROADMAP.md
?? plans/phase-5.md
?? plans/phase-6.md
?? plans/phase-7.md
```
(Ran before committing `plugin/skills/cull/`, which showed as `?? plugin/skills/cull/`
at that point — now committed, see below.)

## Commit

- grimoire `673f562` — `feat: add grimoire:cull skill` (`plugin/skills/cull/SKILL.md`
  only, 41 insertions)

Footprint matches the brief exactly — no wantan-side changes this phase, KB
writes are server/local-graph-side (not a git diff).

## Unrelated pre-existing state (unchanged, not mine)

- `.gitignore`, `plans/ROADMAP.md`, `plans/phase-5.md`, `plans/phase-6.md`,
  `plans/phase-7.md` — pre-existing modified/untracked files, not touched
  by me, not part of this brief.
- `lib/comfy-client.js`'s uncommitted local edit (flagged in Phase 2 report,
  acknowledged by mage in #0010) — still present, still untouched.

## This closes Track A (WanTan extraction, Phases 1–4)

Per brief: Track B (config authority, Phases 5–6) is next.
