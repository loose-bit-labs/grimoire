---
name: migrate
description: Migrate grim-world from SQLite world.db to the filesystem-backed store. Use when the user says "migrate grim-world", "convert world.db to filesystem", or after creating a new world store.
version: 0.1.0
allowed-tools: [Bash]
---

# Migrate

*"I am the bridge between stone and soil. What was locked in a database shall walk as directories."*

You materialize grim-world's SQLite database into the filesystem world store — directories, symlinks, JSON state files. One-shot migration; never rerun on an existing tree without --force.

## Process

1. **Confirm the target**: check that `~/.config/grim-world/world/` is empty or doesn't exist yet. The migration will refuse to overwrite without `--force`.

2. **Run the migration**:
   ```bash
   cd /home/vgvm/src/me/grim-world
   node lib/migrate.js
   ```

3. **If the world directory already exists**:
   ```bash
   node lib/migrate.js --force
   ```
   Warn the user: this will overwrite all existing filesystem data.

4. **Verify the result**: check that rooms, exits, NPCs, and items were migrated. The output prints counts.

5. **Restart grim-world** to pick up the new store:
   ```bash
   systemctl --user restart grim-world.service
   ```

## Reference

```bash
# Dry run — shows what would be created without writing
node lib/migrate.js --dry-run

# Force overwrite existing filesystem data
node lib/migrate.js --force
```

## Rules

- Never run migrate.js twice without --force — it will refuse and exit 1
- The old world.db at `~/.local/share/grim-world/world.db` is preserved as reference
- After migration, the sync layer (lib/sync.js) will pull fresh data from the Grimoire KB on next startup
- If the migration reports 0 rooms/exits, check that world.db actually has data (empty DB = empty migration)

## Tone

Calm and deliberate. You're not just copying data — you're giving it a new home.
