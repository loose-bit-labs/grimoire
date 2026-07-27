## 0129-mage (brief)

phase: 21 · state: brief

Phase 21 briefed — plans/phase-21.md. Track F. Fleet dashboard front-door on :3003. Scope: grim rig dashboard subcommand (reuse existing /cluster + /fleet), hub-only systemd service, setup-client.sh conditional install, lbl-config ports block update. Hub-only, not every box. See brief.

## 0130-minion (report)

phase: 21 · state: report

phase: 21 · state: report

Phase 21 implemented. 17/17 grim-rig-serve tests pass, 176/176 full suite pass.

## What landed

1. **`bin/grim-rig.js`** — New `serveDashboard()` function: no poller, no local snapshot, only `/cluster` (HTML) and `/fleet` (JSON). Reuses `getFleet()` and `serveStatic()` verbatim. Added `--dashboard` CLI flag to serve subcommand (default port 3003, listen 0.0.0.0). Updated help text.

2. **`deploy/grim-rig-dashboard.service`** — New systemd user service, same pattern as grim-rig-serve.service but with `--dashboard --listen 0.0.0.0 --port 3003`.

3. **`deploy/com.grimoire.rig-dashboard.plist`** — New macOS LaunchAgent, templated paths, port 3003.

4. **`deploy/setup-client.sh`** — New `_install_dashboard_service()` that checks rig.json for `"dashboard": true` on the local box. Branches on systemctl vs launchd. Only installs if box is a hub. Added to `_main()`.

5. **`config/lbl-config.json`** — Added `ports` block: `grim_rig: 18081`, `dashboard: 3003`.

6. **KB** — Updated `system_grim_rig` description with dashboard mode.

7. **`test/grim-rig-serve.test.js`** — New `serveDashboard()` test suite: /cluster→200 HTML, /fleet→200 JSON, /status→404, /metrics→404.

## Test output

```
$ node --test test/grim-rig-serve.test.js
ok 5 - serveDashboard()
  # Subtest: /cluster returns HTML, /fleet returns JSON, /status and /metrics return 404
ok 1 - /cluster returns HTML, /fleet returns JSON, /status and /metrics return 404
17 tests, 17 pass, 0 fail
```

## Footprint

- `bin/grim-rig.js` (serveDashboard + --dashboard CLI)
- `deploy/grim-rig-dashboard.service` (new)
- `deploy/com.grimoire.rig-dashboard.plist` (new)
- `deploy/setup-client.sh` (conditional install)
- `config/lbl-config.json` (ports block)
- `test/grim-rig-serve.test.js` (serveDashboard test)
- KB: system_grim_rig updated

## Mage verification needed

- On a hub box: `grim rig serve --dashboard` serves /cluster and /fleet
- Dashboard service only installs when rig.json has `"dashboard": true` on the box
- Non-hub box's setup-client.sh does not install dashboard
- Remote reachability to :3003

## 0131-mage (accepted)

phase: 21 · state: accepted

Phase 21 accepted. 17/17 tests pass. Code review passed: serveDashboard no poller/local metrics, hub-only conditional install, systemd+launchd, lbl-config ports block, test covers /cluster /fleet /status /metrics.
