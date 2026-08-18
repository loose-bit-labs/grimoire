#!/usr/bin/env bash
# deploy/setup-client.sh — configure this machine as a Grimoire client
#
# Run after cloning the repo:
#   cd grimoire && ./deploy/setup-client.sh
#
# What it does:
#   1. Checks Node.js 18+
#   2. npm install
#   3. Writes minimal .env (GRIMOIRE_ROOT unset; host resolved via lbl-config.json)
#   4. Ensures the grimoire host is in /etc/hosts (reads aid from lbl-config if present)
#   5. Activates git hooks (.githooks/pre-commit)
#   6. Configures Claude Code: MCP server + plugin
#   7. Symlinks grim CLI into ~/bin (no sudo, no global install)
#   8. Creates ~/.grimoire dotlink
#   9. Installs grim-boot-report userspace systemd service
#  10. Registers hardware inventory in the KB (re-run anytime after upgrades)
#  11. Installs & (re)starts the grim-rig-serve userspace telemetry service
#  12. Smoke-tests the connection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

# ── 1. Node.js ────────────────────────────────────────────────────────────────

_check_node() {
  step "Checking Node.js..."
  local node_bin node_major
  node_bin=$(which node 2>/dev/null || true)
  [[ -z "$node_bin" ]] && fail "Node.js not found — install Node.js 18+ first (https://nodejs.org)"

  node_major=$(node -e 'process.stdout.write(process.version.slice(1).split(".")[0])')
  [[ "$node_major" -lt 18 ]] && fail "Node.js 18+ required (found v$(node -e 'process.stdout.write(process.version.slice(1))'))"
  ok "Node.js $(node --version)"
}

# ── 2. npm install ────────────────────────────────────────────────────────────

_npm_install() {
  step "Installing dependencies..."
  cd "$ENGINE_ROOT"
  npm install --silent
  ok "npm install done"
}

# ── 3. .env (minimal — host resolution uses lbl-config.json) ────────────────

_write_env() {
  step "Configuring .env..."
  local env_file="$ENGINE_ROOT/.env"

  if [[ -f "$env_file" ]]; then
    warn ".env already exists — skipping (delete it to regenerate)"
    return
  fi

  cat > "$env_file" <<'EOF'
# Grimoire client — remote mode
# GRIMOIRE_ROOT is intentionally unset; all KB access goes via the server.
# Host/model resolution uses ~/.config/lbl-config.json (endpoints.grimoire).
# Override here only if you need to point at a non-default server:
# GRIMOIRE_HOST=http://aid:3663
EOF
  ok "wrote .env (minimal)"
}

# ── 4. Bootstrap + /etc/hosts ────────────────────────────────────────────────
# Seed exactly one bootstrap value (GRIMOIRE_HOST in .env or minimal lbl-config),
# then run grim host gen-hosts --apply so every fleet host resolves from the
# managed block. Graceful if sudo is unavailable.

_seed_bootstrap_and_hosts() {
  step "Seeding bootstrap + applying /etc/hosts..."

  # ── 4a. Seed exactly one bootstrap value ──────────────────────────────────
  # Prefer writing a minimal lbl-config.json (survives across env changes);
  # fall back to GRIMOIRE_HOST in .env if lbl-config already has content.

  local lbl_cfg="$HOME/.config/lbl-config.json"
  local has_grimoire=false
  if [[ -f "$lbl_cfg" ]]; then
    has_grimoire=$(node -e "
      try {
        const c = JSON.parse(require('fs').readFileSync('$lbl_cfg','utf8'));
        process.stdout.write(c.endpoints?.grimoire ? 'true' : 'false');
      } catch { process.stdout.write('false'); }
    " 2>/dev/null || echo false)
  fi

  if [[ "$has_grimoire" == "true" ]]; then
    ok "lbl-config.json already has endpoints.grimoire — skipping bootstrap seed"
  else
    # Write minimal lbl-config with just the grimoire endpoint
    mkdir -p "$HOME/.config"
    cat > "$lbl_cfg" <<EOF
{
  "endpoints": {
    "grimoire": "$(_grimoire_host)"
  }
}
EOF
    ok "seeded minimal lbl-config.json (endpoints.grimoire = $(_grimoire_host))"
  fi

  # ── 4b. Apply fleet host resolution ───────────────────────────────────────
  # grim host gen-hosts --apply writes a managed block to /etc/hosts.
  # Graceful if sudo is unavailable (warn, don't fail).

  local grim_bin
  grim_bin=$(command -v grim 2>/dev/null || echo "$ENGINE_ROOT/bin/grim.js")

  if [[ ! -x "$grim_bin" && ! -f "$grim_bin" ]]; then
    # Try via node directly
    grim_bin="$ENGINE_ROOT/bin/grim.js"
  fi

  if [[ "$EUID" -eq 0 ]]; then
    # Root — can write directly
    if node "$grim_bin" host gen-hosts --apply 2>/dev/null; then
      ok "grim host gen-hosts --apply succeeded"
    else
      warn "grim host gen-hosts --apply failed — /etc/hosts may need manual update"
    fi
  elif sudo -n true 2>/dev/null; then
    # Non-root but sudo available (no prompt)
    if sudo node "$grim_bin" host gen-hosts --apply 2>/dev/null; then
      ok "grim host gen-hosts --apply succeeded (via sudo)"
    else
      warn "grim host gen-hosts --apply failed — /etc/hosts may need manual update"
    fi
  else
    warn "no sudo available — skipping grim host gen-hosts --apply"
    warn "  Once sudo is available: sudo grim host gen-hosts --apply"
  fi

  # ── 4c. Turnkey proof: confirm intent resolution works ────────────────────
  step "Verifying intent resolution..."
  local resolved
  resolved=$(node -e "
    const { lblEndpoint } = require('$ENGINE_ROOT/lib/env');
    process.stdout.write(lblEndpoint('ollama') || 'null');
  " 2>/dev/null || echo "null")

  if [[ "$resolved" != "null" && "$resolved" != "" ]]; then
    ok "intent resolution works: use.ollama → $resolved"
  else
    warn "intent resolution failed — check that aid resolves and grim serve is running"
    warn "  Bootstrap: lbl-config.json has endpoints.grimoire = $(_grimoire_host)"
  fi
}

# ── 5. Git hooks ─────────────────────────────────────────────────────────────

_activate_git_hooks() {
  step "Activating git hooks (.githooks/)..."
  cd "$ENGINE_ROOT"
  git config core.hooksPath .githooks \
    && ok "git hooks active (.githooks/pre-commit)" \
    || warn "git config failed — run manually: git config core.hooksPath .githooks"
}

# ── 6. Claude Code — MCP + plugin ─────────────────────────────────────────────

_configure_claude_code() {
  step "Configuring Claude Code..."

  local claude_bin grimoire_url mcp_url
  claude_bin=$(which claude 2>/dev/null || true)
  grimoire_url="$(_grimoire_host)"
  mcp_url="${grimoire_url}/mcp"

  if [[ -z "$claude_bin" ]]; then
    warn "claude CLI not found — skipping Claude Code setup"
    warn "Install Claude Code then run: claude mcp add --transport http grimoire ${mcp_url} --scope user"
    return
  fi

  # MCP server
  if claude mcp list 2>/dev/null | grep -q 'grimoire'; then
    ok "grimoire MCP server already configured"
  else
    claude mcp add --transport http grimoire "${mcp_url}" --scope user 2>/dev/null \
      && ok "grimoire MCP server registered (${mcp_url})" \
      || warn "MCP registration failed — run manually: claude mcp add --transport http grimoire ${mcp_url} --scope user"
  fi

  # Plugin marketplace + install
  local marketplace_dir="$HOME/data/claude-plugins"
  local marketplace_json="$marketplace_dir/.claude-plugin/marketplace.json"

  if claude plugin list 2>/dev/null | grep -q 'grimoire'; then
    ok "grimoire plugin already installed"
    return
  fi

  # Set up local marketplace pointing at this repo's plugin dir
  mkdir -p "$marketplace_dir/.claude-plugin"
  mkdir -p "$marketplace_dir/plugins"

  # Symlink or copy plugin dir
  if [[ ! -e "$marketplace_dir/plugins/grimoire" ]]; then
    ln -s "$ENGINE_ROOT/plugin" "$marketplace_dir/plugins/grimoire"
  fi

  cat > "$marketplace_json" <<EOF
{
  "\$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "local-plugins",
  "description": "Local Claude Code plugins",
  "owner": { "name": "local" },
  "plugins": [
    {
      "name": "grimoire",
      "description": "Personal knowledge graph — persistent memory, personas, session lifecycle",
      "category": "productivity",
      "source": "./plugins/grimoire"
    }
  ]
}
EOF

  claude plugin marketplace add "$marketplace_dir" 2>/dev/null || true
  claude plugin install grimoire --scope user 2>/dev/null \
    && ok "grimoire plugin installed" \
    || warn "plugin install failed — run manually: claude plugin install grimoire --scope user"
}

# ── 6b. Claude Code status line (grim dungeon HUD) ───────────────────────────

_install_statusline() {
  step "Installing Claude Code status line..."

  local src="$ENGINE_ROOT/deploy/claude-statusline.js"
  local link="$HOME/.claude/statusline.js"
  local settings="$HOME/.claude/settings.json"

  mkdir -p "$HOME/.claude"

  # Symlink the status line script (idempotent; repoints a stale link)
  ln -sfn "$src" "$link"
  ok "linked $link -> deploy/claude-statusline.js"

  # Register it in settings.json — merge, never clobber an existing statusLine
  local result
  result=$(CLAUDE_SETTINGS="$settings" node <<'NODE'
const fs = require('fs');
const f = process.env.CLAUDE_SETTINGS;
let s = {};
try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { s = {}; }
if (s && typeof s === 'object' && !s.statusLine) {
  s.statusLine = { type: 'command', command: 'node ~/.claude/statusline.js' };
  fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
  process.stdout.write('added');
} else {
  process.stdout.write('present');
}
NODE
)
  if [[ "$result" == "added" ]]; then
    ok "statusLine registered in settings.json"
  else
    ok "statusLine already configured"
  fi
}

# ── 7. Symlink grim CLI into ~/bin ───────────────────────────────────────────

_install_grim_link() {
  step "Linking grim CLI into ~/bin..."

  local bin_dir="$HOME/bin"
  local link="$bin_dir/grim"
  local target="$ENGINE_ROOT/bin/grim.js"

  mkdir -p "$bin_dir"
  chmod +x "$target"

  if [[ -L "$link" && "$(readlink "$link")" == "$target" ]]; then
    ok "~/bin/grim already linked"
    return
  fi

  if [[ -L "$link" || -e "$link" ]]; then
    warn "~/bin/grim already exists ($(readlink "$link" 2>/dev/null || echo 'not a symlink'))"
    local confirm
    read -r -p "  Overwrite it? [y/N] " confirm
    [[ "${confirm,,}" == "y" ]] || { warn "skipped — leaving existing ~/bin/grim in place"; return; }
    rm "$link"
  fi
  ln -s "$target" "$link"
  ok "linked: ~/bin/grim → $target"

  if ! echo ":$PATH:" | grep -q ":$bin_dir:"; then
    warn "~/bin is not in PATH — add this to your shell profile:"
    warn "  export PATH=\"\$HOME/bin:\$PATH\""
  fi
}

# ── 8. ~/.grimoire dotlink ────────────────────────────────────────────────────

_create_dotlink() {
  step "Creating ~/.grimoire dotlink..."
  local dotlink="$HOME/.grimoire"
  if [[ -L "$dotlink" && "$(readlink "$dotlink")" == "$ENGINE_ROOT" ]]; then
    ok "~/.grimoire already linked"
  elif [[ -e "$dotlink" ]]; then
    warn "~/.grimoire exists but points elsewhere ($(readlink "$dotlink" 2>/dev/null || echo 'not a symlink')) — skipping"
  else
    ln -s "$ENGINE_ROOT" "$dotlink"
    ok "linked: ~/.grimoire → $ENGINE_ROOT"
  fi
}

# ── 9. grim-boot-report userspace service ─────────────────────────────────────

_install_boot_report_service() {
  step "Installing grim-boot-report systemd user service..."
  local service_src="$ENGINE_ROOT/deploy/grim-boot-report.service"
  local service_dir="$HOME/.config/systemd/user"
  local service_dst="$service_dir/grim-boot-report.service"

  if ! command -v systemctl &>/dev/null; then
    warn "systemctl not found (not a systemd host, e.g. macOS) — skipping grim-boot-report service"
  elif [[ ! -f "$service_src" ]]; then
    warn "grim-boot-report.service not found in deploy/ — skipping"
  elif systemctl --user is-enabled grim-boot-report &>/dev/null; then
    ok "grim-boot-report service already enabled"
  else
    mkdir -p "$service_dir"
    install -m644 "$service_src" "$service_dst"
    systemctl --user daemon-reload
    systemctl --user enable grim-boot-report 2>/dev/null \
      && ok "grim-boot-report enabled (fires on next boot)" \
      || warn "systemctl enable failed — run: systemctl --user enable grim-boot-report"
  fi
}

# ── 10. Register this machine in the KB ───────────────────────────────────────

_register_host() {
  step "Registering hardware inventory in KB..."
  local register_script="$ENGINE_ROOT/deploy/grim-register-host.sh"
  if [[ -x "$register_script" ]]; then
    # Script resolves its own GRIMOIRE_HOST via lbl-config.json if not set
    "$register_script" \
      || warn "registration failed — re-run manually: $register_script"
  else
    warn "grim-register-host.sh not found — skipping"
  fi
}

# ── 10.5. Ensure ~/.grimoire/bin/node pin (pinned-node convention) ──────────

_ensure_node_pin() {
  step "Ensuring pinned Node.js at ~/.grimoire/bin/node..."

  local pin_dir="$HOME/.grimoire/bin"
  local pin="$pin_dir/node"
  local target="$HOME/.nvm/versions/node/v21.7.1/bin/node"

  if [[ -L "$pin" && "$(readlink "$pin")" == "$target" ]]; then
    ok "pinned node already at ~/.grimoire/bin/node → v21.7.1"
    return
  fi

  # Ensure nvm has the pinned version
  if [[ ! -x "$target" ]]; then
    if command -v nvm &>/dev/null; then
      nvm install 21.7.1 2>/dev/null \
        || fail "nvm install 21.7.1 failed — run it manually, then re-run setup-client.sh"
    else
      # nvm not in PATH — try sourcing it
      local nvm_sh
      nvm_sh=$(find "$HOME/.nvm" -name "nvm.sh" 2>/dev/null | head -1)
      if [[ -n "$nvm_sh" ]]; then
        # shellcheck source=/dev/null
        source "$nvm_sh"
        nvm install 21.7.1 2>/dev/null \
          || fail "nvm install 21.7.1 failed — run it manually, then re-run setup-client.sh"
      else
        fail "nvm not found and v21.7.1 not installed — install Node.js v21.7.1 via nvm first"
      fi
    fi
  fi

  mkdir -p "$pin_dir"
  ln -sf "$target" "$pin"
  ok "pinned: ~/.grimoire/bin/node → v21.7.1"
}

# ── 11. grim-rig-serve persistent userspace service ───────────────────────────

_install_rig_serve_service() {
  mkdir -p "$HOME/data/logs/grimoire"

  # Verify the pinned node exists (created by _ensure_node_pin)
  local pin="$HOME/.grimoire/bin/node"
  if [[ ! -x "$pin" ]]; then
    warn "~/.grimoire/bin/node not found — run _ensure_node_pin first"
    return
  fi

  if command -v systemctl &>/dev/null; then
    _install_rig_serve_systemd "$pin"
  elif command -v launchctl &>/dev/null; then
    _install_rig_serve_launchd "$pin"
  else
    warn "no init system found (systemctl/launchctl) — skipping grim-rig-serve service"
  fi
}

_install_rig_serve_systemd() {
  local pin="$1"
  step "Installing grim-rig-serve systemd user service..."

  # Lingering — a user unit dies at logout unless linger is on. Check first,
  # don't assume; don't fail the install if the check itself is unavailable.
  if command -v loginctl &>/dev/null; then
    if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
      ok "lingering already enabled for $USER"
    else
      loginctl enable-linger "$USER" 2>/dev/null \
        && ok "lingering enabled for $USER (service will survive logout)" \
        || warn "could not enable lingering — run: loginctl enable-linger $USER"
    fi
  else
    warn "loginctl not found — cannot verify/enable lingering; service may not survive logout"
  fi

  local was_enabled=false
  systemctl --user is-enabled grim-rig-serve &>/dev/null && was_enabled=true

  local service_dir="$HOME/.config/systemd/user"
  local service_dst="$service_dir/grim-rig-serve.service"
  mkdir -p "$service_dir"

  cat > "$service_dst" <<EOF
[Unit]
Description=grim rig serve — resident homelab telemetry agent (/status + /metrics)
After=network.target

[Service]
WorkingDirectory=%h/.grimoire
ExecStart=%h/.grimoire/bin/node bin/grim.js rig serve --listen 0.0.0.0 --port 18081
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/data/logs/grimoire/grim-rig.log
StandardError=append:%h/data/logs/grimoire/grim-rig.log

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload

  if $was_enabled; then
    ok "grim-rig-serve already enabled"
  else
    systemctl --user enable grim-rig-serve 2>/dev/null \
      && ok "grim-rig-serve enabled" \
      || warn "systemctl enable failed — run: systemctl --user enable grim-rig-serve"
  fi

  systemctl --user restart grim-rig-serve 2>/dev/null \
    && ok "grim-rig-serve running" \
    || warn "systemctl restart failed — run: systemctl --user restart grim-rig-serve"

  _verify_rig_serve
}

_verify_rig_serve() {
  # Poll localhost:18081/status up to 5×/5s after restart. Trusting
  # systemctl restart's exit code is not enough — a clean TERM (deploy-adjacent,
  # never confirmed exactly what) leaves Restart=on-failure doing nothing.
  # Closes the "deploy silently ships a dead service" gap.
  for i in $(seq 1 5); do
    if curl -sf --max-time 3 http://localhost:18081/status -o /dev/null 2>/dev/null; then
      ok "grim-rig-serve responding on :18081 (check ${i}/5)"
      return
    fi
    sleep 1
  done
  warn "grim-rig-serve did not come up on :18081 after 5s — check: systemctl --user status grim-rig-serve"
}

_install_rig_serve_launchd() {
  local pin="$1"
  step "Installing grim-rig-serve launchd LaunchAgent..."

  local plist_src="$ENGINE_ROOT/deploy/com.grimoire.rig-serve.plist"
  local plist_dst="$HOME/Library/LaunchAgents/com.grimoire.rig-serve.plist"

  if [[ ! -f "$plist_src" ]]; then
    warn "com.grimoire.rig-serve.plist not found in deploy/ — skipping"
    return
  fi

  # Template paths into the plist
  local engine_root
  engine_root="$(cd "$ENGINE_ROOT" && pwd)"
  sed -e "s|__NODE_BIN__|${pin}|g" \
      -e "s|__ENGINE_ROOT__|${engine_root}|g" \
      -e "s|__HOME__|${HOME}|g" \
      "$plist_src" > "$plist_dst"

  # Unload if previously loaded (ignore "not found" errors)
  launchctl unload "$plist_dst" 2>/dev/null || true

  launchctl load -w "$plist_dst" \
    && ok "grim-rig-serve LaunchAgent loaded" \
    || warn "launchctl load failed — run: launchctl load -w $plist_dst"

  _verify_rig_serve
}

# ── 11.5. Dashboard service (hub-only, conditional) ──────────────────────────

_install_dashboard_service() {
  step "Checking for dashboard hub role..."

  local pin="$HOME/.grimoire/bin/node"
  if [[ ! -x "$pin" ]]; then
    warn "~/.grimoire/bin/node not found — skipping dashboard install"
    return
  fi

  # Check if this box is flagged as a dashboard hub in rig.json
  local rig_json="$HOME/.grimoire/rig.json"
  if [[ ! -f "$rig_json" ]]; then
    ok "no rig.json — skipping dashboard install"
    return
  fi

  local is_hub
  is_hub=$(node -e "
    const boxes = JSON.parse(require('fs').readFileSync('$rig_json', 'utf8'));
    const hostname = require('os').hostname().toLowerCase();
    const box = (Array.isArray(boxes) ? boxes : Object.values(boxes)).find(b =>
      (b.aliases || []).includes(hostname) || b.host === hostname || b.label === hostname
    );
    process.stdout.write(box && box.dashboard ? 'true' : 'false');
  " 2>/dev/null || echo "false")

  if [[ "$is_hub" != "true" ]]; then
    ok "this box is not a dashboard hub — skipping"
    return
  fi

  ok "this box is a dashboard hub — installing dashboard service"

  if command -v systemctl &>/dev/null; then
    _install_dashboard_systemd "$pin"
  elif command -v launchctl &>/dev/null; then
    _install_dashboard_launchd "$pin"
  else
    warn "no init system found — skipping dashboard service"
  fi
}

_install_dashboard_systemd() {
  local pin="$1"
  step "Installing grim-rig-dashboard systemd user service..."

  local was_enabled=false
  systemctl --user is-enabled grim-rig-dashboard &>/dev/null && was_enabled=true

  local service_dir="$HOME/.config/systemd/user"
  local service_dst="$service_dir/grim-rig-dashboard.service"
  mkdir -p "$service_dir"

  cat > "$service_dst" <<EOF
[Unit]
Description=grim rig dashboard — fleet cockpit front-door (/cluster + /fleet)
After=network.target

[Service]
WorkingDirectory=%h/.grimoire
ExecStart=%h/.grimoire/bin/node bin/grim.js rig serve --dashboard --listen 0.0.0.0 --port 3003
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/data/logs/grimoire/grim-rig-dashboard.log
StandardError=append:%h/data/logs/grimoire/grim-rig-dashboard.log

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload

  if $was_enabled; then
    ok "grim-rig-dashboard already enabled"
  else
    systemctl --user enable grim-rig-dashboard 2>/dev/null \
      && ok "grim-rig-dashboard enabled" \
      || warn "systemctl enable failed — run: systemctl --user enable grim-rig-dashboard"
  fi

  systemctl --user restart grim-rig-dashboard 2>/dev/null \
    && ok "grim-rig-dashboard running" \
    || warn "systemctl restart failed — run: systemctl --user restart grim-rig-dashboard"
}

_install_dashboard_launchd() {
  local pin="$1"
  step "Installing grim-rig-dashboard launchd LaunchAgent..."

  local plist_src="$ENGINE_ROOT/deploy/com.grimoire.rig-dashboard.plist"
  local plist_dst="$HOME/Library/LaunchAgents/com.grimoire.rig-dashboard.plist"

  if [[ ! -f "$plist_src" ]]; then
    warn "com.grimoire.rig-dashboard.plist not found in deploy/ — skipping"
    return
  fi

  local engine_root
  engine_root="$(cd "$ENGINE_ROOT" && pwd)"
  sed -e "s|__NODE_BIN__|${pin}|g" \
      -e "s|__ENGINE_ROOT__|${engine_root}|g" \
      -e "s|__HOME__|${HOME}|g" \
      "$plist_src" > "$plist_dst"

  launchctl unload "$plist_dst" 2>/dev/null || true
  launchctl load -w "$plist_dst" \
    && ok "grim-rig-dashboard LaunchAgent loaded" \
    || warn "launchctl load failed — run: launchctl load -w $plist_dst"
}

# ── 12. Smoke test ────────────────────────────────────────────────────────────

_smoke_test() {
  local grimoire_url
  grimoire_url="$(_grimoire_host)"
  step "Testing connection to ${grimoire_url}..."
  if curl -sf --max-time 5 "${grimoire_url}/health" -o /dev/null 2>/dev/null; then
    local health
    health=$(curl -s "${grimoire_url}/health")
    ok "Grimoire server reachable — $health"
  else
    warn "Cannot reach ${grimoire_url}/health"
    warn "Make sure grim serve is running on aid (or set endpoints.grimoire in ~/.config/lbl-config.json)"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

_main() {
  _check_node
  _npm_install
  _write_env
  _seed_bootstrap_and_hosts
  _activate_git_hooks
  _configure_claude_code
  _install_statusline
  _install_grim_link
  _create_dotlink
  _install_boot_report_service
  _register_host
  _ensure_node_pin
  _install_rig_serve_service
  _install_dashboard_service
  _smoke_test

  echo ""
  echo "░ Setup complete."
  echo "  Restart Claude Code to activate the MCP tools, then: /load"
  echo ""
}

_main "$@"
