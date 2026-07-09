# Phase 4 — cull spell + KB citizenship

Read `plans/ROADMAP.md` first. Requires phases 1–3 landed.

## Steps

1. **`plugin/skills/cull/SKILL.md`** — new `grimoire:cull` spell. Model it on an existing
   thin-wrapper skill in `plugin/skills/` (e.g. `oracle` or `vision` — read one first).
   Content: curate a directory of generated images via the cull UI; invocation
   `grim cull <dir> [--serve-root ... --serve-url ...]`; primary consumer is grim-world
   portrait review after a world-enrich run. Keep it short — the script owns the mechanics
   (Rule 13).
2. **KB entities** — via `grim tome remember` (upsert = forget + remember if one exists):
   - `SoftwareApplication` for **grim-cull**, **comfy-client lib** (cover both
     lib/comfy-client.js and lib/comfy-watch.js in one entity), **grim-civitai** —
     each `part_of: project_grimoire`, description noting: origin in wantan, the
     `ext/grimoire` shim arrangement, invocation, env/flag configurability.
   - `SoftwareApplication` for the **grimoire:cull spell** (CLAUDE.md rule: every new
     spell gets a KB entity — invocation, how it works, portability notes).
   - Update `project_wantan`: generic tooling (comfy client, cull, civitai downloader)
     extracted to grimoire, shims at old paths, callers unaffected; prompt pipeline
     explicitly NOT moved (pending GM session vs world-enrich).

## Success checks (run all)

```bash
grim oracle "grim-cull"          # finds the new entity
grim oracle "comfy-client"       # finds the lib entity
ls ~/src/me/grimoire/plugin/skills/cull/SKILL.md
git -C ~/src/me/grimoire status  # footprint: plugin/skills/cull/ only (KB writes are server-side)
```
