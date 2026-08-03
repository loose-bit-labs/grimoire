#!/usr/bin/env bash
# deploy/grim-register-host.sh — hardware + OS inventory → Grimoire KB
#
# Collects: CPU, RAM, GPU/VRAM, motherboard, storage/mounts, OS, network IPs.
# Upserts a DefinedTerm entity at @id: host_<hostname> — always deletes then
# recreates so hardware/network/os fields are always current. Safe to re-run.
#
# Usage:
#   ./deploy/grim-register-host.sh
#   GRIMOIRE_HOST=http://aid:3663 ./deploy/grim-register-host.sh
#
# Network IPs are stored so the KB can later derive /etc/hosts.
# Services and lbl-config routing are kept separate (manual or sync-config).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"
# Tight report formatting (CPU/Memory/GPU/... back to back) — override lib.sh's
# blank-line-prefixed step() for this script only.
step() { echo -e "░ $*"; }

# Resolve GRIMOIRE_HOST: env var → lbl-config.json endpoints.grimoire → fallback
GRIMOIRE_HOST="${GRIMOIRE_HOST:-$(_grimoire_host)}"
export HOSTNAME_S="$(hostname -s)"
export TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export PLATFORM="$(uname -s)"   # Linux | Darwin

# ── Platform ──────────────────────────────────────────────────────────────────

PLATFORM_FILE="$SCRIPT_DIR/platform.d/$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]').sh"
if [[ ! -f "$PLATFORM_FILE" ]]; then
  echo "Unsupported platform: $PLATFORM (no platform.d/$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]').sh)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$PLATFORM_FILE"

# ── Build payload ─────────────────────────────────────────────────────────────

_build_description() {
  node -e "
    const e = process.env;
    const gpus = JSON.parse(e.GPU_JSON || '[]');
    process.stdout.write([
      'CPU: ' + e.CPU_MODEL + ' (' + e.CPU_CORES + 'c/' + e.CPU_THREADS + 't)',
      'RAM: ' + e.MEM_TOTAL_GB + 'GB',
      gpus.length ? 'GPU: ' + gpus.map(g => g.name + (g.vram_mb ? ' ' + Math.round(g.vram_mb/1024) + 'GB' : '')).join(', ') : null,
      (e.MOBO_VENDOR && e.MOBO_NAME) ? 'MB: ' + e.MOBO_VENDOR + ' ' + e.MOBO_NAME : null,
      'OS: ' + e.OS_PRETTY,
    ].filter(Boolean).join(' · '));
  "
}

_build_remember_payload() {
  local desc="$1"
  DESC="$desc" node -e "
    const e = process.env;
    const gpus   = JSON.parse(e.GPU_JSON    || '[]');
    const disks  = JSON.parse(e.DISKS_JSON  || '[]');
    const mounts = JSON.parse(e.MOUNTS_JSON || '[]');
    const addrs  = JSON.parse(e.IPS_JSON    || '[]');
    const vram_total_gb = +(gpus.reduce((s,g)=>s+(g.vram_mb||0),0)/1024).toFixed(1) || null;
    const entity = {
      type: 'DefinedTerm',
      '@id': 'host_' + e.HOSTNAME_S,
      name: e.HOSTNAME_S,
      description: e.DESC,
      hardware: {
        cpu: { model: e.CPU_MODEL, sockets: +e.CPU_SOCKETS, cores: +e.CPU_CORES, threads: +e.CPU_THREADS, mhz: +e.CPU_MHZ||null },
        memory: { total_gb: +e.MEM_TOTAL_GB },
        gpu: gpus,
        vram_total_gb,
        motherboard: { vendor: e.MOBO_VENDOR||null, model: e.MOBO_NAME||null, product: e.MOBO_PRODUCT||null },
        storage: { disks, mounts },
      },
      os:      { name: e.OS_PRETTY, version: e.OS_VERSION||null, kernel: e.OS_KERNEL, arch: e.OS_ARCH },
      network: { addresses: addrs },
      tags: ['host/' + e.HOSTNAME_S, 'hardware/inventory'],
      metadata: { dateModified: e.TS, source: 'grim-register-host' },
    };
    process.stdout.write(JSON.stringify(entity));
  "
}

# ── POST helper ───────────────────────────────────────────────────────────────

_post() {
  local endpoint="$1" payload="$2"
  # No -f: we need the HTTP code on 4xx/5xx too; || 000 only fires on connection failure
  curl -s --max-time 15 -o /dev/null -w '%{http_code}' \
    -X POST "${GRIMOIRE_HOST}${endpoint}" \
    -H 'Content-Type: application/json' \
    -d "$payload" 2>/dev/null || echo "000"
}

# ── Register ──────────────────────────────────────────────────────────────────
# Always delete-then-create so all fields (hardware/network/os) are current.

_register() {
  local desc body resp

  desc="$(_build_description)"

  # Delete existing entity if present (not_found is fine — idempotent)
  _post '/api/tome/forget' "{\"id\":\"host_${HOSTNAME_S}\"}" > /dev/null

  # Create fresh with full payload
  body="$(_build_remember_payload "$desc")"
  resp="$(curl -s --max-time 15 \
    -X POST "${GRIMOIRE_HOST}/api/tome/remember" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>/dev/null)"

  local ok_flag
  ok_flag="$(echo "$resp" | node -e "let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{ try{process.stdout.write(JSON.parse(d).ok?'ok':'fail');}catch{process.stdout.write('fail');} })")"

  if [[ "$ok_flag" == "ok" ]]; then
    ok "Registered  host_${HOSTNAME_S} in KB"
    return
  fi

  warn "KB registration failed — response: $resp"
  warn "Is grim serve running?  GRIMOIRE_HOST=${GRIMOIRE_HOST}"
  return 1
}

# ── Main ──────────────────────────────────────────────────────────────────────

_main() {
  echo ""
  echo "  GRIM REGISTER HOST — ${HOSTNAME_S}  $(date '+%Y-%m-%d %H:%M')"
  echo ""

  step "CPU"
  _gather_cpu
  ok "${CPU_MODEL} · ${CPU_CORES}c/${CPU_THREADS}t · ${CPU_MHZ}MHz"

  step "Memory"
  _gather_mem
  ok "${MEM_TOTAL_GB}GB"

  step "GPU"
  _gather_gpu
  local gpu_summary
  gpu_summary="$(node -e "
    const gpus = JSON.parse(process.env.GPU_JSON || '[]');
    if (!gpus.length) { process.stdout.write('none detected'); process.exit(); }
    process.stdout.write(gpus.map(g => g.name + (g.vram_mb ? ' ' + Math.round(g.vram_mb/1024) + 'GB VRAM' : '')).join(', '));
  " 2>/dev/null || echo 'none')"
  [[ "$gpu_summary" == "none detected" ]] && warn "$gpu_summary" || ok "$gpu_summary"

  step "Motherboard"
  _gather_mobo
  [[ -n "$MOBO_VENDOR" ]] && ok "${MOBO_VENDOR} ${MOBO_NAME}" || warn "DMI unavailable"

  step "Storage"
  _gather_storage
  local ndisks nmounts
  ndisks="$(node -e "process.stdout.write(String(JSON.parse(process.env.DISKS_JSON||'[]').length))")"
  nmounts="$(node -e "process.stdout.write(String(JSON.parse(process.env.MOUNTS_JSON||'[]').length))")"
  ok "${ndisks} disk(s) · ${nmounts} mount(s)"

  step "OS"
  _gather_os
  ok "${OS_PRETTY} · kernel ${OS_KERNEL} · ${OS_ARCH}"

  step "Network"
  _gather_network
  local ip_summary
  ip_summary="$(node -e "
    const a = JSON.parse(process.env.IPS_JSON || '[]');
    process.stdout.write(a.map(x => x.iface + ':' + x.ip).join('  ') || 'none');
  " 2>/dev/null || echo 'none')"
  ok "$ip_summary"

  echo ""
  step "Registering in KB (${GRIMOIRE_HOST})..."
  _register
  echo ""
}

_main "$@"
