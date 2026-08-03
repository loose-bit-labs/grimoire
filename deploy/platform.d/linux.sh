#!/usr/bin/env bash
# platform.d/linux.sh — Linux gather functions for grim-register-host

_gather_cpu() {
  # NOTE: the caller runs with `set -o pipefail`, so a pipeline whose grep finds
  # nothing (e.g. ARM /proc/cpuinfo lacks 'physical id'/'cpu MHz'/'model name')
  # exits non-zero. Do NOT append `|| echo <default>` to such a pipeline — the
  # pipeline has already emitted its own output (e.g. `wc -l` prints 0), so the
  # fallback gets *concatenated* ("0\n1") and breaks later arithmetic. Instead:
  # swallow the failure with `|| true` and apply the default via `${var:-default}`.
  CPU_MODEL="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | xargs || true)"
  CPU_MODEL="${CPU_MODEL:-unknown}"
  CPU_THREADS="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || true)"
  CPU_THREADS="${CPU_THREADS:-0}"
  local raw_cores
  raw_cores="$(grep 'cpu cores' /proc/cpuinfo 2>/dev/null | head -1 | awk -F: '{print $2}' | xargs || true)"
  CPU_CORES="${raw_cores:-$CPU_THREADS}"
  CPU_SOCKETS="$(grep 'physical id' /proc/cpuinfo 2>/dev/null | sort -u | wc -l | xargs || true)"
  [[ "${CPU_SOCKETS:-0}" -eq 0 ]] && CPU_SOCKETS=1
  CPU_MHZ="$(grep -m1 'cpu MHz' /proc/cpuinfo 2>/dev/null | awk -F: '{print $2}' | xargs | cut -d. -f1 || true)"
  CPU_MHZ="${CPU_MHZ:-0}"
  export CPU_MODEL CPU_THREADS CPU_CORES CPU_SOCKETS CPU_MHZ
}

_gather_mem() {
  local total_kb
  total_kb="$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)"
  MEM_TOTAL_GB=$(( total_kb / 1024 / 1024 ))
  export MEM_TOTAL_GB
}

_gather_gpu() {
  local -a entries=()

  # NVIDIA — nvidia-smi gives exact VRAM and driver version
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
    while IFS=',' read -r name vram driver; do
      entries+=("$(N="${name// /}" V="${vram// /}" D="${driver// /}" node -e "
        const _n=Object.create(null);_n.vendor='nvidia';_n.name=process.env.N.trim();_n.vram_mb=+process.env.V.trim()||0;_n.driver=process.env.D.trim()||null;process.stdout.write(JSON.stringify(_n))")")
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
      dev_path="$(readlink -f "$card" 2>/dev/null || true)"
      pci_slot="$(basename "$dev_path" 2>/dev/null | sed 's/^0000://' || true)"
      [[ -n "$pci_slot" ]] && \
        gpu_name="$(lspci -s "$pci_slot" 2>/dev/null | sed 's/.*: //' | xargs || echo 'AMD GPU')"
    fi

    entries+=("$(N="$gpu_name" V="$vram_mb" node -e "
      const _a=Object.create(null);_a.vendor='amd';_a.name=process.env.N;_a.vram_mb=+process.env.V||0;_a.driver='amdgpu';process.stdout.write(JSON.stringify(_a))")")
  done

  # Fallback: lspci only (no VRAM data)
  if [[ ${#entries[@]} -eq 0 ]] && command -v lspci &>/dev/null; then
    while IFS= read -r line; do
      local gname
      gname="$(echo "$line" | sed 's/^[0-9a-f:.]*  *[^:]*: //')"
      entries+=("$(N="$gname" node -e "
        const _u=Object.create(null);_u.vendor='unknown';_u.name=process.env.N;_u.vram_mb=null;_u.driver=null;process.stdout.write(JSON.stringify(_u))")")
    done < <(lspci 2>/dev/null | grep -iE 'VGA|3D controller|Display' || true)
  fi

  if [[ ${#entries[@]} -gt 0 ]]; then
    GPU_JSON="[$(IFS=,; echo "${entries[*]}")]"
  else
    GPU_JSON="[]"
  fi
  export GPU_JSON
}

_gather_mobo() {
  if [[ -r /sys/class/dmi/id/board_vendor ]]; then
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

_gather_storage() {
  # wrap lsblk in (|| true) so pipefail doesn't fire when lsblk is absent
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

  export DISKS_JSON MOUNTS_JSON
}

_gather_os() {
  if [[ -f /etc/os-release ]]; then
    OS_PRETTY="$(. /etc/os-release && echo "${PRETTY_NAME:-${NAME:-unknown}}")"
    OS_VERSION="$(. /etc/os-release && echo "${VERSION_ID:-}")"
  else
    OS_PRETTY="$(uname -s)" OS_VERSION=""
  fi
  OS_KERNEL="$(uname -r)"
  OS_ARCH="$(uname -m)"
  export OS_PRETTY OS_VERSION OS_KERNEL OS_ARCH
}

_gather_network() {
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
  export IPS_JSON
}
