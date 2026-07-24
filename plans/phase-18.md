# Phase 18 — deploy & run `grim rig serve` as a persistent service

**Authority:** user, 2026-07-23 (direct request, not routed through hierophant).
**Repo:** grimoire only. Track F follow-on — phases 12/13/17 built the agent, the
central scrape stack, and the cockpit; nothing runs persistently anywhere yet. This
phase closes that gap using the existing systemd-service conventions already in
`deploy/` (`grim-boot-report.service` + its install step in `setup-client.sh`).

## What lands

1. **`deploy/grim-rig-serve.service`** — a **system** unit, modeled directly on
   `deploy/grimoire.service`. *(Amended by user directive 2026-07-23: "I want it to use
   systemctl like every other service." Supersedes this brief's original user-unit
   plan.)*
   - Same shape as `grimoire.service`: `Type=simple`, `User=YOUR_USER` template,
     `WorkingDirectory=<engine root>`, `EnvironmentFile=<root>/.env`,
     `ExecStart=<resolved node> bin/grim-rig.js serve`, `Restart=on-failure`,
     `RestartSec=10`, journald + `SyslogIdentifier=grim-rig`,
     `WantedBy=multi-user.target`.
   - `After=network.target`.
   - **Bind address is load-bearing — see item 2b.**
2. **Installer follows `deploy/install-service.sh` exactly** — that's the house
   pattern for system units: re-exec via `sudo --preserve-env`, resolve `TARGET_USER`
   from `SUDO_USER`, resolve `NODE_BIN` through the target user's login shell,
   template `YOUR_USER`/paths into `/etc/systemd/system/grim-rig-serve.service`, then
   `daemon-reload` → `enable` → `restart` → `status`. Idempotent on re-run.
   Add it as a sibling script (`deploy/install-rig-service.sh`) or a mode of
   `install-service.sh` — mage's call, but do **not** fork the pattern.

   **2b. Reachability (do not skip).** Phase 12 defaults the agent to `127.0.0.1`.
   A central Prometheus on another box then scrapes **nothing**, and `/fleet`'s
   cross-box fan-out fails. The unit must start the agent listening on an interface
   the other boxes can actually reach (`--listen` with the LAN/tailscale address, or
   `0.0.0.0` if that's the lab norm — state which and why). Verify a *remote* box can
   `curl http://<this-box>:8001/status` before calling this done. Keep the CLI's
   own `127.0.0.1` default unchanged; this is a unit-level argument.
3. **`grim-update-host.sh` / `setup-client.sh` tie-in.** Wire the install so a box
   that runs `/update-host` pulls the latest `bin/grim-rig.js` **and restarts the
   service**, so code changes take effect. Verify restart-on-rerun actually happens
   rather than assuming it.
3. **`grim-update-host.sh` gets rig-serve for free** — it already re-runs
   `setup-client.sh` unconditionally (idempotent), so once the new step lands there,
   running `/update-host` on any box: pulls the latest `bin/grim-rig.js`, then
   restarts the user service, so code changes actually take effect. Verify this is
   true rather than assuming it — restart-on-rerun is the part that makes `/update-host`
   actually useful for rolling out fixes, not just first-install.
4. One KB entity update (`system_grim_rig`) noting the persistent-service deploy path.

## Out of scope / do NOT

- ~~No root-level systemd unit~~ — **reversed by user directive 2026-07-23.** It is a
  system unit under `/etc/systemd/system/`, installed with sudo, exactly like
  `grimoire.service`. The `grim-boot-report` user-unit tier is **not** the model here.
- No changes to `bin/grim-rig.js` itself — the agent code is done (phases 12/13/17).
- No cross-box orchestration/push (ansible, etc.) — rollout to each box happens by
  that box running `/update-host` itself, same as everything else in this repo.
- Don't touch `deploy/grim-register-host.sh`'s own logic (hardware inventory POST) —
  the tie-in is sequencing (call rig-serve install right after it in
  `setup-client.sh`), not merging the two scripts.

## Success checks (mage runs these)

- Fresh install on this box: `systemctl status grim-rig-serve` shows **active**
  (system unit, no `--user`), `curl localhost:8001/status` returns real data, and the
  service **survives logout and reboot** (`systemctl is-enabled` → enabled).
- **Remote reachability:** from a *different* box, `curl http://<this-box>:8001/status`
  returns data. This is the check that proves telemetry can actually flow centrally.
- Re-run the installer (idempotent path): no duplicate install, service still
  running, no errors.
- Make a trivial code change to `bin/grim-rig.js`, run `/update-host` (or its
  underlying script directly), confirm the running service actually picked up the
  change (restart happened, not just enable).
- `systemctl --user disable --now grim-rig-serve` then re-run setup: comes back
  enabled + running from a clean-disabled state.
- Footprint: `deploy/grim-rig-serve.service` (new), `deploy/setup-client.sh` (one new
  function + one call site), one KB entity update.
