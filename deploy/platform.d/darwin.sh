#!/usr/bin/env bash
# platform.d/darwin.sh — macOS gather functions for grim-register-host

_gather_cpu() {
  CPU_MODEL="$(sysctl -n machdep.cpu.brand_string 2>/dev/null | xargs || echo 'unknown')"
  CPU_THREADS="$(sysctl -n hw.logicalcpu 2>/dev/null || echo 0)"
  CPU_CORES="$(sysctl -n hw.physicalcpu 2>/dev/null || echo "$CPU_THREADS")"
  CPU_SOCKETS=1
  local hz
  hz="$(sysctl -n hw.cpufrequency_max 2>/dev/null || echo 0)"
  CPU_MHZ=$(( ${hz:-0} / 1000000 ))
  export CPU_MODEL CPU_THREADS CPU_CORES CPU_SOCKETS CPU_MHZ
}

_gather_mem() {
  local total_bytes
  total_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  MEM_TOTAL_GB=$(( ${total_bytes:-0} / 1024 / 1024 / 1024 ))
  export MEM_TOTAL_GB
}

_gather_gpu() {
  local -a entries=()
  while IFS= read -r gname; do
    entries+=("$(N="$gname" node -e "
      const _g=Object.create(null);_g.vendor='apple';_g.name=process.env.N;_g.vram_mb=null;_g.driver=null;process.stdout.write(JSON.stringify(_g))")")
  done < <(system_profiler SPDisplaysDataType 2>/dev/null | grep 'Chipset Model:' | sed 's/.*Chipset Model: //' || true)
  if [[ ${#entries[@]} -gt 0 ]]; then
    GPU_JSON="[$(IFS=,; echo "${entries[*]}")]"
  else
    GPU_JSON="[]"
  fi
  export GPU_JSON
}

_gather_mobo() {
  local hw_info
  hw_info="$(system_profiler SPHardwareDataType 2>/dev/null || true)"
  MOBO_VENDOR="Apple"
  MOBO_NAME="$(echo "$hw_info" | grep 'Model Identifier:' | awk -F': ' '{print $2}' | xargs || echo '')"
  MOBO_PRODUCT="$(echo "$hw_info" | grep 'Model Name:' | awk -F': ' '{print $2}' | xargs || echo '')"
  export MOBO_VENDOR MOBO_NAME MOBO_PRODUCT
}

_gather_storage() {
  DISKS_JSON="[]"

  # df -Pk: POSIX 6-column format, 1K-blocks
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

  export DISKS_JSON MOUNTS_JSON
}

_gather_os() {
  OS_PRETTY="macOS $(sw_vers -productVersion 2>/dev/null || echo '')"
  OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo '')"
  OS_KERNEL="$(uname -r)"
  OS_ARCH="$(uname -m)"
  export OS_PRETTY OS_VERSION OS_KERNEL OS_ARCH
}

_gather_network() {
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
  export IPS_JSON
}
