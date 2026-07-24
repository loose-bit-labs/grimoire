# Phase 19 — headless agent: stop shelling `xrandr` every poll

**Authority:** hierophant, 2026-07-23. **Repo:** grimoire only. Track F.
Small, standalone. Independent of phase 18 — run either order.

## The bug

`bin/grim-rig.js:483` calls `si.graphics()`. Inside the dep,
`node_modules/systeminformation/lib/graphics.js:948` shells `xrandr --verbose`, an
X11 client. So **every poll spawns an X11 connection attempt** on a headless server.

Observed 2026-07-23 on `aid`: run from an SSH session with `DISPLAY` set, the agent
spammed `X11 connection rejected because of wrong authentication` into the user's
terminal on the poll interval until it was killed.

**Honest scope note:** a systemd *user* unit (phase 18) does not inherit an SSH
session's `DISPLAY`, so phase 18 alone will silence most of this in practice. This
phase is still correct: a wasted subprocess per poll on every box, plus anyone running
`grim rig serve` by hand from an SSH shell still gets spammed. Fix the cause.

## What lands

Pick **one** and state which and why in the report:

- **(a) Drop `si.graphics()`** in favor of the `nvidia-smi` / `rocm-smi` / `amd-smi`
  paths the agent already has — these give better GPU data than systeminformation's
  Linux graphics probe anyway. Preferred if the existing fallbacks fully cover the
  fields `/status` exposes; verify field-by-field before choosing this.
- **(b) Scrub `DISPLAY`** (and `XAUTHORITY`) from the process environment at agent
  startup, so the dep's `xrandr` call fails instantly and silently instead of
  attempting a network X11 handshake.

**Do not merely redirect stderr** — that hides the symptom and keeps the per-poll
subprocess cost.

## Out of scope / do NOT

- No changes to what `/status` or `/metrics` expose — field-for-field identical
  output before and after. If option (a) would drop a field, choose (b) instead.
- No `/cluster` changes, no service/unit work (phase 18 owns that).

## Success checks (mage runs these)

- **Regression proof:** `export DISPLAY=localhost:99.0` (a bogus display), run
  `grim rig serve`, poll it for ~30s — **zero** X11/xrandr errors on stderr, where
  today's code reproduces them. Show the before/after.
- `/status` output is field-identical to pre-fix (diff two captures, same box).
- No `xrandr` process spawns during a poll cycle (`ps`/`strace`-lite or an exec count).
- Full suite green.
- Footprint: `bin/grim-rig.js`, one test file, KB bug-list entity updated.
