#!/usr/bin/env bash
# deploy/setup-ner.sh — set up the Grimoire NER service Python environment
#
# Run from the grimoire engine root:
#   ./deploy/setup-ner.sh
#
# Requires pyenv + pyenv-virtualenv. Python 3.11.x must be installed:
#   pyenv install 3.11.9

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

# ── 1. pyenv ──────────────────────────────────────────────────────────────────

check_pyenv() {
  command -v pyenv &>/dev/null || fail "pyenv not found — install it first: https://github.com/pyenv/pyenv"
  command -v pyenv-virtualenv &>/dev/null 2>&1 || \
    pyenv virtualenv --version &>/dev/null 2>&1 || \
    fail "pyenv-virtualenv not found — install it: https://github.com/pyenv/pyenv-virtualenv"
  ok "pyenv $(pyenv --version | head -1)"
}

# ── 2. Python version ─────────────────────────────────────────────────────────

ensure_python() {
  local version="3.11.9"
  if ! pyenv versions --bare | grep -q "^${version}$"; then
    step "Installing Python ${version} via pyenv..."
    pyenv install "$version"
  fi
  ok "Python ${version} available"
}

# ── 3. Virtualenv ─────────────────────────────────────────────────────────────

ensure_virtualenv() {
  local name="grimoire-ner"
  if pyenv versions --bare | grep -q "^${name}$"; then
    ok "virtualenv '${name}' already exists"
  else
    step "Creating virtualenv ${name}..."
    pyenv virtualenv 3.11.9 "$name"
    ok "created ${name}"
  fi

  # Pin the virtualenv to this directory
  echo "$name" > "$ENGINE_ROOT/.python-version"
  ok "pinned .python-version → ${name}"
}

# ── 4. Dependencies ───────────────────────────────────────────────────────────

install_deps() {
  step "Installing Python dependencies..."
  cd "$ENGINE_ROOT"
  pyenv exec pip install --quiet --upgrade pip
  pyenv exec pip install --quiet -r requirements.txt
  ok "dependencies installed"
}

# ── 5. Pre-download models ────────────────────────────────────────────────────

prefetch_models() {
  step "Pre-fetching NER models (this downloads ~1.5GB on first run)..."
  cd "$ENGINE_ROOT"
  pyenv exec python - <<'PYEOF'
import sys
print("  Fetching GLiNER model...")
from gliner import GLiNER
GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
print("  GLiNER OK")

print("  Fetching Rebel model...")
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
AutoTokenizer.from_pretrained("Babelscape/rebel-large")
AutoModelForSeq2SeqLM.from_pretrained("Babelscape/rebel-large")
print("  Rebel OK")
PYEOF
  ok "models cached"
}

# ── 6. Systemd service ────────────────────────────────────────────────────────

install_service() {
  local service_file=/etc/systemd/system/grimoire-ner.service
  local python_bin
  python_bin="$(cd "$ENGINE_ROOT" && pyenv exec which python)"

  if [[ "$EUID" -ne 0 ]]; then
    echo ""
    warn "Skipping systemd install (not root). To install manually:"
    warn "  sudo $0 --service-only"
    warn "Or run manually: cd $ENGINE_ROOT && pyenv exec python bin/grim-ner-server.py"
    return
  fi

  step "Installing grimoire-ner systemd service..."
  cat > "$service_file" <<EOF
[Unit]
Description=Grimoire NER Service (GLiNER + Rebel)
Documentation=https://github.com/vgvm-lbl/grimoire
After=network.target grimoire.service

[Service]
Type=simple
User=$(logname 2>/dev/null || echo "${SUDO_USER:-$USER}")
WorkingDirectory=$ENGINE_ROOT
ExecStart=$python_bin $ENGINE_ROOT/bin/grim-ner-server.py
Restart=on-failure
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=grimoire-ner

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable grimoire-ner
  systemctl restart grimoire-ner
  echo ""
  systemctl status grimoire-ner --no-pager -l
  ok "grimoire-ner service installed"
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo -e "\n░ Grimoire NER setup\n"
  check_pyenv
  ensure_python
  ensure_virtualenv
  install_deps
  prefetch_models
  install_service
  echo ""
  echo "░ NER service ready."
  echo "  Start manually : cd $ENGINE_ROOT && pyenv exec python bin/grim-ner-server.py"
  echo "  Health check   : curl http://aid:3773/health"
  echo "  Test NER       : curl -s http://aid:3773/ner -H 'Content-Type: application/json' \\"
  echo "                        -d '{\"text\": \"Jane works on Project Grimoire\"}' | jq ."
  echo ""
}

main "$@"
