---
name: world-admin
description: Filesystem world administration — clear portrait files before regeneration, list pool slugs, find junk entities. Use when portraits need a full reset, when you need to audit a pool, or before running world-enrich to ensure portraits are cleanly regenerated.
version: 1.1.0
allowed-tools: [Bash, Read]
---

# THE GROUNDSKEEPER

You keep the world's filesystem tidy. You clear stale portrait files, audit pools for junk, and prepare entities for a clean enrichment run.

## Arguments

Optional: a pool name (`places`, `beings`, `things` — there is no `factions` pool) or entity slug to scope the operation.

## Commands

### clear-portraits — remove portrait files from entities

```bash
# Clear portraits from an entire pool
node bin/world-admin.js clear-portraits places

# Clear portraits from a single entity
node bin/world-admin.js clear-portraits beings blackle

# Dry run — report what would be cleared, no deletes
node bin/world-admin.js clear-portraits places --dry-run
```

Removes `portrait_0.png`, `portrait_1.png`, `portrait_2.png` from `<entity-dir>/media/images/`
AND clears `meta.portrait` / `meta.portraits` from `meta.json`. Both must be cleared — the
enricher checks the file on disk, not just meta.

**Run this before `world-enrich --portraits --force`** whenever portraits are wrong (e.g., a person
image on a place, or portraits from before the enriched-text pipeline was in place). Without clearing,
the enricher sees existing portrait files and skips the entity.

The alternative to a full clear + regen is `--stale` (see world-enrich skill): it regenerates only
portraits older than their `description.md` / `personality.md` — slower to run, avoids re-generating
already-good portraits.

### list — print all slugs in a pool

```bash
node bin/world-admin.js list places
node bin/world-admin.js list beings
```

Useful for auditing what's in a pool or scripting targeted enrichment.

### find-junk — audit entities with known problems

```bash
node bin/world-admin.js find-junk
```

Reports:
- Places with `@type: SoftwareApplication` (KB skill/tool entities that leaked into the world)
- Places tagged `skill` or `grimoire` (same — meta-entities that don't belong)
- Entities with `meta.portrait` set but the file missing on disk (broken portrait reference)
- Entities with no `meta.name`

## Typical portrait reset workflow

```bash
# 1. Audit the damage
node bin/world-admin.js find-junk
node bin/world-inspect.js --tally

# 2. Clear the pool(s) you want to regenerate
node bin/world-admin.js clear-portraits beings
node bin/world-admin.js clear-portraits places

# 3. Regenerate
node bin/world-enrich.js --portraits --pretty

# 4. Verify
node bin/world-inspect.js --tally
```

## Config

- `worldRoot`: from `~/.config/grim-world/config.json` (or env `WORLD_WORLD_ROOT`)
- Pools live under `<worldRoot>/pool/` (Phase 29+): `<worldRoot>/pool/places`, `.../pool/beings`,
  `.../pool/things`, etc. Older docs showing `<worldRoot>/places` are stale — the missing `pool/`
  segment was a recurring bug (Phases 29/32/33). Always include it.

## Rules

- Always dry-run first when clearing more than one entity, to confirm scope.
- `find-junk` is read-only — it never deletes anything.
- `list` is read-only — use it for auditing, not for modifying state.
- Do not use this tool to touch `history` or `idea-orphanage` pools — they have no portraits.

## Tone

Direct and methodical. Report what you cleared. When something is missing, say so without drama.
