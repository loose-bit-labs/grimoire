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

# ── 4. /etc/hosts — ensure 'aid' resolves ────────────────────────────────────

_ensure_etc_hosts() {
  step "Checking /etc/hosts for 'aid'..."
  if grep -qE '^\s*[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\s+.*\baid\b' /etc/hosts; then
    ok "aid already in /etc/hosts"
    return
  fi

  warn "aid not found in /etc/hosts"
  echo    "  The Grimoire server runs on a host named 'aid'."
  echo    "  Enter the IP address of aid (leave blank to skip — use grim host gen-hosts later):"
  local aid_ip
  read -r -p "  aid IP: " aid_ip

  if [[ -z "$aid_ip" ]]; then
    warn "skipped — run 'grim host gen-hosts' once KB is populated, then apply to /etc/hosts"
    return
  fi

  if [[ "$EUID" -ne 0 ]]; then
    echo "  Adding to /etc/hosts (requires sudo)..."
    echo "$aid_ip  aid" | sudo tee -a /etc/hosts > /dev/null
  else
    echo "$aid_ip  aid" >> /etc/hosts
  fi
  ok "added: $aid_ip  aid"
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

# ── 11. grim-rig-serve persistent userspace service ───────────────────────────

_install_rig_serve_service() {
  step "Installing grim-rig-serve systemd user service..."
  local service_src="$ENGINE_ROOT/deploy/grim-rig-serve.service"
  local service_dir="$HOME/.config/systemd/user"
  local service_dst="$service_dir/grim-rig-serve.service"
  local log_dir="$HOME/data/logs/grimoire"

  if ! command -v systemctl &>/dev/null; then
    warn "systemctl not found (not a systemd host, e.g. macOS) — skipping grim-rig-serve service"
    return
  fi
  if [[ ! -f "$service_src" ]]; then
    warn "grim-rig-serve.service not found in deploy/ — skipping"
    return
  fi

  mkdir -p "$log_dir"

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

  # Unlike grim-boot-report (fire-once), this is a persistent service: always
  # reinstall + restart so a re-run (e.g. via /update-host after a code
  # change) actually picks up the latest unit file and code.
  local was_enabled=false
  systemctl --user is-enabled grim-rig-serve &>/dev/null && was_enabled=true

  mkdir -p "$service_dir"
  install -m644 "$service_src" "$service_dst"
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
  _ensure_etc_hosts
  _activate_git_hooks
  _configure_claude_code
  _install_grim_link
  _create_dotlink
  _install_boot_report_service
  _register_host
  _install_rig_serve_service
  _smoke_test

  echo ""
  echo "░ Setup complete."
  echo "  Restart Claude Code to activate the MCP tools, then: /load"
  echo ""
}

_main "$@"
