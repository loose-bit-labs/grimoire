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

GRIMOIRE_HOST="${GRIMOIRE_HOST:-http://aid:3663}"
export HOSTNAME_S="$(hostname -s)"
export TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export PLATFORM="$(uname -s)"   # Linux | Darwin

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
step() { echo -e "░ $*"; }

# ── CPU ───────────────────────────────────────────────────────────────────────

_gather_cpu() {
  if [[ "$PLATFORM" == "Darwin" ]]; then
    CPU_MODEL="$(sysctl -n machdep.cpu.brand_string 2>/dev/null | xargs || echo 'unknown')"
    CPU_THREADS="$(sysctl -n hw.logicalcpu 2>/dev/null || echo 0)"
    CPU_CORES="$(sysctl -n hw.physicalcpu 2>/dev/null || echo "$CPU_THREADS")"
    CPU_SOCKETS=1
    local hz
    hz="$(sysctl -n hw.cpufrequency_max 2>/dev/null || echo 0)"
    CPU_MHZ=$(( ${hz:-0} / 1000000 ))
  else
    CPU_MODEL="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | xargs || echo 'unknown')"
    CPU_THREADS="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 0)"
    local raw_cores
    raw_cores="$(grep 'cpu cores' /proc/cpuinfo 2>/dev/null | head -1 | awk -F: '{print $2}' | xargs || echo '')"
    CPU_CORES="${raw_cores:-$CPU_THREADS}"
    CPU_SOCKETS="$(grep 'physical id' /proc/cpuinfo 2>/dev/null | sort -u | wc -l | xargs || echo 1)"
    [[ "${CPU_SOCKETS:-0}" -eq 0 ]] && CPU_SOCKETS=1
    CPU_MHZ="$(grep -m1 'cpu MHz' /proc/cpuinfo 2>/dev/null | awk -F: '{print $2}' | xargs | cut -d. -f1 || echo 0)"
  fi
  export CPU_MODEL CPU_THREADS CPU_CORES CPU_SOCKETS CPU_MHZ
}

# ── Memory ────────────────────────────────────────────────────────────────────

_gather_mem() {
  if [[ "$PLATFORM" == "Darwin" ]]; then
    local total_bytes
    total_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    MEM_TOTAL_GB=$(( ${total_bytes:-0} / 1024 / 1024 / 1024 ))
  else
    local total_kb
    total_kb="$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)"
    MEM_TOTAL_GB=$(( total_kb / 1024 / 1024 ))
  fi
  export MEM_TOTAL_GB
}

# ── GPU ───────────────────────────────────────────────────────────────────────

_gather_gpu() {
  local -a entries=()

  # macOS — system_profiler (handles both Apple Silicon and discrete GPUs)
  if [[ "$PLATFORM" == "Darwin" ]]; then
    while IFS= read -r gname; do
      entries+=("$(N="$gname" node -e "
        process.stdout.write(JSON.stringify({vendor:'apple',name:process.env.N,vram_mb:null,driver:null}))")")
    done < <(system_profiler SPDisplaysDataType 2>/dev/null | grep 'Chipset Model:' | sed 's/.*Chipset Model: //' || true)
    if [[ ${#entries[@]} -gt 0 ]]; then
      GPU_JSON="[$(IFS=,; echo "${entries[*]}")]"
    else
      GPU_JSON="[]"
    fi
    export GPU_JSON
    return
  fi

  # NVIDIA — nvidia-smi gives exact VRAM and driver version
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
    while IFS=',' read -r name vram driver; do
      entries+=("$(N="${name// /}" V="${vram// /}" D="${driver// /}" node -e "
        process.stdout.write(JSON.stringify({
          vendor:'nvidia',
          name: process.env.N.trim(),
          vram_mb: +process.env.V.trim() || 0,
          driver: process.env.D.trim() || null,
        }))")")
    done < <(nvidia-smi --query-gpu=name,memory.total,driver_version \
                --format=csv,noheader,nounits 2>/dev/null)
  fi

  # AMD — sysfs for VRAM, lspci for name
  # $card is /sys/class/drm/cardN/device — a symlink to the PCI device path
  for card in /sys/class/drm/card[0-9]*/device; do
    [[ -f "$card/vendor" ]] || continue
    local vendor
    vendor="$(tr -d '[:space:]' < "$card/vendor" 2>/dev/null || true)"
    [[ "$vendor" == "0x1002" ]] || continue   # AMD PCI vendor ID

    local vram_bytes=0 vram_mb=0 gpu_name="AMD GPU"
    [[ -f "$card/mem_info_vram_total" ]] && \
      vram_bytes="$(cat "$card/mem_info_vram_total" 2>/dev/null || echo 0)"
    vram_mb=$(( vram_bytes / 1024 / 1024 ))

    if command -v lspci &>/dev/null; then
      local dev_path pci_slot
      # readlink -f on $card (the device symlink) resolves to the PCI slot dir
      dev_path="$(readlink -f "$card" 2>/dev/null || true)"
      pci_slot="$(basename "$dev_path" 2>/dev/null | sed 's/^0000://' || true)"
      [[ -n "$pci_slot" ]] && \
        gpu_name="$(lspci -s "$pci_slot" 2>/dev/null | sed 's/.*: //' | xargs || echo 'AMD GPU')"
    fi

    entries+=("$(N="$gpu_name" V="$vram_mb" node -e "
      process.stdout.write(JSON.stringify({
        vendor:'amd',
        name: process.env.N,
        vram_mb: +process.env.V || 0,
        driver: 'amdgpu',
      }))")")
  done

  # Fallback: lspci only (no VRAM data)
  if [[ ${#entries[@]} -eq 0 ]] && command -v lspci &>/dev/null; then
    while IFS= read -r line; do
      local gname
      gname="$(echo "$line" | sed 's/^[0-9a-f:.]*  *[^:]*: //')"
      entries+=("$(N="$gname" node -e "
        process.stdout.write(JSON.stringify({
          vendor:'unknown', name:process.env.N, vram_mb:null, driver:null
        }))")")
    done < <(lspci 2>/dev/null | grep -iE 'VGA|3D controller|Display' || true)
  fi

  if [[ ${#entries[@]} -gt 0 ]]; then
    GPU_JSON="[$(IFS=,; echo "${entries[*]}")]"
  else
    GPU_JSON="[]"
  fi
  export GPU_JSON
}

# ── Motherboard ───────────────────────────────────────────────────────────────

_gather_mobo() {
  if [[ "$PLATFORM" == "Darwin" ]]; then
    local hw_info
    hw_info="$(system_profiler SPHardwareDataType 2>/dev/null || true)"
    MOBO_VENDOR="Apple"
    MOBO_NAME="$(echo "$hw_info" | grep 'Model Identifier:' | awk -F': ' '{print $2}' | xargs || echo '')"
    MOBO_PRODUCT="$(echo "$hw_info" | grep 'Model Name:' | awk -F': ' '{print $2}' | xargs || echo '')"
  elif [[ -r /sys/class/dmi/id/board_vendor ]]; then
    MOBO_VENDOR="$(cat /sys/class/dmi/id/board_vendor 2>/dev/null | xargs || echo '')"
    MOBO_NAME="$(cat /sys/class/dmi/id/board_name 2>/dev/null | xargs || echo '')"
    MOBO_PRODUCT="$(cat /sys/class/dmi/id/product_name 2>/dev/null | xargs || echo '')"
  elif command -v dmidecode &>/dev/null; then
    MOBO_VENDOR="$(dmidecode -s baseboard-manufacturer 2>/dev/null | xargs || echo '')"
    MOBO_NAME="$(dmidecode -s baseboard-product-name 2>/dev/null | xargs || echo '')"
    MOBO_PRODUCT=""
  else
    MOBO_VENDOR="" MOBO_NAME="" MOBO_PRODUCT=""
  fi
  export MOBO_VENDOR MOBO_NAME MOBO_PRODUCT
}

# ── Storage ───────────────────────────────────────────────────────────────────

_gather_storage() {
  if [[ "$PLATFORM" == "Darwin" ]]; then
    # No lsblk on macOS
    DISKS_JSON="[]"

    # df -Pk: POSIX 6-column format, 1K-blocks — works on macOS and Linux
    # Columns: Filesystem  1K-blocks  Used  Available  Capacity  Mounted
    MOUNTS_JSON="$(df -Pk 2>/dev/null | tail -n +2 | node -e "
      let d=''; process.stdin.on('data',x=>d+=x);
      process.stdin.on('end',()=>{
        const skipFs    = /^(devfs|map |driverkit|com\.apple\.os_storage)/i;
        const skipMount = /^\/(dev|private\/var\/folders|System\/Volumes\/(Preboot|Recovery|VM|Update))\b/;
        const seen = new Set();
        const out = d.trim().split('\n').filter(Boolean)
          .map(l => {
            const p = l.trim().split(/\s+/);
            if (p.length < 6) return null;
            const [fs, total_kb, used_kb, avail_kb, , mount] = p;
            if (skipFs.test(fs) || skipMount.test(mount)) return null;
            if (seen.has(mount)) return null;
            seen.add(mount);
            const g = n => Math.round(+n * 1024 / 1e9);
            return { mount, fs, size_gb: g(total_kb), used_gb: g(used_kb), avail_gb: g(avail_kb) };
          })
          .filter(Boolean);
        process.stdout.write(JSON.stringify(out));
      });
    " 2>/dev/null || echo '[]')"

  else
    # Linux — wrap lsblk in (|| true) so pipefail doesn't fire || echo '[]'
    # when lsblk is absent, causing node's [] and echo's [] to concatenate as [][]
    DISKS_JSON="$( (lsblk -J -b -o NAME,SIZE,TYPE,ROTA,MODEL 2>/dev/null || true) | node -e "
      let d=''; process.stdin.on('data',x=>d+=x);
      process.stdin.on('end',()=>{
        try {
          const {blockdevices=[]} = JSON.parse(d);
          const disks = blockdevices
            .filter(b => b.type === 'disk')
            .map(b => ({
              name: b.name,
              model: (b.model||'').trim() || null,
              size_gb: Math.round(+b.size / 1e9),
              type: b.name.startsWith('nvme') ? 'nvme'
                  : (b.rota==='0'||b.rota===false) ? 'ssd' : 'hdd',
            }));
          process.stdout.write(JSON.stringify(disks));
        } catch { process.stdout.write('[]'); }
      });
    " 2>/dev/null)"
    [[ -z "$DISKS_JSON" ]] && DISKS_JSON="[]"

    # df -B1 columns: Filesystem  1B-blocks  Used  Available  Use%  Mounted
    MOUNTS_JSON="$(df -B1 2>/dev/null | tail -n +2 | node -e "
      let d=''; process.stdin.on('data',x=>d+=x);
      process.stdin.on('end',()=>{
        const skipFs    = /^(tmpfs|devtmpfs|squashfs|overlay|efivarfs|cgroup|bpf|pstore|hugetlbfs|mqueue|debugfs|tracefs|sysfs|proc|udev|fusectl)/i;
        const skipMount = /^\/(dev|proc|sys|run\/lock|snap\/|boot\/efi)\b/;
        const seen = new Set();
        const out = d.trim().split('\n').filter(Boolean)
          .map(l => {
            const p = l.trim().split(/\s+/);
            if (p.length < 6) return null;
            const [fs, total, used, avail, , mount] = p;
            if (skipFs.test(fs) || skipMount.test(mount)) return null;
            if (seen.has(mount)) return null;
            seen.add(mount);
            return { mount, fs, size_gb: Math.round(+total/1e9), used_gb: Math.round(+used/1e9), avail_gb: Math.round(+avail/1e9) };
          })
          .filter(Boolean);
        process.stdout.write(JSON.stringify(out));
      });
    " 2>/dev/null || echo '[]')"
  fi

  export DISKS_JSON MOUNTS_JSON
}

# ── OS ────────────────────────────────────────────────────────────────────────

_gather_os() {
  if [[ "$PLATFORM" == "Darwin" ]]; then
    OS_PRETTY="macOS $(sw_vers -productVersion 2>/dev/null || echo '')"
    OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo '')"
  elif [[ -f /etc/os-release ]]; then
    OS_PRETTY="$(. /etc/os-release && echo "${PRETTY_NAME:-${NAME:-unknown}}")"
    OS_VERSION="$(. /etc/os-release && echo "${VERSION_ID:-}")"
  else
    OS_PRETTY="$(uname -s)" OS_VERSION=""
  fi
  OS_KERNEL="$(uname -r)"
  OS_ARCH="$(uname -m)"
  export OS_PRETTY OS_VERSION OS_KERNEL OS_ARCH
}

# ── Network ───────────────────────────────────────────────────────────────────

_gather_network() {
  # Capture all UP non-loopback IPv4 addresses.
  # Stored so the KB can later derive /etc/hosts for the whole homelab.
  if [[ "$PLATFORM" == "Darwin" ]]; then
    # ifconfig — parse text output (ip not available by default on macOS)
    IPS_JSON="$(ifconfig 2>/dev/null | node -e "
      let d=''; process.stdin.on('data',x=>d+=x);
      process.stdin.on('end',()=>{
        try {
          const addrs = [];
          let iface = null;
          for (const line of d.split('\n')) {
            const im = line.match(/^(\S+):/);
            if (im) { iface = im[1]; continue; }
            if (!iface || iface === 'lo0') continue;
            const am = line.match(/\s+inet (\d+\.\d+\.\d+\.\d+)/);
            if (am) addrs.push({ iface, ip: am[1], prefix: null });
          }
          process.stdout.write(JSON.stringify(addrs));
        } catch { process.stdout.write('[]'); }
      });
    " 2>/dev/null || echo '[]')"
  else
    IPS_JSON="$(ip -j addr 2>/dev/null | node -e "
      let d=''; process.stdin.on('data',x=>d+=x);
      process.stdin.on('end',()=>{
        try {
          const addrs = JSON.parse(d)
            .filter(i => i.ifname !== 'lo' && i.operstate === 'UP')
            .flatMap(i => (i.addr_info||[])
              .filter(a => a.family === 'inet')
              .map(a => ({ iface: i.ifname, ip: a.local, prefix: a.prefixlen }))
            );
          process.stdout.write(JSON.stringify(addrs));
        } catch { process.stdout.write('[]'); }
      });
    " 2>/dev/null || echo '[]')"
  fi
  export IPS_JSON
}

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

# Full payload for first-time creation (remember endpoint)
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
