#!/usr/bin/env bash
# deploy/grim-update-host.sh — refresh this host: pull all ~/src/me repos,
# resync lbl-config, rerun host fingerprinting + infra hookups.
#
# Run this any time on any box that already went through setup-client.sh —
# it's the "catch me up" script, not the first-time installer.
#
# Usage:
#   ~/.grimoire/deploy/grim-update-host.sh
#   SRC_DIR=~/src/me ~/.grimoire/deploy/grim-update-host.sh
#
# What it does:
#   1. git pull --ff-only in every git repo directly under SRC_DIR
#      (skips + warns on dirty trees or non-fast-forward divergence —
#      never discards local work)
#   2. grim config sync — refresh ~/.config/lbl-config.json from the
#      config authority
#   3. Re-run deploy/setup-client.sh — it's already idempotent (checks
#      "already configured" at every step), so this picks up npm deps,
#      new symlinks/services, and re-registers hardware fingerprint
#      without redoing prompts for things already set up.

set -euo pipefail

SRC_DIR="${SRC_DIR:-$HOME/src/me}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

# ── Pull every repo under SRC_DIR ────────────────────────────────────────────

_pull_repo() {
  local repo="$1" name branch
  name="$(basename "$repo")"

  if [[ -n "$(git -C "$repo" status --porcelain 2>/dev/null)" ]]; then
    warn "${name}: uncommitted changes — skipping pull"
    return
  fi

  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if git -C "$repo" pull --ff-only --quiet 2>/dev/null; then
    ok "${name}: up to date (${branch})"
  else
    warn "${name}: pull failed or diverged — resolve manually (git -C ${repo} status)"
  fi
}

_pull_all_repos() {
  step "Pulling repos under ${SRC_DIR}..."

  if [[ ! -d "$SRC_DIR" ]]; then
    warn "${SRC_DIR} not found — skipping repo pulls"
    return
  fi

  local repo
  for repo in "$SRC_DIR"/*/; do
    [[ -d "${repo}.git" ]] || continue
    _pull_repo "$repo"
  done
}

# ── Resync lbl-config ────────────────────────────────────────────────────────

_sync_config() {
  step "Syncing lbl-config..."
  if command -v grim >/dev/null 2>&1; then
    grim config sync || warn "grim config sync failed — is grim serve reachable?"
  else
    warn "grim CLI not on PATH — skipping config sync"
  fi
}

# ── Rerun host hookups (idempotent) ──────────────────────────────────────────

_rerun_hookups() {
  step "Rerunning setup-client.sh (fingerprint + infra hookups)..."
  local setup_client="$ENGINE_ROOT/deploy/setup-client.sh"
  if [[ -x "$setup_client" ]]; then
    "$setup_client"
  else
    warn "setup-client.sh not found or not executable at $setup_client"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

_main() {
  _pull_all_repos
  _sync_config
  _rerun_hookups

  echo ""
  echo "░ Update complete."
  echo ""
}

_main "$@"
