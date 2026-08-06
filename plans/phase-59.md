# Phase 59 — heterogeneous host inventory: ARM SBCs + laptops (sysfs-first, graceful)

**Authority:** hierophant, 2026-08-05. **Repo:** grimoire. **Track K (onboarding robustness).**
Found live registering **vier** (Pi Zero 2 W) — same way vier gave us 53/54.

## What happened

vier registered fine but its inventory is x86-centric: `CPU: unknown`, `RAM: 0GB`,
`Motherboard: DMI unavailable`, `GPU: ⚠ none detected`. The gather (`deploy/platform.d/linux.sh`)
only reads x86 sources — `/proc/cpuinfo 'model name'`, `dmidecode`, integer-GB RAM — and there is
**no laptop/battery inventory at all**, though the fleet includes laptops. The code degraded
gracefully (warned, didn't crash — good), but it never falls back to the sources ARM SBCs and
laptops actually expose. This teaches the gather those sources.

**Design rule — sysfs first, no sudo.** The register daemon must not shell `sudo dmidecode` or
`upower`. Everything needed is world-readable under `/sys` and `/proc`. (Interactive `dmidecode`
serial numbers are root-gated → out of scope.)

## What lands

**A. ARM fallbacks (`linux.sh`)**
1. `_gather_cpu`: when `/proc/cpuinfo` has no `model name`, fall back to `/proc/device-tree/model`
   (strip NUL bytes: `tr -d '\0'`), then the cpuinfo `^Model` line → vier reads
   "Raspberry Pi Zero 2 W". Keep the existing `${var:-unknown}` guard.
2. `_gather_mobo`: add an `elif [[ -r /proc/device-tree/model ]]` branch (after the dmidecode one)
   → board name from device-tree.
3. `_gather_mem`: add `MEM_TOTAL_MB=$(( total_kb / 1024 ))` beside `MEM_TOTAL_GB` (which floors
   512 MB → 0). Export both.

**B. Laptop / power (`linux.sh` new `_gather_power`)** — all sysfs, no sudo, all optional:
- Battery from the first `/sys/class/power_supply/BAT*/`: `model_name`, `capacity` (charge %),
  `charge_full` + `charge_full_design` → **health %** = round(full/design·100), `energy_now`
  (+`voltage_now` if energy absent). Emit `BATTERY_JSON` = `{model,capacity_pct,health_pct,...}` or
  `null` when no BAT* exists (desktops/SBCs).
- Machine identity: `/sys/class/dmi/id/product_name` (world-readable) → `PRODUCT_NAME`;
  `/sys/class/dmi/id/chassis_type` → `IS_LAPTOP` (types 8/9/10/14 = portable/laptop/notebook).
- AC presence: `/sys/class/power_supply/A*/online`. Export `BATTERY_JSON PRODUCT_NAME IS_LAPTOP`.

**C. Entity schema + display (`grim-register-host.sh`)**
4. `_build_remember_payload`: add `hardware.memory.total_mb`, `hardware.battery` (parsed
   `BATTERY_JSON` or null), `hardware.product` (`PRODUCT_NAME`), `hardware.is_laptop`.
5. Description line: RAM shows MB when `total_gb < 1`; add a battery segment for laptops
   (`Battery: <model> <health>%`).
6. Report display: RAM MB-aware; the Motherboard step keys on **name-or-vendor** (device-tree sets
   name, not vendor) and reads "no board info" instead of "DMI unavailable" when truly empty;
   GPU "none detected" → neutral **"no discrete GPU"** printed as info, not a `⚠` (a headless SBC
   has no fault); add a **Battery** step shown only when `BATTERY_JSON != null`.

## Out of scope / do NOT

- **No `sudo`, no `dmidecode`, no `upower`** in the gather — sysfs only. No serial numbers
  (root-gated). Don't touch storage/network/OS gather. Don't regress x86 desktop/server output.

## Success checks

- **aid (x86 server): inventory output byte-unchanged** (regression) — CPU/RAM/GPU/mobo identical,
  `battery: null`, `is_laptop: false`.
- **vier (Pi Zero 2 W):** `CPU: Raspberry Pi Zero 2 W`, `RAM: 512MB`, board name from device-tree,
  GPU shows neutral "no discrete GPU" (no ⚠), registers with no crash. *(User verifies on vier.)*
- **a laptop:** `is_laptop: true`, `hardware.battery` populated (model + capacity + health %),
  Battery step shown. *(User verifies on a laptop.)*
- A box missing every optional source (no BAT*, no device-tree, no DMI) still registers clean.
- Footprint: `deploy/platform.d/linux.sh` (cpu/mobo/mem fallbacks + `_gather_power`),
  `deploy/grim-register-host.sh` (schema + display), a test for the parse helpers + graceful-absence.
