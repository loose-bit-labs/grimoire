#!/usr/bin/env bash
# setup-telemetry.sh — Stand up Prometheus + Grafana telemetry stack via docker compose.
#
# Usage:
#   deploy/setup-telemetry.sh [up|down|status|generate]
#
# Subcommands:
#   up       — generate scrape config, write compose, start containers
#   down     — stop and remove containers and volumes
#   status   — show container status
#   generate — regenerate scrape config from rig.json only
#
# Sources deploy/lib.sh for ok/warn/fail/step helpers.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

TELEMETRY_DIR="$SCRIPT_DIR/telemetry"
COMPOSE_FILE="$TELEMETRY_DIR/compose.json"
GENERATOR="$TELEMETRY_DIR/generate-scrape.sh"

# ── helpers ──────────────────────────────────────────────────────────────────

cmd_generate() {
  step "Generating scrape config from rig.json"
  bash "$GENERATOR"
  ok "Scrape config written"
}

cmd_up() {
  # Ensure telemetry directory exists
  mkdir -p "$TELEMETRY_DIR"

  # Generate scrape config
  cmd_generate

  # Validate compose file
  if [ ! -f "$COMPOSE_FILE" ]; then
    fail "Compose file not found at $COMPOSE_FILE"
  fi

  # Validate JSON
  node -e "JSON.parse(require('fs').readFileSync('$COMPOSE_FILE','utf8'))" \
    2>/dev/null || fail "Invalid JSON in $COMPOSE_FILE"

  # Check docker is available
  command -v docker >/dev/null 2>&1 || fail "docker not found in PATH"
  docker info >/dev/null 2>&1 || fail "docker daemon not running"

  # Start containers
  step "Starting telemetry stack"
  (
    cd "$TELEMETRY_DIR"
    docker compose -f compose.json up -d
  ) || fail "docker compose up failed"

  ok "Prometheus → http://localhost:9090"
  ok "Grafana    → http://localhost:3000  (admin/grimoire)"
  step "Waiting for readiness"
  sleep 5

  # Verify Prometheus is up
  if curl -sf http://localhost:9090/-/healthy >/dev/null 2>&1; then
    ok "Prometheus healthy"
  else
    warn "Prometheus not ready yet — check with: docker logs grim-prometheus"
  fi

  # Verify Grafana is up
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    ok "Grafana healthy"
  else
    warn "Grafana not ready yet — check with: docker logs grim-grafana"
  fi

  ok "Telemetry stack up"
}

cmd_down() {
  step "Stopping telemetry stack"
  if [ ! -f "$COMPOSE_FILE" ]; then
    warn "No compose file at $COMPOSE_FILE — nothing to stop"
    return 0
  fi
  (
    cd "$TELEMETRY_DIR"
    docker compose -f compose.json down --volumes
  ) || warn "docker compose down reported errors"
  ok "Telemetry stack down"
}

cmd_status() {
  if [ ! -f "$COMPOSE_FILE" ]; then
    echo "No compose file at $COMPOSE_FILE"
    return 1
  fi
  (
    cd "$TELEMETRY_DIR"
    docker compose -f compose.json ps 2>/dev/null || \
    docker compose -f compose.json ps
  )
}

# ── main ─────────────────────────────────────────────────────────────────────

_main() {
  local cmd="${1:-up}"
  case "$cmd" in
    up)       cmd_up ;;
    down)     cmd_down ;;
    status)   cmd_status ;;
    generate) cmd_generate ;;
    *)        fail "Unknown command: $cmd (use up|down|status|generate)" ;;
  esac
}

_main "$@"
