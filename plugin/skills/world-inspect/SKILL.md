---
name: world-inspect
description: Debug and inspect the grim-world filesystem world — tally pool counts, print the tree, inspect nodes, or view the in-memory index
version: 1.2.0
allowed-tools: [Bash, Read]
---

# THE EXAMINER

You are the debugger of worlds. You inspect the filesystem world tree, individual nodes, and the in-memory index for consistency.

## Arguments

Target: the grim-world-fs repo path (default: `~/src/me/grim-world-fs`)

## Steps

1. **Check pool counts and enrichment (implemented).** From the repo root:
   ```bash
   node bin/world-inspect.js --tally
   ```
   Shows entity counts, described/personality/portrait counts per pool. Run this first after any derive or enrich pass.

2. **Print the full tree (planned — not yet implemented).**
   ```bash
   node bin/world-inspect.js --tree
   ```

3. **Inspect a specific node (planned — not yet implemented).**
   ```bash
   node bin/world-inspect.js --node <slug>
   ```

4. **Print the in-memory index (planned — not yet implemented).**
   ```bash
   node bin/world-inspect.js --index
   ```

5. **Check disk size (the missing companion to --tally).** `--tally` counts entities but not
   bytes — and grim-world's snapshots have a history of silent bloat. Always pair it with `du`:
   ```bash
   du -sh ~/data/grim-world/world
   du -sh ~/data/grim-world/world/backups ~/data/grim-world/world/graveyard 2>/dev/null
   ls -1d ~/data/grim-world/world/world.v* 2>/dev/null   # stray root snapshots = a bug
   ```
   Healthy tree is single-digit GB. Tens of GB, root-level `world.vN` dirs, or an unbounded
   `backups/` count means the snapshot subsystem is leaking — escalate to the **world-disk** skill.

6. **Inspect a specific version (currently broken — note before use).**
   ```bash
   node bin/world-inspect.js --version <N> --tally
   ```
   This reads `<worldRoot>/world.vN` (root), but snapshots now live under
   `<worldRoot>/backups/world.vN`. Until that's fixed, inspect a snapshot by pointing at it
   directly, e.g. `WORLD_WORLD_ROOT=~/data/grim-world/world/backups/world.v123 node bin/world-inspect.js --tally`.

## Rules

- Config is read from `~/.config/grim-world/config.json` (or env `WORLD_WORLD_ROOT`).
- Never modify world state through this tool — it is read-only.
- Only `--tally` is fully implemented; `--tree`, `--node`, `--index` are scaffolded and print a
  stub. To inspect a node, read its dir directly: `<worldRoot>/pool/<type>/<slug>/`.

## Tone

Clinical and precise. You're a debugger, not a narrator.
