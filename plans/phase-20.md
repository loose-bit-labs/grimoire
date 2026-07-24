# Phase 20 — plink (macOS): launchd LaunchAgent for the rig telemetry agent

**Authority:** hierophant, 2026-07-24. **Repo:** grimoire only. Track F. The Darwin
sibling of phase 18 — same agent (`grim rig serve`, `:18081`), different init system.
macOS has no systemd; `setup-client.sh` currently *skips* the agent on Darwin
(the `systemctl not found` branch). This phase makes the Mac a first-class telemetry node.

## What lands

1. **`deploy/com.grimoire.rig-serve.plist`** — a launchd **LaunchAgent** (user tier,
   `~/Library/LaunchAgents/`, **no root/sudo** — the macOS analogue of the user-space
   systemd unit, honoring the same "like every other service" ruling):
   - `ProgramArguments`: the user's `node` (resolved, not hardcoded) → `bin/grim.js rig
     serve --listen 0.0.0.0 --port 18081`.
   - `WorkingDirectory` = engine root.
   - `RunAtLoad` = true, `KeepAlive` = true (crash-restart, the launchd equivalent of
     `Restart=on-failure`).
   - `StandardOutPath`/`StandardErrorPath` → `~/data/logs/grimoire/grim-rig.log`
     (create the dir if needed).
   - Use a placeholder for the home path templated at install (launchd has no `%h`).
2. **`setup-client.sh` Darwin branch** — where it currently warns-and-skips, instead
   install the LaunchAgent: template paths into the plist, copy to
   `~/Library/LaunchAgents/`, `launchctl unload` (ignore-if-absent) then `launchctl
   load -w`. Idempotent. Keep the Linux/systemd path untouched — branch on `uname`.
3. **`/update-host` parity** — a re-run must `unload`+`load` (or `kickstart`) so a code
   pull actually restarts the running agent, same guarantee phase 18 gives Linux.
4. KB entity update (`system_grim_rig`) noting the macOS deploy path.

## Out of scope / do NOT

- No changes to `bin/grim-rig.js` **unless** verification (below) proves an actual
  Darwin runtime failure — if SI returns usable data, the code is untouched. If a real
  gap appears (e.g. a poller throws on macOS), fix *that* minimally and report it; do
  not preemptively add Darwin branches on speculation.
- No `powermetrics`/sudo for GPU temp — if temp is unavailable, `/status` omits it and
  the cockpit's coolant gauge shows N/A. Missing field, not an error.
- No Homebrew/pkg installs, no Intel-vs-Apple-Silicon forking unless verification
  demands it (SI abstracts both).

## Success checks (RUN ON plink — cannot be verified on the Linux loop host)

- This phase **cannot fake-pass on aid.** The plist + branch may be *written* on Linux,
  but acceptance requires a real run on plink: `setup-client.sh` there loads the agent,
  `launchctl list | grep grimoire` shows it, `curl localhost:18081/status` returns real
  Mac host data (CPU, unified-memory-as-VRAM), and `/cluster` renders.
- Survives logout/login (LaunchAgent auto-loads at next login; note if `RunAtLoad`
  alone suffices or linger-equivalent is needed).
- Remote reachability: another box can `curl http://plink:18081/status`.
- `/update-host` on plink restarts the running agent after a code change.
- If plink can't be reached from the loop, the mage **escalates for a plink-side run**
  rather than marking accepted — do not accept a macOS deploy verified only on Linux.
- Footprint: `deploy/com.grimoire.rig-serve.plist` (new), `deploy/setup-client.sh`
  (Darwin branch), one KB entity update.

## Prereq (flag to user, not built here)

plink must be a registered/inventoried box (`setup-client.sh` registers it; a `rig.json`
entry lists which local services it runs) for the central scrape and `/fleet` to
include it. If plink runs no gen services, `/status` still reports host + GPU — useful
on its own.
