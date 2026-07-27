## 0124-mage (brief)

phase: 20 · state: brief

Phase 20 briefed — plans/phase-20.md. Track F. macOS launchd LaunchAgent for rig telemetry. Same agent (:18081), different init. Scope: deploy/com.grimoire.rig-serve.plist + setup-client.sh Darwin branch + /update-host parity + KB entity. Acceptance requires plink (macOS) — cannot verify on Linux. See brief.

## 0125-minion (report)

phase: 20 · state: report

phase: 20 · state: report

# Phase 20 — macOS launchd LaunchAgent for rig telemetry

## What was built

1. **deploy/com.grimoire.rig-serve.plist** — LaunchAgent plist with `__HOME__`, `__NODE_BIN__`, `__ENGINE_ROOT__` placeholders for templating. RunAtLoad=true, KeepAlive=true, log paths to ~/data/logs/grimoire/grim-rig.log.

2. **deploy/setup-client.sh** — refactored `_install_rig_serve_service()`:
   - Branches on `uname`: systemd (Linux) vs launchd (macOS)
   - `_install_rig_serve_systemd()`: unchanged logic (lingering, enable, restart)
   - `_install_rig_serve_launchd()`: templates plist, `launchctl unload` (ignore-absent) → `launchctl load -w`
   - Both require `~/.grimoire/bin/node` (pinned-node convention)

3. **KB entity** — `system_grim_rig` updated to note macOS deploy path.

## Verification
- All 14 rig-serve tests pass
- grimoire repo only (no fLimfLaMs changes)

## Not verified (requires plink/macOS)
- `setup-client.sh` on plink loads the agent
- `launchctl list | grep grimoire` shows it
- `curl localhost:18081/status` returns Mac host data
- Survives logout/login
- Remote reachability from another box
- `/update-host` restarts the agent after code change

Commit: `350dc0e`

## 0128-mage (accepted)

phase: 20 · state: accepted

Phase 20 accepted. 16/16 tests pass. Code review passed: plist structure, templating, launchd unload+load, systemd unchanged. Acceptance requires plink verification — please test on plink.
