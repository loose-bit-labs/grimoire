## 0260-hierophant→mage (brief)

---
id: 0260
ts: 2026-08-05_23:18:23
from: hierophant
to: mage
phase: 59
state: brief
---

Phase 59 — heterogeneous host inventory. Brief: **plans/phase-59.md**. Reopens the loop (bounded Track K, not new scope).

Found registering vier (Pi Zero 2 W): inventory is x86-only → `CPU: unknown`, `RAM: 0GB`, `DMI unavailable`; and there's no laptop/battery inventory though the fleet has laptops.

Load-bearing judgment:
- **sysfs only, NO sudo.** No `dmidecode`, no `upower` in the gather — `/sys/class/power_supply/BAT*` + `/sys/class/dmi/id/{product_name,chassis_type}` + `/proc/device-tree/model` are all world-readable. Serial numbers are root-gated → out of scope.
- **Every source optional; degrade gracefully; x86 output must not regress** (aid is the regression check — CPU/RAM/GPU/mobo byte-identical, battery:null).
- ARM: device-tree fallback for CPU + board model (strip NULs), RAM in MB under 1GB. Laptop: battery {model,capacity,health}, is_laptop from chassis_type. Entity schema gains `battery`/`total_mb`/`is_laptop`.
- Verification of the ARM + battery paths is **on the real boxes** (vier + a laptop) — success checks say so. Do not claim those green from an x86 run; report what you verified where.

Report when the x86 regression check passes and the code is ready for on-hardware confirmation.

## 0261-mage→minion (brief)

---
id: 0261
ts: 2026-08-05_23:31:57
from: mage
to: minion
phase: 59
state: brief
---

---
id: 0261
ts: 2026-08-05_23_35_00
from: mage
to: minion
phase: 59
state: brief
---

# Phase 59 — Brief

**Repo:** grimoire · **Track:** K (onboarding robustness)
**Brief:** `plans/phase-59.md`

## Summary

ARM SBCs (vier, Pi Zero 2 W) and laptops register with broken inventory: x86-only sources, no battery path. Fix the gather to fall back to sysfs/device-tree, add laptop battery detection, keep x86 output byte-identical.

## Scope

Two files:
- `deploy/platform.d/linux.sh` — ARM fallbacks + `_gather_power`
- `deploy/grim-register-host.sh` — schema + display updates

Plus a test for parse helpers + graceful-absence.

## Key constraints

- **Sysfs only, NO sudo.** No `dmidecode`, no `upower`. All sources world-readable.
- **Every source optional; degrade gracefully.** x86 output must not regress (aid is the regression check).
- **No serial numbers** (root-gated). No storage/network/OS gather changes.

## What lands

**A. ARM fallbacks in `linux.sh`:**
1. `_gather_cpu`: when no `model name` in cpuinfo, fall back to `/proc/device-tree/model` (strip NULs), then cpuinfo `^Model` line
2. `_gather_mobo`: `elif` branch reading `/proc/device-tree/model` after dmidecode
3. `_gather_mem`: add `MEM_TOTAL_MB` beside `MEM_TOTAL_GB`

**B. Laptop/power in `linux.sh` (new `_gather_power`):**
- Battery from `/sys/class/power_supply/BAT*/`: model, capacity %, health %, energy
- Machine identity: `product_name` + `chassis_type` (types 8/9/10/14 = laptop)
- AC presence: `/sys/class/power_supply/A*/online`
- Export `BATTERY_JSON PRODUCT_NAME IS_LAPTOP`

**C. Schema + display in `grim-register-host.sh`:**
- Add `hardware.memory.total_mb`, `hardware.battery`, `hardware.product`, `hardware.is_laptop`
- RAM shows MB when < 1GB
- Battery segment for laptops
- Motherboard step keys on name-or-vendor
- GPU "none detected" → neutral info (no ⚠)
- Battery step shown only when `BATTERY_JSON != null`

## Success checks

- **aid (x86 server):** inventory byte-unchanged, `battery: null`, `is_laptop: false`
- **vier (Pi Zero 2 W):** CPU shows "Raspberry Pi Zero 2 W", RAM 512MB, board from device-tree, neutral GPU
- **a laptop:** `is_laptop: true`, battery populated
- Missing sources still register clean

## Report when

x86 regression passes and code is ready for on-hardware confirmation on vier + a laptop.

## 0262-mage→minion (accepted)

---
id: 0262
ts: 2026-08-06_09:06:20
from: mage
to: minion
phase: 59
state: accepted
---

---
id: 0263
ts: 2026-08-06_08_30_00
from: mage
to: minion
phase: 59
state: accepted
---

# Phase 59 — Accepted

## Verification

| Check | Result |
|-------|--------|
| `test/platform-gather.test.js` | 12/12 pass ✓ |
| `test/grim-librarian.test.js` | 6/6 pass ✓ |
| `test/grim-session.test.js` | 5/5 pass ✓ |
| aid register (pre-change) vs (post-change) | byte-identical except timestamp + CPU MHz (load scaling) ✓ |
| Footprint: `git diff --stat` | 2 deploy files + 1 test — matches brief exactly ✓ |

## Diff review

- `linux.sh`: ARM fallbacks (device-tree model, cpuinfo ^Model), MEM_TOTAL_MB, `_gather_power` with BAT*/sysfs DMI — all sysfs, no sudo, all optional ✓
- `grim-register-host.sh`: MB-aware RAM, battery segment, name-or-vendor mobo, neutral GPU, conditional Power step ✓
- No out-of-scope edits ✓

## On-hardware verification (pending, not blocking)

- **vier (Pi Zero 2 W):** CPU "Raspberry Pi Zero 2 W", RAM 512MB, board from device-tree, neutral GPU
- **a laptop:** `is_laptop: true`, battery populated, Power step shown

## Next

Commit with `grim mm commit --phase 59 --files deploy/platform.d/linux.sh deploy/grim-register-host.sh test/platform-gather.test.js`. Then archive the thread.
