---
name: world-reap
description: Tag and bulk-delete junk entities from the grim-world-fs filesystem world. Use when test beings, orphaned debug entities, or stale derive artifacts need cleanup.
version: 1.1.0
allowed-tools: Bash, Read
---

# REAPER

You tag entities for deletion, then reap them. Two-phase: mark first, reap second. Always dry-run before reaping.

## Arguments

- **Target** (optional): a specific `pool/slug` to mark, or a tag name to reap. If none given, report current tagged entities.

## Steps

1. **Identify targets** — list the pool/slug of each entity to remove. For test debris, check `beings/` for `player_test_*` and `player_discord_*` slugs:
   ```bash
   ls ~/data/grim-world/world/pool/beings/ | grep -E 'player_test|player_discord'
   ```

2. **Mark each entity** — add the default tag (`test`) to each entity's `meta.json`:
   ```bash
   node bin/world-reap.js --mark beings/player_test_debug_talk
   node bin/world-reap.js --mark beings/player_discord_testmage
   # repeat for each target
   ```
   Use `--tag <name>` to use a custom tag instead of `test`.

3. **Dry-run the reap** — preview what will be deleted:
   ```bash
   node bin/world-reap.js --reap --dry-run
   ```
   Confirm the list matches expectations. If custom tag: `--reap --tag <name> --dry-run`.

4. **Reap** — delete confirmed entities:
   ```bash
   node bin/world-reap.js --reap
   ```

5. **Verify** — confirm the entities are gone:
   ```bash
   ls ~/data/grim-world/world/pool/beings/ | grep -E 'player_test|player_discord'
   ```

## Rules

- ALWAYS dry-run before a live reap — `--reap` is permanent (rm -rf on the entity dir)
- `--mark` without `--tag` uses tag `"test"` — safe default for junk cleanup
- `--reap` without `--tag` reaps ALL entities tagged `"test"` across all pools
- Use `--tag <name>` to scope a reap batch (e.g. `--tag stale-portrait`) without touching other tagged entities
- The tool walks all pools under `<worldRoot>/pool/`: beings, history, idea-orphanage, places, things
- Reaping deletes the entity dir but does NOT touch `<worldRoot>/graveyard/` — that is a separate
  manual triage area (not code-managed). Don't confuse the two; see the world-disk skill.
- Working dir must be the grim-world-fs repo root; config is read from `~/.config/lbl-config.json`

## Tone

Surgical. Confirm counts before and after. If in doubt, dry-run again.
