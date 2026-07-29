#!/usr/bin/env bash
# setup-telemetry.sh — Stand up Prometheus + Grafana as pinned user-space systemd units.
#
# Usage:
#   deploy/setup-telemetry.sh [up|down|status|generate]
#
# Subcommands:
#   up       — install pinned binaries, write units, start services
#   down     — stop and disable services (keeps data intact)
#   status   — show service status
#   generate — regenerate scrape config from rig.json only
#
# Sources deploy/lib.sh for ok/warn/fail/step helpers.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

TELEMETRY_DIR="$SCRIPT_DIR/telemetry"
BIN_DIR="$HOME/.grimoire-telemetry/bin"
GRAFANA_DIST="$HOME/.grimoire-telemetry/grafana"
PROMETHEUS_BIN="$BIN_DIR/prometheus"
GRAFANA_BIN="$BIN_DIR/grafana-server"
SERVICE_DIR="$HOME/.config/systemd/user"

# ── helpers ──────────────────────────────────────────────────────────────────

cmd_generate() {
  step "Generating scrape config from rig.json"
  bash "$TELEMETRY_DIR/generate-scrape.sh"
  ok "Scrape config written"
}

# ── binary install ────────────────────────────────────────────────────────────

_ensure_binaries() {
  mkdir -p "$BIN_DIR"

  # Prometheus v2.55.0
  if [ ! -x "$PROMETHEUS_BIN" ]; then
    step "Downloading Prometheus v2.55.0"
    local prom_tar="prometheus-2.55.0.linux-amd64.tar.gz"
    local prom_url="https://github.com/prometheus/prometheus/releases/download/v2.55.0/$prom_tar"
    curl -fSL "$prom_url" -o "/tmp/$prom_tar" \
      || fail "Failed to download Prometheus from $prom_url"
    tar xzf "/tmp/$prom_tar" -C /tmp --strip-components=1 \
      || fail "Failed to extract Prometheus"
    mv /tmp/prometheus /tmp/promtool "$BIN_DIR/" \
      || fail "Failed to install Prometheus binaries"
    rm -f "/tmp/$prom_tar"
    ok "Pinned Prometheus → $PROMETHEUS_BIN"
  else
    ok "Pinned Prometheus already at $PROMETHEUS_BIN"
  fi

  # Grafana v11.3.0
  if [ ! -x "$GRAFANA_BIN" ]; then
    step "Downloading Grafana v11.3.0"
    local graf_tar="grafana-11.3.0.linux-amd64.tar.gz"
    local graf_url="https://dl.grafana.com/oss/release/$graf_tar"
    curl -fSL "$graf_url" -o "/tmp/$graf_tar" \
      || fail "Failed to download Grafana from $graf_url"
    mkdir -p "$GRAFANA_DIST"
    tar xzf "/tmp/$graf_tar" -C "$HOME/.grimoire-telemetry" --strip-components=1 \
      || fail "Failed to extract Grafana"
    rm -f "/tmp/$graf_tar"
    ok "Pinned Grafana → $GRAFANA_BIN"
  else
    ok "Pinned Grafana already at $GRAFANA_BIN"
  fi
}

# ── systemd install ───────────────────────────────────────────────────────────

_ensure_systemd() {
  step "Installing systemd user services"
  mkdir -p "$SERVICE_DIR"

  # Lingering — service survives logout
  if command -v loginctl &>/dev/null; then
    if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
      ok "lingering already enabled for $USER"
    else
      loginctl enable-linger "$USER" 2>/dev/null \
        && ok "lingering enabled for $USER (services survive logout)" \
        || warn "could not enable lingering — run: loginctl enable-linger $USER"
    fi
  fi

  # Prometheus unit
  local prom_svc="$SERVICE_DIR/grim-prometheus.service"
  if [ ! -f "$prom_svc" ]; then
    cp "$SCRIPT_DIR/grim-prometheus.service" "$prom_svc"
    ok "Installed grim-prometheus.service"
  else
    ok "grim-prometheus.service already installed"
  fi

  # Grafana unit
  local graf_svc="$SERVICE_DIR/grim-grafana.service"
  if [ ! -f "$graf_svc" ]; then
    cp "$SCRIPT_DIR/grim-grafana.service" "$graf_svc"
    ok "Installed grim-grafana.service"
  else
    ok "grim-grafana.service already installed"
  fi

  # Reload and enable
  systemctl --user daemon-reload
  systemctl --user enable grim-prometheus grim-grafana
  ok "Services enabled"
}

# ── commands ──────────────────────────────────────────────────────────────────

cmd_up() {
  mkdir -p "$TELEMETRY_DIR"
  cmd_generate
  _ensure_binaries
  _ensure_systemd

  step "Starting telemetry stack"
  systemctl --user start grim-prometheus grim-grafana \
    || fail "systemctl --user start failed"

  ok "Prometheus → http://localhost:9090"
  ok "Grafana    → http://localhost:3000  (admin/grimoire)"
  step "Waiting for readiness"
  sleep 5

  if curl -sf http://localhost:9090/-/healthy >/dev/null 2>&1; then
    ok "Prometheus healthy"
  else
    warn "Prometheus not ready yet — check with: systemctl --user status grim-prometheus"
  fi

  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    ok "Grafana healthy"
  else
    warn "Grafana not ready yet — check with: systemctl --user status grim-grafana"
  fi

  ok "Telemetry stack up"
}

cmd_down() {
  step "Stopping telemetry stack"
  systemctl --user stop grim-prometheus grim-grafana 2>/dev/null
  systemctl --user disable grim-prometheus grim-grafana 2>/dev/null
  systemctl --user daemon-reload
  ok "Telemetry stack down"
}

cmd_status() {
  systemctl --user status grim-prometheus grim-grafana --no-pager
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
