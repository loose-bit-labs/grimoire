# Phase 36 — roll grimoire.service into the fold (system unit → user-space)

**Authority:** hierophant, 2026-07-30. **Repo:** grimoire only. **aid-only** (the server
box). **`requires: permission`** — sudo + a brief KB outage during cutover; user-gated.
Deploy hygiene: the last pre-standardization holdout. Relates to the containerization /
user-space ruling and the house deploy convention.

## Why

`grimoire.service` is one of only two **system** units in the lab (with ollama); every
other grimoire service is `systemctl --user`. It's early work from before standardization.
Rolling it into the user scope makes the whole fleet consistent and manageable without sudo
— and `Linger=yes` is already enabled for vgvm, so a user unit starts at boot headless (the
main risk is already handled).

## Current state (captured 2026-07-30)

- System unit `/etc/systemd/system/grimoire.service`: `User=vgvm`,
  `WorkingDirectory=/mnt/eighty/userspace/vgvm/src/me/grimoire`,
  `EnvironmentFile=<repo>/.env`,
  `ExecStart=/home/vgvm/.nvm/versions/node/v21.7.1/bin/node bin/grim-server.js`,
  `Restart=on-failure`/`RestartSec=10`, `After=network.target ollama.service` +
  `Wants=ollama.service`, `WantedBy=multi-user.target`.
- `~/.grimoire` → the repo ✓. `~/data/logs/grimoire` exists ✓. **`~/.grimoire/bin/node`
  does NOT exist** (phase-24 pin never applied on aid). `.env`:
  `GRIMOIRE_ROOT=/home/vgvm/data/grimoire-kb`, `GRIMOIRE_PORT=3663`.

## What lands

1. **Create the pinned node** `~/.grimoire/bin/node` → `~/.nvm/versions/node/v21.7.1/bin/node`
   (`mkdir -p ~/.grimoire/bin` — note it lands in the repo via the symlink; add `bin/node`
   to the repo's `.gitignore` if not already, it's a per-box symlink). This also closes the
   phase-24 gap on aid.
2. **`deploy/grimoire.service`** — a user unit, house convention, committed in the repo and
   symlinked to `~/.config/systemd/user/grimoire.service` (same pattern as grim-bridge):
   ```
   [Unit]
   Description=Grimoire Knowledge Graph Server
   After=network.target
   [Service]
   WorkingDirectory=%h/.grimoire
   EnvironmentFile=%h/.grimoire/.env
   ExecStart=%h/.grimoire/bin/node bin/grim-server.js
   Restart=on-failure
   RestartSec=10
   StandardOutput=append:%h/data/logs/grimoire/grim-server.log
   StandardError=append:%h/data/logs/grimoire/grim-server.log
   SyslogIdentifier=grimoire
   [Install]
   WantedBy=default.target
   ```
3. **The one semantic change — drop the ollama ordering.** `After=/Wants=ollama.service`
   cannot be expressed in a user unit (ollama is a **system** unit; cross-scope ordering
   isn't allowed). grim-server already tolerates ollama being down (degrades / the
   `RestartSec=10` loop covers a startup race). Drop it; do **not** invent a cross-scope
   hack. Note the change in the report.
4. **Cutover script step** (in the server-setup path, e.g. `deploy/setup-server.sh` or the
   existing setup script — mage's call): idempotent install of the pin + unit symlink +
   `systemctl --user daemon-reload`.

## Cutover (USER-GATED, sudo, ~seconds of KB downtime — do in a quiet window)

1. Ensure pin + `~/.grimoire`, `~/data/logs/grimoire`, unit symlink; `systemctl --user
   daemon-reload`.
2. `sudo systemctl disable --now grimoire.service` (stop + disable the system unit) — KB
   downtime begins here; the MCP bridge and all sessions lose `:3663` briefly.
3. `systemctl --user enable --now grimoire.service`.
4. **Verify** `:3663` is back: `curl -s localhost:3663/api/graph` (or a known route) returns;
   `grim oracle search "grimoire" --limit 1` round-trips; the grim-bridge/MCP reconnects.
5. Only after verify: `sudo rm /etc/systemd/system/grimoire.service` (or leave it disabled).

## Rollback (must be one line, stated in report)

`sudo systemctl enable --now grimoire.service` re-arms the system unit (stop the user one
first). Known-good is the current system unit — do not delete its file until step 4 passes.

## Out of scope / do NOT

- aid-only. Don't touch ollama (leave it a system unit — it's third-party, not ours).
- Don't change GRIMOIRE_ROOT, the port, or any server behavior. Pure init migration.
- Don't push. Commit locally; user pushes.

## Success checks

- `systemctl --user is-active grimoire` → active; `/proc/<pid>/cgroup` →
  `user.slice/.../grimoire.service` (no longer `/system.slice`).
- `~/.grimoire/bin/node --version` → v21.7.1; ExecStart resolves through it.
- KB read+write round-trip works post-cutover; MCP bridge healthy.
- Enabled for boot (linger already yes); rollback line verified in principle.
- Footprint: `deploy/grimoire.service`, setup-script step, `.gitignore` if needed, KB note.
