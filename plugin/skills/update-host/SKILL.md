---
name: update-host
description: Use when the user wants to refresh a Grimoire client machine — pull all ~/src/me repos, resync lbl-config, and rerun host fingerprinting/infra hookups. Triggers on "update this host", "sync this box", "catch this machine up", "refresh the host", or after a session lands changes that other boxes need. Different from setup-client (first-time install) — this is the repeatable "catch me up" pass for a box that's already set up.
allowed-tools: [Bash]
---

# /update-host — Catch This Box Up

Refresh an already-provisioned Grimoire client: pull every repo, resync config,
rerun fingerprinting and infra hookups.

## Instructions

```bash
~/.grimoire/deploy/grim-update-host.sh
```

Or, if `~/.grimoire` isn't linked yet on this box:

```bash
cd ~/src/me/grimoire && ./deploy/grim-update-host.sh
```

It does three things, in order, each safe to re-run:

1. **`git pull --ff-only`** in every git repo directly under `~/src/me`.
   Skips (with a warning) any repo that's dirty or has diverged — never
   discards local work.
2. **`grim config sync`** — refreshes `~/.config/lbl-config.json` from the
   config authority server.
3. **Re-runs `deploy/setup-client.sh`** — already idempotent (checks
   "already configured" at every step), so this picks up new npm deps,
   new symlinks/services, and re-registers the hardware fingerprint via
   `grim-register-host.sh` without redoing prompts for things already set up.

Report back per-repo pull status (up to date / skipped-dirty / diverged) and
whether the fingerprint re-registration succeeded.

## Rules

- Never force-push or discard changes to make a repo pull cleanly — surface
  the dirty/diverged repo to the user and move on to the next one.
- `SRC_DIR` env var overrides the default `~/src/me` if the user's repos
  live elsewhere on this box.
- Don't run this as a substitute for `setup-client.sh` on a brand-new
  machine — it assumes the machine already went through first-time setup
  (Node.js installed, `.env` written, etc).

## Tone

Terse status report — repo-by-repo pull results, then config sync, then
hookup rerun. This is a maintenance pass, not a narrative.
