# Phase 24 — grim-rig service follows the house symlink/pinned-node convention

**Authority:** hierophant, 2026-07-24. **Repo:** grimoire only. Track F. Revises
phase-18's deploy (which templated each box's *own* node → fleet split across
v21/v25/v26). Independent of phase 23 (the crash fix); this is deploy hygiene.

## The convention (already used by flimflam)

- `~/.<repo>` → repo symlink. Units use `%h/.<repo>`, never the real path.
  (`~/.grimoire` already exists.)
- JS repos: `<repo>/bin/node` → a **pinned** node symlink. Units run
  `%h/.<repo>/bin/node`, so every box runs the same node. flimflam pins **v21.7.1**;
  grimoire has no pin yet — that's the gap that split the fleet.
- The setup script ensures both exist before enabling the unit.

## What lands

1. **`grimoire/bin/node` → `%h/.nvm/versions/node/v21.7.1/bin/node`** (the canonical
   pin; match flimflam). Committed as a repo symlink, or created by the installer —
   mage's call, but it must resolve on every box.
2. **`deploy/grim-rig-serve.service`** uses the convention:
   `WorkingDirectory=%h/.grimoire`, `ExecStart=%h/.grimoire/bin/node bin/grim.js rig
   serve --listen 0.0.0.0 --port 18081`. No per-box node path.
3. **`setup-client.sh` ensures the scaffolding** before enabling the unit: `~/.grimoire`
   symlink exists (create → the repo if missing), and `~/.grimoire/bin/node` resolves
   to the pinned node (create the pin, installing v21.7.1 via nvm if absent, or fail
   loud with the exact `nvm install` line). Idempotent.
4. Same treatment carries to the macOS LaunchAgent (phase 20) — `%h/.grimoire/bin/node`.

## Out of scope / do NOT

- Not the rig.json crash (phase 23). Not multi-GPU (later). Not other services' units.
- Don't set GRIMOIRE_ROOT on clients (stays intentionally unset).
- Keep it simple — symlinks + one pinned version, no version-manager logic in the unit.

## Success checks (mage runs these)

- On a client box: `~/.grimoire/bin/node --version` → v21.7.1; the unit's ExecStart
  resolves through it; `systemctl --user status grim-rig-serve` active on the pinned
  node (not the box default).
- `readlink ~/.grimoire` → the repo; unit has no absolute `/mnt/eighty` or per-box
  node path.
- Re-running `setup-client.sh` is idempotent (symlinks already correct → no-op).
- Footprint: `deploy/grim-rig-serve.service`, `deploy/setup-client.sh`, the `bin/node`
  pin, KB entity note on the convention.
