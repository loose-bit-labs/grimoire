#!/usr/bin/env bash
# generate-scrape.sh — Read rig.json and emit deploy/telemetry/prometheus.json.
#
# Usage:
#   deploy/telemetry/generate-scrape.sh [rig.json]
#
# Reads $GRIMOIRE_ROOT/rig.json (or first arg) and writes
# deploy/telemetry/prometheus.json with a full Prometheus config
# (global settings + scrape_config derived from rig.json).
#
# Deterministic: deleting the output and re-running produces byte-identical results.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELEMETRY_DIR="$SCRIPT_DIR"

RIG_JSON="${1:-${GRIMOIRE_ROOT:-$HOME/data/grimoire-kb}/rig.json}"

if [ ! -f "$RIG_JSON" ]; then
  echo "ERROR: rig.json not found at $RIG_JSON" >&2
  exit 1
fi

RIG_JSON="$RIG_JSON" node -e "
const fs = require('fs');
const rig = JSON.parse(fs.readFileSync(process.env.RIG_JSON, 'utf8'));

const staticConfigs = [];
const seen = new Set();
for (const box of rig) {
  if (box.skip) continue;
  const label = box.label || box.host;
  const addr = box.host + ':8001';
  if (seen.has(addr)) continue;
  seen.add(addr);
  staticConfigs.push({
    targets: [addr],
    labels: { box: label }
  });
}

const config = {
  global: {
    scrape_interval: '15s',
    evaluation_interval: '15s'
  },
  scrape_configs: [{
    job_name: 'grim-rig',
    static_configs: staticConfigs
  }]
};
process.stdout.write(JSON.stringify(config, null, 2) + '\n');
" > "$TELEMETRY_DIR/prometheus.json"

echo "Wrote $TELEMETRY_DIR/prometheus.json"
