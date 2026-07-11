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

**Reuse two existing systems instead of reinventing them:**

- **Static hardware/OS is already captured and persisted.** `deploy/grim-register-host.sh`
  runs the `deploy/platform.d/{linux,darwin}.sh` `_gather_*` functions and upserts a
  `host_<hostname>` `DefinedTerm` into the KB with a full `hardware` block (cpu, memory,
  `gpu[]` with vram_mb/vendor/driver, `vram_total_gb`, motherboard, storage{disks,mounts},
  network). rig's **static layer is a KB lookup**, not a live probe. Registration is the
  funnel; rig displays. This is also how "always capture motherboard" is satisfied — it
  already is.
- **AMD VRAM needs no `amd-smi`/`rocm-smi`.** `platform.d/linux.sh` already reads AMD VRAM
  from sysfs (`/sys/class/drm/card*/device/mem_info_vram_total`). The dynamic layer reads
  the sibling `mem_info_vram_used` + `gpu_busy_percent` from the same path.

Guiding principles (from CLAUDE.md): surgical changes, simplicity first, match existing
conventions, graceful degradation, tests encode intent. Existing `up`/`down` control
commands are untouched.

## Data model — static vs dynamic

A reading of a box produces three record types.

### `static` (hardware/OS — **read from the KB host registry**, not live-probed)

Source: the `host_<hostname>` `DefinedTerm` entity written by `grim-register-host.sh`.
rig reads its `hardware` block; no live probing on the happy path.

| field | from KB `hardware.*` |
|---|---|
| os | (host entity `description` / os fields) |
| cpu | `cpu.model`, `cpu.cores`, `cpu.threads` |
| ramTotalGB | `memory.total_gb` |
| motherboard | `motherboard.vendor` + `motherboard.model` |
| gpus[] | `gpu[]` — name, `vram_mb`, vendor, driver; `vram_total_gb` |
| disks[] | `storage.disks` / `storage.mounts` (total sizes) |

**Unregistered box** → render `⚠ unregistered — run grim-register-host` and skip the
static header (dynamic still works). Optional live fallback: source
`deploy/platform.d/<platform>.sh` and call `_gather_*` (same functions register uses).

### `dynamic` (per-poll — what `--watch` refreshes)

| field | Linux probe |
|---|---|
| ramUsedMB | `free -m` |
| loadavg | `/proc/loadavg` (1/5/15), shown against `cores` |
| gpus[] used+util | NVIDIA: `nvidia-smi --query-gpu=memory.used,utilization.gpu` (all rows). AMD: sysfs `/sys/class/drm/card*/device/{mem_info_vram_used,gpu_busy_percent}` — no amd-smi needed |
| disks[] used/free | `df -m` on configured mounts |
| services[] | **auto-enumerated** systemd user units (see below) + optional rig.json HTTP probes |
| loadedModel | `ollama ps` on ollama hosts — which model is warm in VRAM |

### Service enumeration (primary signal)

Running services are auto-discovered, not hardcoded — following the pattern in
`~/bin/all-my-user-services.sh`. The probe walks the unit files and reports each unit's
active state:

```sh
for u in ~/.config/systemd/user/*.service; do
  s=$(basename "$u")
  echo "SVC:${s}:$(systemctl --user is-active "$s" 2>/dev/null)"
done
```

`is-active` yields `active` / `inactive` / `failed` / `activating` per unit (cleaner than
parsing `systemctl status | grep Active`). This is the **same enumeration** the inventory
uses for its systemd source, so #1 and #2 share one probe.

**Systemd `--user` is the canonical source of truth for services.** Any daemon running
outside it is a *migration target*, not a permanent config entry — the goal is that every
service is a `~/.config/systemd/user/*.service` unit and thus auto-discovered. rig.json
`services[]` is therefore **transitional**: it exists only so non-systemd daemons stay
visible *until they are migrated*. Auto-enumerated units and any transitional probes merge,
deduped by name.

To make migration targets findable, the status probe optionally flags **orphans** — a
short allow-list of known-service process patterns (e.g. `launch.py`/a1111, `trellis`,
`ollama`, comfy `main.py`) found via `pgrep` whose command is *not* backed by any active
user unit. Rendered as `⚠ orphan: <name> (not under systemd)`. This is a nudge to migrate,
kept minimal (YAGNI): a fixed pattern list, no process-tree accounting.

Known current targets to migrate: **a1111** (`:7860`) and **trellis** (`:7777`) on aid —
today curl-probed, not `systemctl`-backed.

### `inventory` (`grim rig models` only)

| source | probe |
|---|---|
| systemd user units | walk `~/.config/systemd/user/*.service`, `systemctl --user is-active` each (running + installed-but-stopped) — same enumeration as the status probe |
| ollama tags | `curl -sf http://localhost:11434/api/tags` |
| HF cache | `hf cache scan` if `hf` locatable, else direct cache-dir walk |
| model dirs (opt) | per-box `modelDirs`: `find -L <dir> \( -name '*.safetensors' -o -name '*.gguf' -o -name '*.ckpt' -o -name '*.pt' \)`, realpath-deduped |

### GPU dynamic — vendor auto-detect

The dynamic GPU probe emits both vendors' readings and lets the parser take whatever is
present: `nvidia-smi --query-gpu=memory.used,utilization.gpu` (all rows) **and** a sysfs
walk of `/sys/class/drm/card*/device/` for AMD (`mem_info_vram_used`, `gpu_busy_percent`,
matched to the static `gpu[]` by index/vendor). No per-box GPU config, no ROCm tooling.
This is what makes aid's R9700 utilisation appear and — by emitting **all** rows instead
of `head -1` — renders both chonko P40s.

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
  - `loadStatic(box)` — fetch the `host_<hostname>` entity from the KB HTTP API (same base
    `grim-register-host` posts to, resolved via `lib/env`) and normalize its `hardware`
    block. Returns `{ unregistered: true }` if absent.
  - Script builders (dynamic + inventory only — static is a KB read):
    `buildDynamicScript(box)`, `buildInventoryScript(box)` — each branches on
    `box.platform` (default `linux`; `darwin` = reduced set, see below).
  - Pure parsers (exported, unit-tested): `parseMeminfo`, `parseLoadavg`,
    `parseNvidiaGpus`, `parseAmdSysfs`, `parseDf`, `parseOllamaPs`, `parseHfCache`,
    `parseSystemdUnits`, `normalizeHostEntity`, plus existing `parseVRAM`-style helpers.
- **`bin/grim-rig.js`**
  - CLI dispatch + rendering only; imports from rig-probe.
  - Subcommands: `status` (default), new `models`; existing `up`/`down` unchanged.
  - Per box, status = one KB read (`loadStatic`, parallel across boxes) + **one SSH
    round-trip** running `buildDynamicScript`, which emits a single blob with
    `#DYNAMIC` / `#SVC` section markers, parsed by marker. In `--watch`, static is read
    once and cached; only the dynamic SSH round-trip repeats per tick.

## rig.json additions (backward-compatible)

- Un-skip **meinherz**. No service seeding needed — the systemd-user enumeration
  auto-discovers its units. `services[]` stays empty unless it runs a non-systemd daemon.
- **Registration is a prerequisite for the static header.** Boxes should be registered via
  `deploy/grim-register-host.sh` (writes `host_<hostname>` to the KB). Un-registered boxes
  still show dynamic status but no hardware header. meinherz (and any darwin box we include)
  needs a one-time register run.
- Optional per-box **`modelDirs: [paths]`** — extra dirs scanned for model files,
  realpath-deduped by real inode so symlink sprawl never double-counts.
- Optional per-box **`disks: [mounts]`** — mounts to report (default `["/"]`), so `df`
  output stays relevant instead of every tmpfs.
- Optional per-box **`hfBin`** — explicit path to `hf` (see resolution chain).
- Optional per-box **`platform: "linux"|"darwin"`** — default `linux`.
- Existing fields (`skip`, `services`, `aliases`, `unit`, `scope`, `note`) unchanged.

### Darwin boxes

Static already works on darwin — `platform.d/darwin.sh` supplies the same `hardware`
block via `grim-register-host`, so the static header is free. For **dynamic**, a
`platform: "darwin"` box uses a reduced probe: RAM (`vm_stat`/`sysctl hw.memsize`),
loadavg (`sysctl -n vm.loadavg`), `df`, and `launchctl`/`pgrep` for services — no
`nvidia-smi`, no AMD sysfs, no `systemctl`. Since darwin boxes are "mostly client atm"
and often `skip: true`, this branch mainly keeps them from spraying errors if included.
Linux remains first-class.

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
- KB unreachable / host entity absent → `loadStatic` returns `{ unregistered: true }`;
  dynamic status still renders. Never fatal (graceful degradation).
- Missing probe path (e.g. no `nvidia-smi`, no AMD sysfs) → that field is `null`/omitted;
  each probe line is independently guarded (`... || echo SENTINEL`).
- `hf` absent → cache-dir fallback; cache dir absent → empty HF section, not an error.
- Malformed probe output → parsers return `null`/`[]` (matches existing `parseVRAM`).

## Testing

Extend `test/rig.test.js` (Node built-in runner, `node --test`). One `test(...)` block
per new parser with fixture strings — no live SSH/exec, matching the existing pattern:
- `parseMeminfo`, `parseLoadavg`, `parseNvidiaGpus` (multi-row), `parseAmdSysfs`,
  `parseDf`, `parseOllamaPs`, `parseHfCache`, `parseSystemdUnits`,
  `normalizeHostEntity` (KB `hardware` block → static record, incl. unregistered case).
- Section-marker splitting of a combined `#DYNAMIC/#SVC` blob.
- Backward-compat: existing `parseVRAM`/`parseBoxOutput`/`fmtGPU`/`findBoxesForService`
  tests continue to pass (or are updated in lockstep if signatures move to rig-probe).

## Out of scope (YAGNI)

- Phase 2 service start/stop already exists (`up`/`down`) — untouched.
- Historical metrics / time-series storage.
- Full ComfyUI `/object_info` schema walk — `modelDirs` file scan covers the need.
- Non-AI process accounting beyond loadavg.
