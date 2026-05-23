#!/usr/bin/env bash
# grim-boot-report.sh — record this box's reboot in the Grimoire KB.
# Best-effort, no retry. If the server isn't up, the event is lost.
#
# Deploy (userspace, no sudo):
#   ln -s ~/src/me/grimoire ~/.grimoire          # or /mnt/eighty/... on aid
#   install -m644 ~/.grimoire/deploy/grim-boot-report.service ~/.config/systemd/user/
#   systemctl --user daemon-reload && systemctl --user enable --now grim-boot-report

GRIMOIRE_HOST="${GRIMOIRE_HOST:-http://aid:3663}"

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
  local payload
  payload="$(_build_payload)"
  curl -sf --max-time 10 \
    -X POST "${GRIMOIRE_HOST}/api/tome/remember" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    >/dev/null 2>&1
}

_main() {
  _report || true
}

_main "$@"
