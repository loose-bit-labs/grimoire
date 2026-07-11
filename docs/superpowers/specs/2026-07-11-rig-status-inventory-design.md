# Design — `grim rig` status enrichment + `grim rig models` inventory

**Date:** 2026-07-11
**Status:** Approved (brainstorming) → ready for plan

## Problem

Two homelab observability gaps:

1. **Real-time server status** — current `grim rig status` only reports NVIDIA VRAM
   (via `nvidia-smi`) and service up/down. It is blind to CPU load, system RAM, disk,
   AMD/ROCm VRAM (so aid's R9700 32 GB shows nothing), which model is warm, and it only
   renders the **first** GPU (`head -1`) so chonko's second Tesla P40 never appears.

2. **Model inventory across all servers** — `grim models` only queries a single Ollama
   endpoint for the routing table. There is no cross-box view of what models actually
   exist on disk: systemd `--user` AI services, per-host Ollama tags, and the large
   Hugging Face model caches (symlink/blob-structured) scattered in pyenv venvs.

## Approach

Extend the existing `grim rig` command family (Approach A). Both features reuse rig's
per-box SSH-fanout core (`loadBoxes` + `runScript`), one config (`rig.json`), one auth
path. The shared plumbing and all pure parsers move into a new `lib/rig-probe.js` so
`bin/grim-rig.js` stays focused on CLI dispatch + rendering.

Guiding principles (from CLAUDE.md): surgical changes, simplicity first, match existing
conventions, tests encode intent. Existing `up`/`down` control commands are untouched.

## Data model — static vs dynamic

A reading of a box produces three record types.

### `static` (hardware/OS — fetched once; cached across a `--watch` loop)

| field | Linux probe |
|---|---|
| os | `. /etc/os-release; echo "$PRETTY_NAME"` |
| kernel | `uname -r` |
| cpuModel | first `model name` in `/proc/cpuinfo` |
| cores | `nproc` |
| ramTotalMB | `free -m` total |
| system | `/sys/devices/virtual/dmi/id/sys_vendor` + `product_name` |
| motherboard | `/sys/devices/virtual/dmi/id/board_vendor` + `board_name` |
| gpus[] | name + total VRAM — `nvidia-smi --query-gpu=name,memory.total` (all rows) or `amd-smi`/`rocm-smi` |
| disks[] | total size of configured mounts (`df -m`) |

### `dynamic` (per-poll — what `--watch` refreshes)

| field | Linux probe |
|---|---|
| ramUsedMB | `free -m` |
| loadavg | `/proc/loadavg` (1/5/15), shown against `cores` |
| gpus[] used+util | `nvidia-smi --query-gpu=memory.used,utilization.gpu` per GPU / `amd-smi`/`rocm-smi` |
| disks[] used/free | `df -m` on configured mounts |
| services[] | existing per-box `check` probes (unchanged) |
| loadedModel | `ollama ps` on ollama hosts — which model is warm in VRAM |

### `inventory` (`grim rig models` only)

| source | probe |
|---|---|
| systemd user units | `systemctl --user list-units --type=service --all --no-legend` (running + loaded) |
| ollama tags | `curl -sf http://localhost:11434/api/tags` |
| HF cache | `hf cache scan` if `hf` locatable, else direct cache-dir walk |
| model dirs (opt) | per-box `modelDirs`: `find -L <dir> \( -name '*.safetensors' -o -name '*.gguf' -o -name '*.ckpt' -o -name '*.pt' \)`, realpath-deduped |

### GPU vendor auto-detect

The GPU probe tries `nvidia-smi` first; on empty / `NO_GPU` it tries `amd-smi`, then
`rocm-smi`. No per-box GPU config needed. This is what makes aid's R9700 appear and,
by emitting **all** rows instead of `head -1`, renders both chonko P40s.

### HF binary resolution (per-box, pyenv-aware)

`hf` typically lives in a pyenv virtualenv, not on the default PATH. Resolution chain,
first hit wins:

1. rig.json per-box `hfBin` override
2. `command -v hf`
3. glob `~/.pyenv/versions/*/bin/hf` (first match)
4. **fallback:** walk the cache dir directly — `$HF_HOME/hub`, `$HF_HUB_CACHE`, or
   `~/.cache/huggingface/hub` — summing blob sizes per `models--*` repo. Symlink/blob
   structure is stable and parseable, so the inventory works with no binary at all.

## Structure & files

- **`lib/rig-probe.js`** (new)
  - Moved from grim-rig.js: `loadBoxes()`, `runScript(box, script)` (local-vs-ssh via
    `box.aliases` / hostname).
  - Script builders: `buildStatusScript(box)`, `buildDynamicScript(box)`,
    `buildInventoryScript(box)` — each branches on `box.platform` (default `linux`;
    `darwin` = minimal static-only, see below).
  - Pure parsers (exported, unit-tested): `parseMeminfo`, `parseLoadavg`,
    `parseNvidiaGpus`, `parseAmdGpus`, `parseDmi`, `parseDf`, `parseOllamaPs`,
    `parseHfCache`, `parseSystemdUnits`, plus existing `parseVRAM`-style helpers.
- **`bin/grim-rig.js`**
  - CLI dispatch + rendering only; imports from rig-probe.
  - Subcommands: `status` (default), new `models`; existing `up`/`down` unchanged.
  - **One SSH round-trip per box** for status: `buildStatusScript` emits a single blob
    with `#STATIC` / `#DYNAMIC` / `#SVC` section markers, parsed by marker. In `--watch`,
    after the first pass it sends `buildDynamicScript` only and reuses cached static.

## rig.json additions (backward-compatible)

- Un-skip **meinherz**; seed `services: [{ name: "comfyui", scope: "user",
  check: "systemctl --user is-active comfyui ..." }]`. Inventory auto-discovers the rest.
- Optional per-box **`modelDirs: [paths]`** — extra dirs scanned for model files,
  realpath-deduped by real inode so symlink sprawl never double-counts.
- Optional per-box **`disks: [mounts]`** — mounts to report (default `["/"]`), so `df`
  output stays relevant instead of every tmpfs.
- Optional per-box **`hfBin`** — explicit path to `hf` (see resolution chain).
- Optional per-box **`platform: "linux"|"darwin"`** — default `linux`.
- Existing fields (`skip`, `services`, `aliases`, `unit`, `scope`, `note`) unchanged.

### Darwin boxes

A box with `platform: "darwin"` gets a minimal **static-only** probe: `sw_vers`,
`sysctl -n machdep.cpu.brand_string` / `hw.ncpu` / `hw.memsize` / `hw.model`. No GPU/
ROCm/systemd/ollama polling. Keeps macOS clients (mostly `skip: true` today) from
spraying errors if ever included in a run. Linux remains first-class.

## Rendering & CLI

- **Snapshot** (`grim rig` / `grim rig status`): per box a static header line
  (host · OS · CPU ×cores · GPU(s) · RAM total · board), then a dynamic block
  (RAM bar, per-GPU VRAM + util%, disk, loadavg, services ●/○ + warm model). `--json`
  emits `{ static, dynamic }` per box.
- **Watch** (`grim rig --watch [--interval N]`, default 5s): clear + redraw; static
  fetched once; footer shows poll count / elapsed; Ctrl-C exits clean.
- **Inventory** (`grim rig models [--json]`): grouped by box → by source
  (systemd units running/loaded · ollama tags w/ size · HF repos w/ size, sorted desc;
  optional modelDirs listing). Realpath-deduped.

## Error handling

- Unreachable box → rendered `unreachable`, other boxes unaffected (existing behavior).
- Missing probe tool (e.g. no `amd-smi`) → that field is `null`/omitted, never fatal;
  each probe line is independently guarded (`... || echo SENTINEL`).
- `hf` absent → cache-dir fallback; cache dir absent → empty HF section, not an error.
- Malformed probe output → parsers return `null`/`[]` (matches existing `parseVRAM`).

## Testing

Extend `test/rig.test.js` (Node built-in runner, `node --test`). One `test(...)` block
per new parser with fixture strings — no live SSH/exec, matching the existing pattern:
- `parseMeminfo`, `parseLoadavg`, `parseNvidiaGpus` (multi-row), `parseAmdGpus`,
  `parseDmi`, `parseDf`, `parseOllamaPs`, `parseHfCache`, `parseSystemdUnits`.
- Section-marker splitting of a combined `#STATIC/#DYNAMIC/#SVC` blob.
- Backward-compat: existing `parseVRAM`/`parseBoxOutput`/`fmtGPU`/`findBoxesForService`
  tests continue to pass (or are updated in lockstep if signatures move to rig-probe).

## Out of scope (YAGNI)

- Phase 2 service start/stop already exists (`up`/`down`) — untouched.
- Historical metrics / time-series storage.
- Full ComfyUI `/object_info` schema walk — `modelDirs` file scan covers the need.
- Non-AI process accounting beyond loadavg.
```
