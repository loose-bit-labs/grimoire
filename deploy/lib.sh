#!/usr/bin/env bash
# deploy/lib.sh — shared helpers for deploy/ scripts. Source, don't execute:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/lib.sh"
#
# Provides:
#   ok/warn/fail/step   — coloured status output
#   _grimoire_host       — resolve the Grimoire server URL: env var →
#                          lbl-config.json endpoints.grimoire → aid:3663

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✘${NC}  $*"; exit 1; }
step() { echo -e "\n░ $*"; }

_grimoire_host() {
  node -e "
    const fs=require('fs'),os=require('os'),p=require('path');
    try {
      const c=JSON.parse(fs.readFileSync(p.join(os.homedir(),'.config','lbl-config.json'),'utf8'));
      process.stdout.write(c.endpoints?.grimoire||'http://aid:3663');
    } catch { process.stdout.write('http://aid:3663'); }
  " 2>/dev/null || echo 'http://aid:3663'
}
