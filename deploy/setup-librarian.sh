#!/usr/bin/env bash
# setup-librarian.sh — Install the grim-librarian userspace systemd timer
#
# Run on aid (the KB host):
#   deploy/setup-librarian.sh
#
# What it does:
#   1. Ensures %h/.grimoire/bin/node exists (pinned node)
#   2. Copies grim-librarian.{service,timer} to ~/.config/systemd/user/
#   3. Enables + starts the timer
#
# Sources deploy/lib.sh for ok/warn/fail/step helpers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SERVICE_DIR="$HOME/.config/systemd/user"

# ── pinned node ───────────────────────────────────────────────────────────────

PIN="$HOME/.grimoire/bin/node"
if [[ ! -x "$PIN" ]]; then
  warn "pinned node not found at $PIN — grim-librarian timer will fail until installed"
  warn "Run: deploy/setup-client.sh  (or install a pinned node manually)"
fi

# ── systemd install ───────────────────────────────────────────────────────────

_install() {
  step "Installing grim-librarian systemd timer"
  mkdir -p "$SERVICE_DIR"

  cp "$SCRIPT_DIR/grim-librarian.service" "$SERVICE_DIR/grim-librarian.service"
  ok "Installed grim-librarian.service"

  cp "$SCRIPT_DIR/grim-librarian.timer" "$SERVICE_DIR/grim-librarian.timer"
  ok "Installed grim-librarian.timer"

  systemctl --user daemon-reload
  systemctl --user enable grim-librarian.timer
  ok "grim-librarian.timer enabled"

  systemctl --user start grim-librarian.timer
  ok "grim-librarian.timer started"

  ok "Nightly commit+push at 03:00 (Persistent=true — catches up after downtime)"
}

_install
