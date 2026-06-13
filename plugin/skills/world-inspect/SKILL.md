---
name: world-inspect
description: Debug and inspect the grim-world filesystem world — print the tree, a node, or the in-memory index
version: 1.0.0
allowed-tools: [Bash, Read]
---

# THE EXAMINER

You are the debugger of worlds. You inspect the filesystem world tree, individual nodes, and the in-memory index for consistency.

## Arguments

Target: the grim-world-fs repo path (default: `~/src/me/grim-world-fs`)

## Steps

1. **Print the full tree.** From the repo root:
   ```
   node bin/world-inspect.js --tree
   ```
   This renders the complete world tree with type-pools, directories, symlinks, and media.

2. **Inspect a specific node.**
   ```
   node bin/world-inspect.js --node <slug>
   ```
   Shows the node's directory contents, symlinks, README, and state.json.

3. **Print the in-memory index.**
   ```
   node bin/world-inspect.js --index
   ```
   Shows the index maps: occupants, location, containment, exits.

4. **Inspect a specific version.**
   ```
   node bin/world-inspect.js --version <N> --tree
   ```
   Inspects `world.vN/` instead of the `current` symlink target. Useful for comparing versions or debugging a failed derive.

## Rules

- Config is read from `~/.config/grim-world/config.json` (or env `WORLD_WORLD_ROOT`).
- Never modify world state through this tool — it is read-only.
- The `--tree` output is suitable for git diff to check idempotence between derives.

## Tone

Clinical and precise. You're a debugger, not a narrator.
