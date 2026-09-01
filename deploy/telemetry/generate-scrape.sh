#!/usr/bin/env bash
# generate-scrape.sh — Emit deploy/telemetry/prometheus.json from the derived fleet roster.
#
# Usage:
#   deploy/telemetry/generate-scrape.sh [rig.json]
#
# Reads the fleet roster — KB registry (entities under <kb>/entities, tag
# hardware/inventory) + the rig.json service-check overlay — via lib/fleet.js,
# and writes deploy/telemetry/prometheus.json with a full Prometheus config
# (global settings + scrape_config, one target per non-skipped box).
# The rig.json arg is the overlay (its directory is the KB root).
#
# Deterministic: deleting the output and re-running produces byte-identical results.
#
# Never blanks the live config: node writes a temp file first; the live path is
# rewritten in place (same inode) only after the node step succeeds. In place —
# not a rename — because the grim-prometheus container file-mounts this path and
# pins the original inode: a rename would be invisible to the running container
# (see plans/phase-86.md, "Regen must not blank the live config").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELEMETRY_DIR="$SCRIPT_DIR"
LIVE_OUT="$TELEMETRY_DIR/prometheus.json"

RIG_JSON="${1:-${GRIMOIRE_ROOT:-$HOME/data/grimoire-kb}/rig.json}"
# Overridable so the script can be exercised from a sandbox copy.
# (Default resolves to <repo>/lib/fleet.js — two levels up from this dir.)
FLEET_JS="${FLEET_JS:-${SCRIPT_DIR}/../../lib/fleet.js}"

TMP_OUT="$(mktemp "$LIVE_OUT.XXXXXX")"
trap 'rm -f "$TMP_OUT"' EXIT
RIG_JSON="$RIG_JSON" FLEET_JS="$FLEET_JS" node -e "
const fs = require('fs');
const path = require('path');
const { loadFleetLocal } = require(process.env.FLEET_JS);

const rigPath = process.env.RIG_JSON;
const kbRoot = path.dirname(rigPath);
const hasOverlay = fs.existsSync(rigPath);
const fleet = loadFleetLocal(kbRoot, hasOverlay ? rigPath : null);
const boxes = fleet.filter(b => !b.skip);
if (boxes.length === 0) {
  const why = hasOverlay ? 'overlay ' + rigPath + ' has no usable entries'
                         : 'rig.json not found at ' + rigPath;
  console.error('ERROR: fleet roster is empty — ' + why +
    ' and no registered hosts under ' + kbRoot + '/entities (tag: hardware/inventory)');
  process.exit(1);
}

const staticConfigs = [];
const seen = new Set();
for (const box of boxes) {
  const label = box.label || box.host;
  const addr = box.host + ':18081';
  if (seen.has(addr)) continue;
  seen.add(addr);
  staticConfigs.push({
    targets: [addr],
    labels: { box: label }
  });
}

const config = {
  global: {
    // grim-rig-serve's own internal poll interval defaults to 5s (see
    // bin/grim-rig.js serve()'s --interval default) — scraping any slower
    // than that just discards real updates; any faster doesn't help since
    // the source isn't refreshing that often.
    scrape_interval: '5s',
    evaluation_interval: '5s'
  },
  scrape_configs: [{
    job_name: 'grim-rig',
    static_configs: staticConfigs
  }]
};
process.stdout.write(JSON.stringify(config, null, 2) + '\n');
" > "$TMP_OUT"
# Only after the node step succeeded: rewrite the live file in place (same inode —
# see the header note on why a rename would be invisible to the mounted container).
cat "$TMP_OUT" > "$LIVE_OUT"
echo "Wrote $LIVE_OUT"
