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
#   4. Seeds lbl-config bootstrap + fleet host resolution via grim
#   5. Configures local DNS (systemd-resolved 99-lbl.conf)
#   6. Activates git hooks (.githooks/pre-commit)
#   7. Configures Claude Code: MCP server + plugin
#   7b. Configures Qwen Code: installs CLI, links into ~/bin, grimoire skills + MCP
#   8. Claude Code status line (grim dungeon HUD)
#   9. Symlinks grim CLI into ~/bin (no sudo, no global install)
#  10. Creates ~/.grimoire dotlink
#  11. Installs grim-boot-report userspace systemd service
#  12. Registers hardware inventory in the KB (re-run anytime after upgrades)
#  13. Ensures pinned Node.js at ~/.grimoire/bin/node
#  14. Installs & (re)starts the grim-rig-serve userspace telemetry service
#  15. Smoke-tests the connection

set -euo pipefail

# Source nvm if available (makes corepack, pinned node, etc. accessible in PATH)
if [[ -d "$HOME/.nvm" ]]; then
  export NVM_DIR="$HOME/.nvm"
  if [[ -f "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh" 2>/dev/null || true
  fi
fi

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

# ── 4.5. Local DNS — systemd-resolved config for home.lan ─────────────────────
# Writes deploy/99-lbl.conf to /etc/systemd/resolved.conf.d/ so internal
# hostnames (aid, superack, etc.) resolve via the homelab DNS stub on aid:5335.
# Graceful if sudo is unavailable (warn, don't fail).

_configure_dns() {
  step "Configuring local DNS (systemd-resolved)..."

  local conf_src="$ENGINE_ROOT/deploy/99-lbl.conf"
  local conf_dst="/etc/systemd/resolved.conf.d/99-lbl.conf"

  if [[ ! -f "$conf_src" ]]; then
    warn "deploy/99-lbl.conf not found — skipping DNS configuration"
    return
  fi

  # Skip if already identical
  if [[ -f "$conf_dst" ]] && diff -q "$conf_src" "$conf_dst" &>/dev/null; then
    ok "99-lbl.conf already in place"
    return
  fi

  if [[ "$EUID" -eq 0 ]]; then
    sudo mkdir -p /etc/systemd/resolved.conf.d
    sudo cp "$conf_src" "$conf_dst"
    sudo systemctl restart systemd-resolved
    ok "99-lbl.conf installed (via sudo, root)"
  elif sudo -n true 2>/dev/null; then
    sudo mkdir -p /etc/systemd/resolved.conf.d
    sudo cp "$conf_src" "$conf_dst"
    sudo systemctl restart systemd-resolved
    ok "99-lbl.conf installed (via sudo)"
  else
    warn "no sudo available — skipping DNS configuration"
    warn "  Once sudo is available: sudo cp deploy/99-lbl.conf /etc/systemd/resolved.conf.d/ && sudo systemctl restart systemd-resolved"
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

# ── 6b. Qwen Code — sovereign local model CLI ───────────────────────────────
#
# Automated patches applied to qwen-code's node_modules and source (idempotent):
#   1. @shikijs/themes — add 11 missing theme exports + copy dist files from
#      the nested shiki-files copy (v4.x has themes the v1.x dropped)
#   2. @types/express-serve-static-core — fix ParamsDictionary[string] from
#      "string | string[]" to "string" (Express 5 types over-broad)
#   3. web-templates/build.mjs — raise MAX_DOCUMENT_RUNTIME_BYTES budget
#   4. web-shell/vite.config.ts — rollup externals for shiki-files + @pierre/theming

_patch_qwen_code() {
  local qwen_target="$1"
  local node_modules="$qwen_target/node_modules"

  # ── 1. Patch @shikijs/themes — missing theme exports ──────────────────────
  local themes_pkg="$node_modules/@shikijs/themes/package.json"
  local themes_dist="$node_modules/@shikijs/themes/dist"
  local nested_themes="$node_modules/shiki-files/node_modules/@shikijs/themes"

  if [[ -f "$themes_pkg" && -d "$nested_themes" ]]; then
    local missing_json
    missing_json=$(node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$themes_pkg', 'utf8'));
      const nested = JSON.parse(fs.readFileSync('$nested_themes/package.json', 'utf8'));
      const need = ['ayu-light','ayu-mirage','gruvbox-dark-hard','gruvbox-dark-medium',
        'gruvbox-dark-soft','gruvbox-light-hard','gruvbox-light-medium','gruvbox-light-soft',
        'horizon','horizon-bright','night-owl-light'];
      let added = 0;
      need.forEach(t => {
        const k = './'+t;
        if (!pkg.exports[k]) {
          pkg.exports[k] = './dist/'+t+'.mjs';
          added++;
        }
      });
      if (added > 0) {
        fs.writeFileSync('$themes_pkg', JSON.stringify(pkg, null,2) + '\n');
        process.stdout.write(String(added));
      } else {
        process.stdout.write('0');
      }
    " 2>/dev/null || echo "error")

    if [[ "$missing_json" =~ ^[0-9]+$ && "$missing_json" -gt 0 ]]; then
      ok "patched @shikijs/themes: added $missing_json theme exports"
    fi

    # Copy missing dist .mjs files from nested copy
    if [[ -d "$themes_dist" ]]; then
      for t in ayu-light ayu-mirage gruvbox-dark-hard gruvbox-dark-medium gruvbox-dark-soft \
               gruvbox-light-hard gruvbox-light-medium gruvbox-light-soft horizon horizon-bright \
               night-owl-light; do
        if [[ ! -f "$themes_dist/${t}.mjs" && -f "$nested_themes/dist/${t}.mjs" ]]; then
          cp "$nested_themes/dist/${t}.mjs" "$themes_dist/${t}.mjs"
        fi
      done
      ok "pulled missing @shikijs/themes dist files from nested copy"
    fi
  fi

  # ── 2. Patch @types/express-serve-static-core — ParamsDictionary fix ─────
  local express_types="$node_modules/@types/express-serve-static-core/index.d.ts"
  if [[ -f "$express_types" ]]; then
    if grep -q '\[key: string\]: string | string\[\];' "$express_types"; then
      # macOS sed -i needs a backup suffix; Linux sed -i doesn't
      local sed_i=()
      if sed --version 2>/dev/null | grep -q 'GNU'; then
        sed_i=(-i)
      else
        sed_i=(-i '')
      fi
      sed "${sed_i[@]}" 's|\[key: string\]: string | string\[\];|[key: string]: string;|' "$express_types"
      ok "patched @types/express-serve-static-core: ParamsDictionary[string] → string"
    fi
  fi

  # ── 3. Patch web-templates — raise renderer budget ───────────────────────
  local build_mjs="$qwen_target/packages/web-templates/src/export-html/build.mjs"
  if [[ -f "$build_mjs" ]]; then
    local current_budget=2_151_577
    local new_budget=2_230_000
    if grep -q "$current_budget" "$build_mjs"; then
      local sed_i=()
      if sed --version 2>/dev/null | grep -q 'GNU'; then
        sed_i=(-i)
      else
        sed_i=(-i '')
      fi
      sed "${sed_i[@]}" "s/${current_budget}/${new_budget}/" "$build_mjs"
      ok "patched web-templates: raised renderer budget $current_budget → $new_budget"
    fi
  fi

  # ── 4. Patch web-shell vite.config.ts — rollup externals ──────────────────
  local vite_cfg="$qwen_target/packages/web-shell/vite.config.ts"
  if [[ -f "$vite_cfg" ]]; then
    node -e "
      const fs = require('fs');
      let src = fs.readFileSync('$vite_cfg', 'utf8');
      if (src.includes('external:')) {
        process.stdout.write('already patched\n');
        process.exit(0);
      }
      const needle = '      output: {';
      const ins =
        '      // Prevent bundling shiki-files/@pierre/theming — their bundled\n' +
        '      // @shikijs/themes has themes not exported by workspace-level v1.x.\n' +
        '      external: [\n' +
        \"        'shiki-files',\n\" +
        \"        'shiki-files/core',\n\" +
        \"        'shiki-files/engine/javascript',\n\" +
        \"        'shiki-files/engine/oniguruma',\n\" +
        \"        '@pierre/theming',\n\" +
        '      ],\n' +
        '      output: {';
      if (src.includes(needle)) {
        src = src.replace(needle, ins);
        fs.writeFileSync('$vite_cfg', src);
        process.stdout.write('patched\n');
      } else {
        process.stdout.write('pattern not found, skipping\n');
      }
    " 2>/dev/null && ok "patched web-shell vite.config.ts: added rollup externals"
  fi
}

_configure_qwen_code() {
  step "Configuring Qwen Code..."

  local qwen_cli="$ENGINE_ROOT/bin/qwen"
  local qwen_cli_dist
  qwen_cli_dist=$(node -e "
    const path = require('path');
    // Resolve from the qwen wrapper: bin/qwen → bin (dirname) → parent
    const wrapper = '$qwen_cli';
    let dir = path.dirname(wrapper);
    for (let i = 0; i < 4; i++) {
      const p = path.join(dir, 'dist', 'cli.js');
      if (require('fs').existsSync(p)) { process.stdout.write(p); process.exit(0); }
      dir = path.join(dir, '..');
    }
    process.stdout.write('');
  " 2>/dev/null || true)

  if [[ -z "$qwen_cli" || ! -f "$qwen_cli" ]]; then
    warn "bin/qwen not found — skipping Qwen Code setup"
    return
  fi

  # ── Ensure qwen-code is cloned and up-to-date ─────────────────────────────
  # Canonical location: ~/src/3rd/qwen-code. Pull for updates if present,
  # clone + build if missing.
  local qwen_target="$HOME/src/3rd/qwen-code"
  local qwen_repo="${QWEN_CLI_REPO:-git@github.com:QwenLM/qwen-code.git}"
  local pinned_node="$HOME/.grimoire/bin/node"
  local qwen_node_marker="$qwen_target/.qwen-node-version"
  local current_node_ver
  current_node_ver=$("$pinned_node" --version 2>/dev/null || echo "unknown")

  # Record whether we already have a valid dist built with the current Node.
  local dist_built=false
  if [[ -f "$qwen_target/dist/cli.js" ]]; then
    local marker_ver
    marker_ver=$(cat "$qwen_node_marker" 2>/dev/null || echo "none")
    if [[ "$marker_ver" == "$current_node_ver" ]]; then
      dist_built=true
    else
      warn "qwen-code dist built with Node $marker_ver — current is $current_node_ver → rebuild"
    fi
  fi

  _pull_qwen() {
    git -C "$qwen_target" pull --ff-only 2>/dev/null || true
  }
  _pull_qwen_stash() {
    # Stash uncommitted changes, pull, restore — handles worktrees with
    # local modifications where `git pull` alone would fail.
    if ! git -C "$qwen_target" diff --quiet 2>/dev/null || \
       ! git -C "$qwen_target" diff --cached --quiet 2>/dev/null; then
      git -C "$qwen_target" stash push -q -m "auto-$(date +%s)" 2>/dev/null || true
      _pull_qwen
      git -C "$qwen_target" stash pop -q 2>/dev/null || true
    else
      _pull_qwen
    fi
  }

  if [[ "$dist_built" == "true" ]]; then
    step "Updating qwen-code (build up-to-date)..."
    _pull_qwen_stash
    qwen_cli_dist="$qwen_target/dist/cli.js"
    ok "qwen-code up-to-date at $qwen_cli_dist (Node $current_node_ver)"
  elif [[ -d "$qwen_target/.git" ]]; then
    step "Updating qwen-code (incomplete clone detected)..."
    _pull_qwen_stash || fail "git pull failed — check the repo at $qwen_target manually"
  else
    step "Cloning qwen-code..."
    mkdir -p "$(dirname "$qwen_target")"
    git clone "$qwen_repo" "$qwen_target" 2>/dev/null \
      || fail "git clone failed — check SSH key / network"
    cd "$qwen_target"
  fi

  # ── Patch qwen-code for our environment (idempotent) ─────────────────────
  _patch_qwen_code "$qwen_target"

  # ── Build if needed (always use pinned node) ─────────────────────────────
  if [[ ! -f "$qwen_target/dist/cli.js" ]]; then
    step "Building qwen-code with $current_node_ver..."

    # Ensure pinned node is in PATH for the build
    export PATH="$(dirname "$pinned_node"):$(dirname "$pinned_node")/bin:$PATH"

    # Ensure corepack/pnpm available under the pinned node
    if command -v corepack &>/dev/null; then
      corepack enable 2>/dev/null || corepack prepare pnpm --activate 2>/dev/null || true
    fi
    if ! "$pinned_node" -e "require('pnpm')" 2>/dev/null && ! command -v pnpm &>/dev/null; then
      "$pinned_node" -g pnpm 2>/dev/null \
        || npm install -g pnpm 2>/dev/null || true
    fi

    # Patch build.js to use system pnpm if corepack isn't available
    # (qwen-code's build calls 'corepack pnpm' which may not be in PATH
    #  even when pnpm is installed globally)
    local build_js="$qwen_target/scripts/build.js"
    if [[ -f "$build_js" ]] && grep -q 'corepack pnpm' "$build_js" && ! command -v corepack &>/dev/null && command -v pnpm &>/dev/null; then
      # macOS sed -i needs a backup suffix; Linux sed -i doesn't
      local sed_i=()
      if sed --version 2>/dev/null | grep -q 'GNU'; then
        sed_i=(-i)
      else
        sed_i=(-i '')
      fi
      sed "${sed_i[@]}" 's|corepack pnpm|pnpm|g' "$build_js"
      ok "patched build.js: corepack pnpm → pnpm"
    fi

    # Install deps — use pinned node's npm
    # NODE env var ensures 'npm run' spawns child processes (like scripts/build.js)
    # with the pinned node, not the system node.
    export NODE="$pinned_node"
    if command -v pnpm &>/dev/null; then
      pnpm install --frozen-lockfile \
        || npm install --legacy-peer-deps \
        || fail "pnpm + npm install both failed — check dependencies"
    else
      npm install --legacy-peer-deps \
        || fail "npm install failed — check node/npm version"
    fi
    "$pinned_node" "$(dirname "$pinned_node")/../lib/node_modules/npm/bin/npm-cli.js" run build \
      || fail "qwen-code build failed — check $qwen_target/dist/"
    if [[ -f "$qwen_target/dist/cli.js" ]]; then
      # Record which Node version this build was done with
      echo "$current_node_ver" > "$qwen_node_marker"
      ok "qwen-code built (Node $current_node_ver)"
    else
      fail "qwen-code build produced no dist/cli.js"
    fi
  else
    qwen_cli_dist="$qwen_target/dist/cli.js"
    ok "qwen-code build up-to-date at $qwen_cli_dist"
  fi

  # Symlink qwen CLI into ~/bin (mirrors grim link)
  local bin_dir="$HOME/bin"
  local link="$bin_dir/qwen"
  mkdir -p "$bin_dir"

  if [[ -L "$link" && "$(readlink "$link")" == "$(readlink "$qwen_cli" 2>/dev/null || echo "$qwen_cli")" ]]; then
    ok "~/bin/qwen already linked"
  else
    if [[ -L "$link" || -e "$link" ]]; then
      warn "~/bin/qwen already exists ($(readlink "$link" 2>/dev/null || echo 'not a symlink'))"
      local confirm
      read -r -p "  Overwrite it? [y/N] " confirm
      [[ "${confirm,,}" == "y" ]] || { warn "skipped — leaving existing ~/bin/qwen in place"; return; }
      rm "$link"
    fi
    ln -s "$qwen_cli" "$link" 2>/dev/null || ln -sf "$(readlink -f "$qwen_cli" 2>/dev/null || echo "$qwen_cli")" "$link"
    ok "linked: ~/bin/qwen → $(readlink "$link")"
  fi

  # Symlink grimoire skills into ~/.qwen/skills/
  local skills_src="$ENGINE_ROOT/plugin/skills"
  local skills_dst="$HOME/.qwen/skills"

  if [[ ! -d "$skills_src" ]]; then
    warn "grimoire skills not found at $skills_src — skipping skill symlink"
    return
  fi

  mkdir -p "$skills_dst"

  # Symlink each skill (idempotent — skip if already pointing to the right place)
  local linked=0 skipped=0
  for skill in "$skills_src"/*; do
    [[ -d "$skill" ]] || continue
    local name
    name=$(basename "$skill")
    local dest="$skills_dst/$name"

    if [[ -L "$dest" && "$(readlink "$dest")" == "$skill" ]]; then
      continue  # already correct
    elif [[ -L "$dest" || -e "$dest" ]]; then
      warn "  skill $name: $dest already exists — skipping"
      skipped=$((skipped + 1))
      continue
    fi
    ln -s "$skill" "$dest" 2>/dev/null \
      && linked=$((linked + 1)) \
      || { warn "  skill $name: failed to link"; skipped=$((skipped + 1)); }
  done

  ok "grimoire skills linked: $linked new, $skipped skipped → $skills_dst"

  # Ensure QWEN_CLI_DIR is in the shell profile (already set by _ensure_qwen_cli,
  # but verify if qwen-code was pre-installed and not through our install path)
  if [[ -n "$qwen_cli_dist" ]]; then
    local qwen_dir
    qwen_dir=$(cd "$qwen_cli_dist/.." 2>/dev/null && pwd)
    local profile="$HOME/.bashrc"
    if ! grep -q 'QWEN_CLI_DIR' "$profile" 2>/dev/null; then
      cat >> "$profile" <<EOF

# Qwen Code — path to the qwen-code repo (used by bin/qwen wrapper)
export QWEN_CLI_DIR="$qwen_dir"
EOF
      ok "wrote QWEN_CLI_DIR=$qwen_dir to $profile"
    fi
  fi
}

# ── 6c. Claude Code status line (grim dungeon HUD) ───────────────────────────

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
#
# Min version: 22 (required by qwen-code's pnpm 11).
# Preferred: latest LTS in the min major. We try the last-known LTS first,
# then ask nvm for the latest patch in that major, then fall back to install.
# The actual version gets recorded so downstream callers (qwen build) know
# what they're running on.

_ensure_node_pin() {
  step "Ensuring pinned Node.js at ~/.grimoire/bin/node..."

  local pin_dir="$HOME/.grimoire/bin"
  local pin="$pin_dir/node"
  local MIN_NODE_MAJOR=22

  # Last-known LTS patch (updated when we verify a new one).
  # Update this when the LTS pipeline releases a new patch, or when the major
  # changes (increase MIN_NODE_MAJOR and reset LAST_KNOWN_LTS to the new LTS).
  local LAST_KNOWN_LTS="22.23.5"

  # Try last-known first, then ask nvm for latest patch in this major.
  local preferred="$LAST_KNOWN_LTS"
  local nvm_latest
  nvm_latest=$(nvm ls-remote --lts 2>/dev/null | grep "v${MIN_NODE_MAJOR}\." | grep "Latest LTS" | head -1 | grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' || true)
  if [[ -n "$nvm_latest" ]]; then
    preferred="${nvm_latest#v}"
  fi

  # Try each candidate until one is installed.
  local target_node=""
  for ver in "$preferred" "$LAST_KNOWN_LTS"; do
    local candidate="$HOME/.nvm/versions/node/v${ver}/bin/node"
    if [[ -x "$candidate" ]]; then
      target_node="$candidate"
      break
    fi
  done

  # Install if nothing found.
  if [[ -z "$target_node" ]]; then
    step "Installing Node.js v${preferred} (LTS)..."
    if command -v nvm &>/dev/null; then
      nvm install "$preferred" 2>/dev/null || true
    else
      local nvm_sh
      nvm_sh=$(find "$HOME/.nvm" -name "nvm.sh" 2>/dev/null | head -1)
      if [[ -n "$nvm_sh" ]]; then
        # shellcheck source=/dev/null
        source "$nvm_sh"
        nvm install "$preferred" 2>/dev/null || true
      fi
    fi
    target_node="$HOME/.nvm/versions/node/v${preferred}/bin/node"
    if [[ ! -x "$target_node" ]]; then
      fail "Could not install Node.js v${preferred} — install via nvm manually, then re-run setup-client.sh"
    fi
    ok "installed Node.js v${preferred}"
  fi

  local node_ver
  node_ver=$("$target_node" --version 2>/dev/null || echo "unknown")
  local node_major="${node_ver:1:2}"  # strip 'v', take major

  # Enforce minimum major version.
  if [[ "$node_major" -lt "$MIN_NODE_MAJOR" ]]; then
    fail "Pinned Node $node_ver is below minimum v${MIN_NODE_MAJOR}.0 — update _ensure_node_pin's MIN_NODE_MAJOR or install a newer LTS"
  fi

  if [[ -L "$pin" && "$(readlink "$pin")" == "$target_node" ]]; then
    ok "pinned node already at ~/.grimoire/bin/node → $node_ver"
  else
    mkdir -p "$pin_dir"
    ln -sf "$target_node" "$pin"
    ok "pinned: ~/.grimoire/bin/node → $node_ver"
  fi
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
  _configure_dns
  _activate_git_hooks
  _configure_claude_code
  # Node pin must come before qwen-code: qwen-code requires Node 22+ (pnpm 11),
  # and its build artifacts are Node-version-locked. Pin first, then build.
  _ensure_node_pin
  _configure_qwen_code
  _install_statusline
  _install_grim_link
  _create_dotlink
  _install_boot_report_service
  _register_host
  _install_rig_serve_service
  _install_dashboard_service
  _smoke_test

  echo ""
  echo "░ Setup complete."
  echo "  Claude Code: restart to activate MCP, then /load"
  echo "  Qwen Code:   qwen --bare -p 'run /load' -y"
  echo ""
}

_main "$@"
