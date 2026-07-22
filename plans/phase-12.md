# Phase 12 — rig agent mode: `grim rig serve` (/status + /metrics)

**Authority:** hierophant, 2026-07-22. **Repo:** grimoire only. Track F, from
`tmp/hi/telementry-Full-PoC-Markdown-hand-this-to-your-agent.md`. `grim rig status`
is already the one-shot sensor layer; this makes it a resident agent per box.

## What lands

1. `grim rig serve [--port 8001]` on `bin/grim-rig.js` — a small HTTP server
   (node http, no framework) exposing:
   - `GET /status` — JSON: host metrics (cpu%, mem, disk, gpu util/vram/temp) +
     per-service state (loaded models, queue depth, running jobs) for services on
     **this** box.
   - `GET /metrics` — the same data as Prometheus text format, using the doc's
     metric names (`gen_host_cpu_percent`, `gen_gpu_vram_used_mb`,
     `gen_model_loaded{node,service,model}`, `gen_queue_pending`, …).
2. Host metrics via the `systeminformation` npm package (new dep — approved), with
   exec fallback to `nvidia-smi` / `rocm-smi` / `amd-smi` where SI's GPU data is thin
   (AMD). Mac: SI's unified-memory numbers are acceptable as-is.
3. Service pollers reuse the doc's endpoints — Ollama `/api/ps`, llama.cpp `/slots`,
   A1111 `/sdapi/v1/*`, ComfyUI `/queue` + `/system_stats` — but **targets come from
   config, never the doc's hardcoded ports**: local services listed in `rig.json`
   (this box's entry), URLs resolved per its existing schema. A dead service yields
   absent/zero metrics and a `gen_service_up 0` gauge — never a crash or hang
   (graceful degradation; each poller has a short timeout).
4. Poll on interval (default 5s, `--interval`), serve last-good snapshot; never block
   the HTTP response on a live poll.

## Out of scope / do NOT

- No Prometheus, no Grafana, no docker (that's phase 13). No push/remote_write.
- No ComfyUI custom node — loaded-ckpt from `/history` best-effort is fine.
- No changes to existing `rig status` behavior; `serve` is additive.
- No client-connection tracking (`networkConnections`) in v1 — defer.
- Bind default `0.0.0.0` is forbidden — default `127.0.0.1`, `--listen` to widen.

## Success checks (mage runs these)

- `grim rig serve` on this box: `/status` returns real cpu/mem/gpu numbers;
  `/metrics` parses as Prometheus text (promtool-style regex check is enough).
- Kill/omit a configured service → `gen_service_up 0`, agent stays alive, response
  time stays sub-second.
- `rig status` one-shot unchanged.
- Footprint: `bin/grim-rig.js`, `package.json` (+lock) for systeminformation, one
  test file, one KB entity (`SoftwareApplication` update for grim-rig).
