# Phase 62 — HMM Tracking: fleet fan-out + WS push + Prometheus history

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track Q (HMM Tracking).**
Design doc: `plans/track-hmm-tracking.md`. Depends on **phase 61** (aid-only slice must be accepted first —
`lib/hmm.js`, rig `GET /hmm`, grimoire `GET /api/hmm`, `/hall`, `grim hmm` all exist and work for aid).
This phase turns the single-box slice into a **fleet-wide, live** view. No new avatar art (that's 63).

## What lands

**A. Fleet fan-out — grimoire `GET /api/hmm`** (`bin/grim-server.js`).
- Replace phase 61's aid-only body with a **fan-out over `rig.json` boxes**, mirroring `grim rig`'s
  existing `/fleet` → `/status` pattern (read that code; copy its shape — per-box `http.get` with
  `AbortSignal.timeout(~5000)`, `Promise.allSettled`). Each box's `http://<box>:18081/hmm` contributes
  its projects. Merge into `{ boxes: [{ host, up, projects }] }`.
- **Graceful degradation (non-negotiable):** an unreachable box is marked `up:false` with `projects:[]`
  — it must **never** fail the whole response (exactly how `/fleet` tolerates a down box). aid itself is
  just another box in the list (may still short-circuit to local `lib/hmm` — fine, but it appears in
  `boxes` like the rest).
- Boxes come from `rig.json` (aid/chonko/meinherz/superack/…) — resolve, don't hardcode.

**B. WS push — grimoire `WS /api/hmm/ws`** (`bin/grim-server.js`).
- On connect, send the current merged payload; then **poll the fan-out on an interval** (`HMM_POLL_SEC`
  ≈ 5–10, a named const), diff against the last sent payload, and **broadcast only on change**. Keep it
  dead simple — poll + shallow-diff + broadcast; no per-box push plumbing. One shared poll timer feeds
  all connected clients (don't spin a timer per socket). Clean up the interval when the last client
  disconnects.
- The viewer prefers WS; if WS is unavailable it falls back to polling `GET /api/hmm` (keeps 61's path
  working). Don't break the plain REST endpoint.

**C. Prometheus history — `hmm_*` gauges in each rig agent `/metrics`** (`bin/grim-rig.js`, helper in
`lib/hmm.js`).
- Add a `hmm.toPrometheus(projects, host)` helper emitting bounded-cardinality gauges:
  `hmm_participant_status{host,project,role,status} 1` (one active status line per role — the current
  one set to 1) and `hmm_last_activity_seconds{host,project,role} <age>`. Cardinality is
  host×project×role — small and bounded (a handful of projects × 3 roles); do **not** label by phase
  number or message id (unbounded).
- Fold these lines into the rig agent's existing `/metrics` text output so the current Prometheus scrape
  picks them up with no scrape-config change. History is a **side channel** — the viewer never reads
  Prometheus (decision 1); it exists for time-series/Grafana only.

**D. Viewer — host/project switcher + live updates** (`public/guild-hall.html`).
- Consume the multi-box payload: a **host switch** and a **project switch** (spec pt 4). Subscribe to
  `/api/hmm/ws`; when a broadcast arrives, update the meeples in place (a participant going
  `working→waiting` changes on screen within a poll interval). Still rough visuals — polish is 63.

## Out of scope / do NOT

- No new avatar animations / idle-cycle / gray-out / info-panel — **all phase 63**.
- No per-box WebSocket chains — the server polls the boxes and fans WS out to browsers; that's enough at
  this scale (mirror the cold/warm simplicity of Track O). No message bus.
- Don't label Prometheus series by phase/message (cardinality). Don't make the viewer read Prometheus.
- Don't regress the aid-only REST path from 61. A down box must not 500 `/api/hmm`.
- Out-of-footprint defects → escalate, don't silently commit (acceptance bar).

## Success checks (verify in the real invocation path)

- **`curl -s http://aid:3663/api/hmm`** returns `boxes[]` covering the reachable fleet, each with its
  projects; **kill one box's rig agent** (or point at a dead host) and confirm the response still returns
  200 with that box `up:false` — the others unaffected. Capture both runs.
- **WS liveness:** connect a WS client to `/api/hmm/ws`, cause a real pact status change on some box
  (e.g. a `.mm` write flips whose-turn), and observe the broadcast arrive within one `HMM_POLL_SEC`.
  Show it. *"WS connects" is not acceptance — a real status change must propagate.*
- **`curl -s http://<box>:18081/metrics | grep hmm_`** shows the `hmm_participant_status` /
  `hmm_last_activity_seconds` lines with sane labels; confirm Prometheus scrapes them (query
  `hmm_participant_status` returns series). Bounded cardinality — no phase/id labels.
- The Guild Hall page switches hosts/projects and updates meeples live off WS (user eyeballs).
- Default `node --test test/` still green + self-terminating (phase 60's bar holds).
- Footprint: `bin/grim-server.js` (fan-out + WS), `bin/grim-rig.js` (hmm_* in /metrics),
  `lib/hmm.js` (`toPrometheus` helper), `public/guild-hall.html` (switcher + WS client),
  `test/hmm.test.js` (fan-out merge + toPrometheus shape + down-box tolerance).
