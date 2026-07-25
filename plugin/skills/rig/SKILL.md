---
name: rig
description: Check homelab AI service status — VRAM usage, running services, and health across all configured boxes. Use when you need to know what's running where before starting a heavy task, or to troubleshoot service availability.
argument-hint: "[status] [--json]"
version: 1.0.0
allowed-tools: [Bash]
---

# /rig — Homelab Status

Sensor layer. See what's running before you pull a lever.

## Arguments

$ARGUMENTS

## Instructions

1. Run the rig status check:
   ```bash
   cd ~/src/me/grimoire && grim rig [status] [--json]
   ```

2. Read the output and summarize for the user:
   - Which boxes are reachable
   - VRAM usage per GPU (used / total)
   - Which services are up vs down
   - Any cold VRAM or unexpected states worth flagging

## Config: rig.json

Box inventory lives at `$GRIMOIRE_ROOT/rig.json` — NOT in the engine code.

- `grim rig status` / `up` / `down`: requires rig.json — exits with error if missing.
- `grim rig serve`: graceful degradation — logs a warning and runs with empty service list if rig.json is absent. Client boxes intentionally have no rig.json.

To set up on a new machine:
```bash
cp ~/src/me/grimoire/rig.example.json $GRIMOIRE_ROOT/rig.json
# edit with your boxes
```

Each box entry: `host`, `aliases` (for local detection), services with `url` or `pgrep` probes, optional `unit` for systemctl override.

## Phase 1 vs Phase 2

| Phase | Status | What it does |
|-------|--------|--------------|
| Phase 1 | Built | Read-only status: VRAM + service health |
| Phase 2 | Not yet built | Start/stop services via systemctl |

Phase 1 is sensor-only. Do not attempt to start/stop services via rig — use `systemctl --user` directly on the target box for now.

## Service check methods

- **HTTP probe**: `curl -sf --max-time N <url>` — up if curl exits 0
- **pgrep**: `pgrep -f <pattern>` — up if any matching process found
- **Local detection**: if hostname matches `box.aliases`, runs bash directly (no SSH)
- **SSH**: `ssh -o BatchMode=yes` — key-based auth only, no interactive prompts

## Tone

Terse status report. Flag anything unexpected. No elaboration unless asked.
