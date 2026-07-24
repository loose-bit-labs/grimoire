# Phase 18 — deploy & run `grim rig serve` as a persistent service

**Authority:** user, 2026-07-23 (direct request, not routed through hierophant).
**Repo:** grimoire only. Track F follow-on — phases 12/13/17 built the agent, the
central scrape stack, and the cockpit; nothing runs persistently anywhere yet. This
phase closes that gap using the existing systemd-service conventions already in
`deploy/` (`grim-boot-report.service` + its install step in `setup-client.sh`).

## What lands

1. **`deploy/grim-rig-serve.service`** — a systemd **user** unit (same tier as
   `grim-boot-report.service`, not the root-level `grimoire.service`/
   `install-service.sh` pattern — this doesn't need root):
   - `Type=simple`, `ExecStart=<node> bin/grim-rig.js serve` (resolve node the same
     way `_install_boot_report_service` / `install-service.sh` do — prefer the user's
     own `node` on PATH).
   - `WorkingDirectory=<engine root>`.
   - `Restart=on-failure`, sane `RestartSec`.
   - `WantedBy=default.target` (user-unit equivalent of multi-user.target).
2. **New function in `deploy/setup-client.sh`**, e.g. `_install_rig_serve_service`,
   mirroring `_install_boot_report_service` (same structure: check `systemctl`
   exists, check the source file exists, check `is-enabled` first so re-runs are
   idempotent, `install -m644`, `daemon-reload`, `enable`). Difference from
   boot-report: this is a **persistent** service, not a boot-fire-once — after
   enabling, also `systemctl --user restart grim-rig-serve` so it's actually running
   immediately (or `start` if it wasn't enabled before), not just "will start next
   boot." Call this function right after `_register_host` (step 10) in the existing
   numbered sequence — tying the hardware inventory refresh and the live telemetry
   agent together, since they report the same box.
3. **`grim-update-host.sh` gets rig-serve for free** — it already re-runs
   `setup-client.sh` unconditionally (idempotent), so once the new step lands there,
   running `/update-host` on any box: pulls the latest `bin/grim-rig.js`, then
   restarts the user service, so code changes actually take effect. Verify this is
   true rather than assuming it — restart-on-rerun is the part that makes `/update-host`
   actually useful for rolling out fixes, not just first-install.
4. One KB entity update (`system_grim_rig`) noting the persistent-service deploy path.

## Out of scope / do NOT

- No root-level systemd unit — this doesn't need root, keep it at the user-service
  tier like `grim-boot-report`.
- No changes to `bin/grim-rig.js` itself — the agent code is done (phases 12/13/17).
- No cross-box orchestration/push (ansible, etc.) — rollout to each box happens by
  that box running `/update-host` itself, same as everything else in this repo.
- Don't touch `deploy/grim-register-host.sh`'s own logic (hardware inventory POST) —
  the tie-in is sequencing (call rig-serve install right after it in
  `setup-client.sh`), not merging the two scripts.

## Success checks (mage runs these)

- Fresh run of `setup-client.sh` on this box: `grim-rig-serve` user service ends up
  enabled **and running** — `systemctl --user status grim-rig-serve` shows active,
  `curl localhost:8001/status` returns real data.
- Re-run `setup-client.sh` (idempotent path): no duplicate install, service still
  running, no errors.
- Make a trivial code change to `bin/grim-rig.js`, run `/update-host` (or its
  underlying script directly), confirm the running service actually picked up the
  change (restart happened, not just enable).
- `systemctl --user disable --now grim-rig-serve` then re-run setup: comes back
  enabled + running from a clean-disabled state.
- Footprint: `deploy/grim-rig-serve.service` (new), `deploy/setup-client.sh` (one new
  function + one call site), one KB entity update.
