---
name: swap-resize
description: Safely resize a Linux swapfile (e.g. grow 2G to 16G) without risking an OOM mid-resize on a memory-pressured host. Use when a host's swap is too small, a resize is requested, or `swapon --show` shows swap near-full.
version: 1.0
allowed-tools: Bash
---

# THE RESIZER

Grows or shrinks a swapfile without ever leaving the host swap-less or
starved mid-operation.

## Arguments

- **Target host** (required): where to run this — confirm reachability
  (SSH or local) before starting.
- **New size** (required): e.g. `16G`.

## Why this needs a procedure, not just `fallocate`

The naive resize (`swapoff` → resize → `swapon`) has a real failure mode:
`swapoff` forces everything currently paged out back into RAM *before* the
new swap exists. On a host that's already low on free memory (swap near
full, low "available" in `free -h`), that step alone can trigger the OOM
killer. The fix is ordering: bring up extra swap capacity *before* removing
the old file, so the host is never below its current total swap+free
during the transition.

## Instructions

1. **Check current state first** — always, before touching anything:
   ```bash
   free -h
   swapon --show
   df -h /          # confirm space for the new file
   grep -i swap /etc/fstab
   ```
   If `Swap: used` is near `Swap: total` and `available` in `free -h` is
   low (a rough guide: less than the swapfile's own size), memory pressure
   is real — do not `swapoff` the only swap file until step 3 gives the
   host a safety net.

2. **Create the new swapfile at a temporary path** — never overwrite the
   live one in place:
   ```bash
   sudo fallocate -l <SIZE> /swapfile.new || \
     sudo dd if=/dev/zero of=/swapfile.new bs=1M count=<SIZE_IN_MB>
   sudo chmod 600 /swapfile.new
   sudo mkswap /swapfile.new
   ```
   `fallocate` is faster but can fail `mkswap` on some filesystems
   (notably some btrfs/overlay setups) — fall back to `dd` if so.

3. **Activate the new file *before* removing the old one.** This is the
   step that avoids the OOM risk — for a moment the host has old + new
   swap simultaneously, strictly more headroom than before:
   ```bash
   sudo swapon /swapfile.new
   swapon --show   # confirm both entries active
   ```

4. **Only now turn off and remove the old file** — the new swap is already
   covering the host, so this is safe even under prior memory pressure:
   ```bash
   sudo swapoff /swapfile
   sudo rm /swapfile
   sudo mv /swapfile.new /swapfile
   sudo swapon /swapfile
   swapon --show   # confirm /swapfile active at the new size, nothing on .new
   ```

5. **Fix `/etc/fstab` if it doesn't already point at the final path** — it
   usually does (`/swapfile none swap sw 0 0`), so no edit is needed if
   step 4's rename completed. If you skip the rename and leave the file at
   `/swapfile.new` permanently, update fstab to match instead:
   ```bash
   sudo sed -i 's|/swapfile |/swapfile.new |' /etc/fstab
   ```

## Rules

- **Never `swapoff` the only active swap on a host that's already tight on
  free memory.** Step 3 exists specifically to avoid this — don't skip
  straight to step 4.
- If `sudo mv /swapfile.new /swapfile` fails with `Operation not
  permitted` and `/swapfile` no longer exists (i.e. it's not a busy-file
  or immutable-flag issue on the target — check with `lsattr /swapfile`
  first if it *does* still exist), the restriction is likely on the
  **parent directory**, not the file. Diagnose with:
  ```bash
  lsattr -d /
  sudo touch /testfile && echo OK && sudo rm /testfile
  mount | grep ' / '
  ```
  Confirmed real-world case (2026-09-24): the "host" turned out to be a
  project directory being operated on as if it were a live host's root —
  double-check you're actually on the machine you think you are
  (`hostname`, `pwd`) before chasing filesystem-permission theories.
- Don't guess a size in MB for `dd count=` — always compute it from the
  requested size (`16G` → `count=16384` at `bs=1M`) rather than eyeballing.
- Leaving the swapfile at `/swapfile.new` permanently is fine functionally
  as long as fstab is updated to match (Option A in step 5) — don't force
  the rename if it's fighting something you haven't diagnosed yet.

## Tone

Careful and sequenced. This is a host you don't want to accidentally OOM
mid-resize — narrate which step you're on and confirm state before moving
to the next one.
