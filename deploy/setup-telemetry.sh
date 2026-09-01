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
#   generate — regenerate scrape config + dashboard rows from the fleet roster,
#              then reload the live Prometheus so it takes
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
# Overridable so the generate/reload path can be exercised against a sandbox
# container (same seam pattern as FLEET_JS in generate-scrape.sh).
PROM_URL="${PROM_URL:-http://localhost:9090}"
PROM_CONTAINER="${PROM_CONTAINER:-grim-prometheus}"

# ── helpers ──────────────────────────────────────────────────────────────────

# Do the live Prometheus' scrape targets match the on-disk config? (Exact set
# compare via /api/v1/targets — the API's own view, not a regex over YAML.)
# Polls briefly: a (re)loaded target only appears in /api/v1/targets after its
# first scrape cycle (~scrape_interval). Bounded — a diverged mount (see
# cmd_generate) never matches and just burns the wait before the fallback.
_prom_targets_match() {
  local disk live tries
  # Compare raw host:port addresses — the live scrapeUrl carries the default
  # metrics path (http://aid:18081/metrics), so strip scheme + path there.
  disk=$(node -e "
    const c = require(process.argv[1]);
    const t = c.scrape_configs.flatMap(s => (s.static_configs || []).flatMap(x => x.targets));
    console.log(t.sort().join(' '));
  " "$TELEMETRY_DIR/prometheus.json" 2>/dev/null) || return 1
  [ -n "$disk" ] || return 1
  for tries in 1 2 3 4 5 6; do
    live=$(curl -sf "$PROM_URL/api/v1/targets?state=any" 2>/dev/null | node -e "
      let d = ''; process.stdin.on('data', c => d += c);
      process.stdin.on('end', () => {
        let j;
        try { j = JSON.parse(d) } catch { process.exit(1) }
        console.log((j.data.activeTargets || [])
          .map(t => t.scrapeUrl.replace(/^https?:\/\//, '').replace(/\/[^/]*$/, ''))
          .sort().join(' '));
      });") || return 1
    [ -n "$live" ] && [ "$disk" = "$live" ] && return 0
    sleep 3
  done
  return 1
}

cmd_generate() {
  step "Generating scrape config from the fleet roster"
  bash "$TELEMETRY_DIR/generate-scrape.sh" \
    || fail "generate-scrape.sh failed — live config left untouched (last-good)"
  ok "Scrape config written (in place — the container's file mount pins the inode)"

  step "Regenerating per-host dashboard rows from the fleet roster"
  node "$TELEMETRY_DIR/generate-dashboard.js" \
    || fail "generate-dashboard.js failed"
  ok "Dashboard rows synced"

  step "Reloading live Prometheus"
  # generate-scrape.sh rewrote the mounted file in place (same inode), so a
  # plain reload re-reads the NEW content — but only if the path still holds
  # the inode the container mounted. If it was swapped out from under us
  # (mv/rename since the container started), the reload re-reads the stale
  # inode and silently keeps the old config. Verify, and fall back to a
  # restart (re-resolves the mount) when it didn't take.
  if curl -sf "$PROM_URL/-/healthy" >/dev/null 2>&1; then
    curl -sf -X POST "$PROM_URL/-/reload" >/dev/null 2>&1
    if _prom_targets_match; then
      ok "Prometheus reloaded — live config matches the generated scrape config"
    else
      warn "Reload did not take (mount inode diverged) — restarting $PROM_CONTAINER"
      docker restart "$PROM_CONTAINER" || fail "docker restart $PROM_CONTAINER failed"
      # Verify the restart actually serves the new config — a restart onto an
      # unreadable mounted file (e.g. 0600 from a mktemp swap) crash-loops the
      # container, which is worse than stale.
      if _prom_targets_match; then
        ok "$PROM_CONTAINER restarted — live config re-resolved from the mount"
      else
        fail "$PROM_CONTAINER is not serving the generated config after restart — check: docker logs $PROM_CONTAINER (common cause: the mounted file is unreadable to the container user)"
      fi
    fi
  else
    warn "Prometheus unreachable at $PROM_URL — config on disk is current; run: docker restart grim-prometheus"
  fi
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
