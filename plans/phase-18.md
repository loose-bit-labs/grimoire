# Phase 18 — deploy & run `grim rig serve` as a persistent service

**Authority:** user, 2026-07-23 (direct request, not routed through hierophant).
**Repo:** grimoire only. Track F follow-on — phases 12/13/17 built the agent, the
central scrape stack, and the cockpit; nothing runs persistently anywhere yet. This
phase closes that gap using the existing systemd-service conventions already in
`deploy/` (`grim-boot-report.service` + its install step in `setup-client.sh`).

## What lands

1. **`deploy/grim-rig-serve.service`** — a systemd **user** unit, same tier as
   `grim-boot-report.service`. **No root. No sudo. `systemctl --user`.**
   *(This brief's original plan was correct; a 2026-07-23 amendment to a system unit
   was wrong and is reverted at user direction: "USER SPACE SYSTEMCTL like every other
   service.")*
   **Model it on `~/.config/systemd/user/grim-bridge.service`** — a persistent user
   daemon, which is what we're building. Do **not** model it on `grim-boot-report`
   (fire-once at boot) or `grimoire.service` (the lab's single system-unit outlier).
   That house pattern, verbatim in shape:
   - `After=network.target`.
   - `WorkingDirectory=%h/src/me/grimoire` — use the **`%h` specifier**, not a
     templated `YOUR_USER` path. No sed-templating needed at install time.
   - `ExecStart=%h/... /bin/node bin/grim-rig.js serve` (resolve node the way the
     sibling units do).
   - `Restart=on-failure`, `RestartSec=5`.
   - `StandardOutput=append:%h/data/logs/grimoire/grim-rig.log` and the same for
     `StandardError` — file logging like its siblings, **not** journald/SyslogIdentifier.
   - `WantedBy=default.target`.
   - No `User=` (implicit for user units). No `EnvironmentFile` unless the agent
     actually needs one.
   - **Bind address is load-bearing — see item 2b.**
2. **New function in `deploy/setup-client.sh`**, e.g. `_install_rig_serve_service`,
   mirroring `_install_boot_report_service` (check `systemctl` exists, check the
   source file exists, check `is-enabled` first so re-runs are idempotent,
   `install -m644` into `~/.config/systemd/user/`, `systemctl --user daemon-reload`,
   `enable`). Difference from boot-report: this is a **persistent** service, not
   boot-fire-once — after enabling, also `systemctl --user restart grim-rig-serve` so
   it is running *now*, not just next boot. Call it right after `_register_host`
   (step 10) in the existing numbered sequence.

   **2a. Lingering — verify, don't assume.** A user unit dies at logout unless
   lingering is on. **On `aid` it is already enabled** (`loginctl show-user` →
   `Linger=yes`), which is why the 13 sibling user services survive logout. The
   installer should *check* and only call `loginctl enable-linger "$USER"` when it's
   off — idempotent, and don't fail the install if the check is unavailable, just say
   so. **Acceptance still requires the service to survive a full logout.**

   **2b. Reachability (do not skip).** Phase 12 defaults the agent to `127.0.0.1`.
   A central Prometheus on another box then scrapes **nothing**, and `/fleet`'s
   cross-box fan-out fails. The unit must start the agent listening on an interface
   the other boxes can actually reach (`--listen` with the LAN/tailscale address, or
   `0.0.0.0` if that's the lab norm — state which and why). Verify a *remote* box can
   `curl http://<this-box>:8001/status` before calling this done. Keep the CLI's
   own `127.0.0.1` default unchanged; this is a unit-level argument.
3. **`grim-update-host.sh` gets rig-serve for free** — it already re-runs
   `setup-client.sh` unconditionally (idempotent), so once the new step lands there,
   running `/update-host` on any box: pulls the latest `bin/grim-rig.js`, then
   restarts the user service, so code changes actually take effect. Verify this is
   true rather than assuming it — restart-on-rerun is the part that makes `/update-host`
   actually useful for rolling out fixes, not just first-install.
4. One KB entity update (`system_grim_rig`) noting the persistent-service deploy path.

## Out of scope / do NOT

- **No root-level systemd unit. No sudo anywhere in this phase.** This doesn't need
  root — keep it at the user-service tier like `grim-boot-report`. `grimoire.service`
  / `install-service.sh` are **not** the model here. (Restated emphatically: a
  2026-07-23 amendment to a root unit was a misread and has been reverted.)
  The sole permitted privileged-ish call is `loginctl enable-linger` (item 2a).
- No changes to `bin/grim-rig.js` itself — the agent code is done (phases 12/13/17).
- No cross-box orchestration/push (ansible, etc.) — rollout to each box happens by
  that box running `/update-host` itself, same as everything else in this repo.
- Don't touch `deploy/grim-register-host.sh`'s own logic (hardware inventory POST) —
  the tie-in is sequencing (call rig-serve install right after it in
  `setup-client.sh`), not merging the two scripts.

## Success checks (mage runs these)

- Fresh run of `setup-client.sh` on this box: `systemctl --user status grim-rig-serve`
  shows **active**, `curl localhost:8001/status` returns real data. No sudo was used
  to install or start it.
- **Survives logout** — the lingering check (2a). Log out fully, log back in, service
  is still running. This is the one that proves the user-unit approach actually works;
  don't hand-wave it.
- **Remote reachability:** from a *different* box, `curl http://<this-box>:8001/status`
  returns data. This is the check that proves telemetry can actually flow centrally.
- Re-run `setup-client.sh` (idempotent path): no duplicate install, service still
  running, no errors.
- Make a trivial code change to `bin/grim-rig.js`, run `/update-host` (or its
  underlying script directly), confirm the running service actually picked up the
  change (restart happened, not just enable).
- `systemctl --user disable --now grim-rig-serve` then re-run setup: comes back
  enabled + running from a clean-disabled state.
- Footprint: `deploy/grim-rig-serve.service` (new), `deploy/setup-client.sh` (one new
  function + one call site), one KB entity update.
