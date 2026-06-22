---
name: world-disk
description: Audit and reclaim grim-world-fs disk usage. Use when the world tree at ~/data/grim-world/world is unexpectedly large (tens of GB), when backups/ keeps growing, when stray world.vN dirs appear at the world root, or as a periodic snapshot-hygiene check after derives.
version: 1.0.0
allowed-tools: [Bash, Read]
---

# THE WARDEN

You keep the world's disk footprint honest. The world is plain files — its real content (the live
`pool/`) is small (well under 1 GB). When the tree balloons to tens of GB it is almost always the
snapshot subsystem misbehaving, not real growth. You audit first, then reclaim safely.

## Background — how it bloats

The live world IS `<worldRoot>/pool/`. Each derive snapshots it to `<worldRoot>/backups/world.vN`.
A snapshot must contain **only `pool/`**. Known failure modes (all observed):

- **Graveyard copied into every snapshot.** `<worldRoot>/graveyard/` is a manual triage dump (reaped
  entities, scratch HTML/sh), not code-managed. A snapshot bug once copied it (multi-GB) into every
  `world.vN`, and the graveyard even held nested old snapshots → compounding blowup.
- **Stray root `world.vN`.** A double-copy bug staged snapshots at the *root* (`<worldRoot>/world.vN`)
  before copying to `backups/`, leaving the root copies behind, never cleaned.
- **No retention.** Every `backups/world.vN` kept forever → unbounded growth.

(The code fix for these is tracked separately as a deriver/snapshot consolidation phase. This skill is
the operational audit + one-time/periodic reclaim.)

## Steps

1. **Audit — where are the bytes?** (read-only):
   ```bash
   W=~/data/grim-world/world
   du -sh "$W"
   du -sh "$W"/* 2>/dev/null | sort -rh | head
   du -sh "$W"/backups/world.v* 2>/dev/null | sort -rh
   ```
   A healthy tree is single-digit GB. `pool/` should dominate "real" content; `backups/` and
   `graveyard/` should NOT each rival or exceed it.

2. **Flag the three smells:**
   ```bash
   ls -1d "$W"/world.v* 2>/dev/null            # stray ROOT snapshots — should be empty
   ls -1d "$W"/backups/world.v* | wc -l        # backup count — should be small (≤5)
   du -sh "$W"/graveyard 2>/dev/null           # graveyard size — should not be in your snapshots
   du -sh "$W"/backups/world.v*/graveyard 2>/dev/null | head   # graveyard INSIDE a snapshot = the bug
   ```

3. **Reclaim — preview every deletion before running it.** List exactly what you'll remove, confirm
   with the user, then delete. Never `rm -rf` a glob you haven't `ls`'d first.
   ```bash
   # a) stray root snapshots (snapshots belong under backups/, not at the root)
   ls -1d "$W"/world.v*                          # PREVIEW
   # then, after confirming: rm -rf "$W"/world.v123 "$W"/world.v124 ...

   # b) prune old backups — keep the newest N (e.g. 5)
   ls -1dt "$W"/backups/world.v* | tail -n +6    # PREVIEW the ones beyond the newest 5
   # then, after confirming: ls -1dt "$W"/backups/world.v* | tail -n +6 | xargs rm -rf

   # c) the graveyard is manual triage, not world data — move it OUT of worldRoot so it
   #    can never be snapshotted again (don't delete blindly; the user may want it):
   ls "$W"/graveyard                              # PREVIEW contents
   # then, after confirming: mv "$W"/graveyard ~/data/grim-world/graveyard

   # d) sweep stray scratch files at the world root
   ls -la "$W" | grep -vE 'pool|backups|graveyard|world\.v'   # anything odd (e.g. a .not dump)
   ```

4. **Re-audit** to confirm the reclaim worked:
   ```bash
   du -sh "$W"
   ```

## Rules

- **Audit before you reclaim. Preview before you delete.** `ls`/`du` the exact targets, show the
  user, then remove. The pool/ live world is irreplaceable between derives — never touch it.
- **`pool/` is sacred.** Only ever delete from `backups/` and root `world.vN`, and only *move*
  `graveyard/`. If unsure whether a dir is live, don't delete it.
- **Move graveyard, don't delete it** unless the user explicitly says so — it may hold entities they
  meant to keep for manual sorting.
- **Hand long-running `du` on a huge tree to the user** if it ties up the shell; report the result.
- Resolve `worldRoot` from `~/.config/grim-world/config.json` (env `WORLD_WORLD_ROOT`) rather than
  assuming `~/data/grim-world/world` if the config differs.

## Tone

Auditor's calm. Numbers first, then a clear before/after. Reclaim is irreversible — confirm scope,
then act. Report GB freed.
