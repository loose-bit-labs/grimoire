#!/usr/bin/env bash
# grim-boot-report.sh — record this box's reboot in the Grimoire KB.
# Best-effort, no retry. If the server isn't up, the event is lost.
#
# Deploy (userspace, no sudo):
#   ln -s ~/src/me/grimoire ~/.grimoire          # or /mnt/eighty/... on grimoire.local
#   install -m644 ~/.grimoire/deploy/grim-boot-report.service ~/.config/systemd/user/
#   systemctl --user daemon-reload && systemctl --user enable --now grim-boot-report

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

GRIMOIRE_HOST="${GRIMOIRE_HOST:-$(_grimoire_host)}"
LOG_DIR="/home/vgvm/.grimoire/logs"
LOG_FILE="${LOG_DIR}/boot-report.log"

_build_payload() {
  local host ts name desc
  host="$(hostname -s)"
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  name="Reboot: ${host} ${ts}"
  desc="Host ${host} rebooted at ${ts}."
  printf '{"type":"DefinedTerm","name":"%s","description":"%s","tags":["event/reboot","host/%s"]}' \
    "$name" "$desc" "$host"
}

_report() {
  local payload resp code
  payload="$(_build_payload)"
  mkdir -p "$LOG_DIR"
  resp=$(curl -sf --max-time 10 -w "%{http_code}" \
    -X POST "${GRIMOIRE_HOST}/api/tome/remember" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || code=0
  if [ "${resp: -3}" = "200" ] || [ "$resp" = "true" ]; then
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") OK: $(hostname -s) reboot reported" >> "$LOG_FILE"
  else
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") FAIL: $(hostname -s) reboot report failed (http=$resp)" >> "$LOG_FILE"
  fi
}

_main() {
  _report || true
}

_main "$@"
