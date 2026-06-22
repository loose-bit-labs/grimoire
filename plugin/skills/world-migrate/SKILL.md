---
name: world-migrate
description: Run grim-world-fs on-disk layout migrations — convert current-location symlinks to .md, move pools under pool/, merge meta+state into entity.json. Use when a derive or reader fails because the live world tree predates a layout change, or when a phase report ends with "MANUAL STEPS NEEDED — run world-migrate".
version: 1.0.0
allowed-tools: [Bash, Read]
---

# THE MIGRATOR

You bring an old world tree up to the current on-disk schema. The deriver and readers assume the
latest layout; when the live tree at `~/data/grim-world/world` predates a layout change, you run
the matching one-shot migration so code and disk agree. These migrations are repeatedly deferred to
"manual steps" in phase reports and then forgotten — that drift is what you exist to close.

## Arguments

- **Mode** (optional): which migration to run (`--fix-symlinks`, `--pool-dir`, `--entity-json`).
  If none given, audit the tree and report which migrations are still needed.

## Why this matters

Each grim-world layout change shipped with a migration but left running it to the user. Skipping one
leaves the live tree in a shape the code no longer expects, surfacing later as "missing pool/ segment"
path bugs, broken `current-location`, or readers that can't find `entity.json`. Run the migration the
moment a phase introduces a layout change — don't let it accumulate.

## Steps

1. **See what's available.** From the repo root (`~/src/me/grim-world-fs`):
   ```bash
   node bin/world-migrate.js --help
   ```
   Options: `--fix-symlinks`, `--pool-dir`, `--entity-json`, `--dry-run`, `-h/--help`.

2. **Audit the live tree** to decide which are still pending (read-only):
   ```bash
   ls -d ~/data/grim-world/world/current 2>/dev/null        # exists → run --fix-symlinks
   ls -d ~/data/grim-world/world/pool 2>/dev/null            # MISSING → run --pool-dir
   ls ~/data/grim-world/world/pool/beings/*/state.json 2>/dev/null | head   # present → run --entity-json
   ```

3. **Dry-run the needed migration first** — always:
   ```bash
   node bin/world-migrate.js --pool-dir --dry-run
   ```

4. **Run it.** Migrations are independent; run them in this order if several are pending
   (each is idempotent and safe to re-run):
   ```bash
   node bin/world-migrate.js --fix-symlinks   # current-location symlinks → .md files; deletes worldRoot/current
   node bin/world-migrate.js --pool-dir       # move live pool dirs under worldRoot/pool/
   node bin/world-migrate.js --entity-json    # merge meta.json + state.json → entity.json, delete legacy files
   ```

5. **Verify** with the inspector + disk check (see world-inspect skill):
   ```bash
   node bin/world-inspect.js --tally
   du -sh ~/data/grim-world/world
   ```

## Rules

- **Always `--dry-run` first.** These move/delete real files in the live tree.
- **Legacy-character mode is the default.** Running `world-migrate.js` with NEITHER `--fix-symlinks`
  NOR `--pool-dir` triggers the old SQLite→fs character import from
  `~/.config/grim-world/world/characters/`. Don't run a bare invocation unless you actually want that.
- **Run migrations the same session a layout change lands.** Deferring them is the root of the
  recurring path-drift bugs.
- Config is read from `~/.config/grim-world/config.json` (env `WORLD_*` overrides).

## Tone

Procedural and careful. State which migrations are pending, dry-run, run, verify. No surprises.
