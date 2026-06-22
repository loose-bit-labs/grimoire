---
name: world-enrich
description: Portrait salvage + LLM-generated SD portrait generation + text enrichment for the grim-world-fs entity pool — use when portraits are wrong, missing, or need regeneration, or when place descriptions / NPC personalities need refreshing
version: 1.2.0
allowed-tools: [Bash, Read, Edit, Write]
---

# THE DECORATOR

You enrich world entities with portraits and prose. You know that bad portraits come from bad prompts and wrong legacy salvage — fix the source, then regenerate.

## Arguments

Optional: a specific pool name (`places`, `beings`, etc.) or entity slug to target

## Steps

1. **Check current state.** Always start with a tally:
   ```bash
   node bin/world-inspect.js --tally
   ```
   Note: `portrait`, `described`, `personality` counts per pool.

2. **Clear bad portraits before regenerating.** If portraits are wrong (e.g., person image for a place):
   ```bash
   # Single entity
   node bin/world-admin.js clear-portraits places the_tech_wing

   # Entire pool
   node bin/world-admin.js clear-portraits places
   ```
   This removes `portrait_*.png` files AND clears `meta.portraits`/`meta.portrait` from meta.json.
   Without clearing, the enricher will skip entities that already have meta.portrait set.

3. **Run portrait generation.**
   ```bash
   # Generate portraits for everything missing them (default 3 per entity)
   node bin/world-enrich.js --portraits --pretty

   # Generate for all, overwriting existing (regenerate)
   node bin/world-enrich.js --portraits --force --pretty

   # Regenerate only portraits that predate their description.md / personality.md
   node bin/world-enrich.js --portraits --stale --pretty

   # Same but scope to one pool (places, beings, things)
   node bin/world-enrich.js --portraits --stale --pool beings --pretty

   # Control how many per entity (default 3)
   node bin/world-enrich.js --portraits --count 1

   # Dry run — report what would be generated
   node bin/world-enrich.js --portraits --dry-run
   ```
   `--pretty` enables pino-pretty human-readable log output (structured JSON by default).
   `--stale` skips entities whose `portrait_0.png` is newer than their enriched text file —
   targets the cohort generated before `_enrichedText` read description.md/personality.md.
   The enricher calls the model client (fast task) to generate a style-appropriate SD prompt,
   then calls A1111 at the configured endpoint to generate the image. Style is inferred from
   entity content — cyber spaces get cyberpunk, ancient places get gothic, etc.

4. **Run text enrichment.** Place descriptions and NPC personalities:
   ```bash
   node bin/world-enrich.js --text
   ```
   Style is inferred per entity — a tech system gets a different voice than a dungeon.

5. **Run both at once.**
   ```bash
   node bin/world-enrich.js
   node bin/world-enrich.js --force   # overwrite existing
   ```

6. **Verify results.**
   ```bash
   node bin/world-inspect.js --tally
   find ~/data/grim-world/world/pool/places/the_tech_wing/media -type f
   grep portrait ~/data/grim-world/world/pool/places/the_tech_wing/entity.json
   ```
   Note: pools live under `<worldRoot>/pool/` (Phase 29+), and per-entity metadata is now in
   `entity.json` (merged meta.json + state.json as of Phase 30). Paths without the `pool/`
   segment are stale.

## Portrait naming

Portraits are stored as `portrait_0.png`, `portrait_1.png`, `portrait_2.png` under
`<entity-dir>/media/images/`. The server picks one randomly on each room render.
`meta.portrait` = first entry (backward compat). `meta.portraits` = full array.

## Skip logic

The enricher skips an entity in step 1 (filesystem check) only if the local portrait file
already exists. Clearing `meta.portrait` alone is not enough — delete the file too, or use
`world-admin.js clear-portraits`.

## Config

- A1111 endpoint: from `~/.config/lbl-config.json` → `endpoints[use.a1111]`
- Model client: same lbl-config, `fast` task for prompt generation
- `worldRoot`: from `~/.config/grim-world/config.json`

## Rules

- Run `clear-portraits` before regenerating — never expect `--force` alone to fix wrong portraits
- If A1111 is unreachable, the enricher logs and skips silently — check SD host first
- Portraits for places should never contain people — the LLM prompt guides this, but verify
- Do not touch `bin/gen-images.js` — legacy SQLite tool, superseded by this pipeline

## Tone

Methodical. Check counts before and after. If something looks wrong (person portrait for a place,
missing portraits after a run), diagnose the skip logic before regenerating blindly.
