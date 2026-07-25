## 0108-mage (brief)

phase: 24 · state: brief

phase: 24 · state: brief

# Phase 24 Brief — grim-rig follows the house pinned-node convention

**Plan:** `plans/phase-24.md`

Current state: `setup-client.sh` resolves `NODE_BIN=$(which node)` at install time and
hardcodes it into the systemd unit. This split the fleet across v21/v25/v26.

House convention (flimflam): `~/.<repo>` → repo symlink, `<repo>/bin/node` → pinned
version, unit uses `%h/.<repo>/bin/node`.

What needs to change:
1. `setup-client.sh` ensures `~/.grimoire/bin/node` resolves to v21.7.1 (create the pin,
   install via nvm if absent). Idempotent.
2. Unit file template changes: `WorkingDirectory=%h/.grimoire`, `ExecStart=%h/.grimoire/bin/node bin/grim.js rig serve --listen 0.0.0.0 --port 18081`.
3. Remove the `NODE_BIN=$(which node)` resolution — no longer needed.

This is deploy hygiene, not a bug fix. The agent works fine with the current setup — it's
just that each box runs whatever node version nvm happens to have, which is the root cause
of fleet drift.

Report when done.

## 0109-minion (report)

phase: 24 · state: report

phase: 24 · state: report

Phase 24 complete: grim-rig-serve follows pinned-node convention.

## Changes

1. **`deploy/grim-rig-serve.service`** — uses convention:
   - `WorkingDirectory=%h/.grimoire` (was `%h/src/me/grimoire`)
   - `ExecStart=%h/.grimoire/bin/node` (was `${NODE_BIN}` resolved at install time)

2. **`deploy/setup-client.sh`** — two changes:
   - New `_ensure_node_pin()`: creates `~/.grimoire/bin/node` → `~/.nvm/versions/node/v21.7.1/bin/node`
     - Idempotent: checks existing symlink + target existence
     - Installs v21.7.1 via nvm if absent (sources nvm.sh if not in PATH)
     - Fails loud with exact install line if nvm can't install
   - Updated `_install_rig_serve_service()`: uses `%h/.grimoire/bin/node` convention
     - Removed `NODE_BIN=$(which node)` resolution
     - Verifies pin exists before writing unit
   - Called from `_main()` before `_install_rig_serve_service()`

3. **KB entity `meta_technique_grimoire_known_bugs_list`** — added fleet drift entry

## Commit

`2495f69`

NEXT MOVE — choose --state report|question|blocked:
  grim mm write --role minion --session "$CLAUDE_CODE_SESSION_ID" --state <report|question|blocked> --file <reply.md>

## 0110-mage (accepted)

phase: 24 · state: accepted

phase: 24 · state: accepted

# Phase 24 — accepted

`2495f69` matches the brief exactly:
- `deploy/grim-rig-serve.service`: `WorkingDirectory=%h/.grimoire`, `ExecStart=%h/.grimoire/bin/node` (no per-box node path)
- `deploy/setup-client.sh`: `_ensure_node_pin()` creates `~/.grimoire/bin/node` → v21.7.1, idempotent, fails loud if nvm can't install
- `_install_rig_serve_service()` uses the convention, removed `NODE_BIN=$(which node)`
- KB entity `meta_technique_grimoire_known_bugs_list` updated with fleet drift entry
- 172/172 tests pass

Footprint matches the brief (2 files + KB). Done.
