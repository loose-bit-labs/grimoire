# Track Q — HMM Tracking ("The Guild Hall")

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. Design doc; phases bind to briefs.
**What it is:** live visibility into the hierophant/mage/minion pact loops running across the fleet —
who's working, who's waiting, who's done — surfaced as a cute 3D-meeple viewer. User-designed
(`/tmp/hmm.md`). Sits beside telemetry (Track F): Track F watches *GPUs*, Track Q watches *sessions*.

## Decisions (user, 2026-08-06)

- **Transport:** grimoire **REST + WS is the viewer's source of truth**; rig agents *also* emit
  `hmm_*` Prometheus gauges so history is free. Not Prometheus-as-primary (bad live per-avatar feed).
- **Viewer:** **inlined Three.js**, real 3D meeples (self-contained page — no CDN, CSP-safe).
- **Sequencing:** **thin vertical slice first** (aid only, end-to-end), *then* fan out + polish.

## Architecture (reuse, don't invent)

Three layers, each threaded into existing plumbing:

```
per box:   grim rig serve (:18081)         grimoire (:3663)              browser
  ┌────────────────────────┐        ┌────────────────────────┐   ┌──────────────────┐
  │ _gatherHmm()           │        │ GET  /api/hmm  (fan-out│   │ The Guild Hall   │
  │  scan ~/src/me/*/.mm    │──GET──▶│   to each rig /hmm,    │──▶│ Three.js meeples │
  │  → status state machine │  /hmm  │   like /fleet does)    │ WS│ per host/project │
  │ GET /hmm  (JSON)        │        │ WS   /api/hmm/ws (push)│──▶│ status animations│
  │ hmm_* in /metrics       │        │  merged fleet payload  │   └──────────────────┘
  └────────────────────────┘        └────────────────────────┘
        (Prometheus scrapes /metrics for history — separate, non-blocking)
```

**Collector** lives in the `grim rig` per-host agent (already deployed on every fleet box, already
Prometheus-wired) — not a new daemon. **Aggregate + API** lives in the grimoire server and fans out to
each box exactly like `grim rig`'s `/fleet` fans out to `/status` (boxes from `rig.json`). **Viewer** is
a self-contained page the grimoire serves.

## The status state machine (deterministic — Rule 13, no model)

Per project, the collector reads its `.mm/` thread (each message is YAML-frontmatter: `from`, `to`,
`phase`, `state`; file mtime = timestamp) and crosses it with `grim roadmap` (open-phase count).

Project level:
- **done / retired** — `grim roadmap` open == 0 → project greys out, then drops from the display
  (spec pt 5). This is why `grim roadmap`'s classifier had to be correct (phase-fix earlier today).

Participant level (per role — hierophant / mage / minion), from the latest message(s) + whose-turn
(`NEXT_OWNER`) + activity age against two windows (`ACTIVE`≈5 min, `IDLE`≈20 min — config constants):
- **working** — owns the next move, last activity < ACTIVE
- **conversing** — last ≥2 messages alternate roles within ACTIVE (rapid back-and-forth)
- **waiting-on-user** — latest state is `escalate` with a decision scope, or a USER-gate phase
- **waiting** — not their turn; counterpart owes the next message
- **sleeping** — owns the move but idle > IDLE → grey out (spec pt 7)

Avatar animation ← status, 1:1. Model label under each meeple (mockup: "Opus 5 / Qwen3.6") is
**best-effort** — the `.mm` frontmatter doesn't carry model; derive from session/routing if available,
else show the role. Not a slice blocker.

## Naming

- Feature / track: **HMM Tracking** (Track Q). Viewer page: **"The Guild Hall"** (the party of
  sessions at work — gamer/RPG frame, user's meeple aesthetic).
- Terminal verb: **`grim hmm`** (h/m/m → "hmm") — the text version of the same status, for when you
  don't want the browser. CLI parity with the viewer's data.
- Endpoints: rig `GET /hmm`; grimoire `GET /api/hmm` + `WS /api/hmm/ws`. Metrics: `hmm_*`.

## Phases

| Phase | Deliverable | Gate |
|-------|-------------|------|
| 61 | **Thin vertical slice** — collector + state machine on **aid only**, `grim rig` `GET /hmm`, grimoire `GET /api/hmm` (no fan-out yet, aid only), `grim hmm` CLI, and a **rough Three.js Guild Hall** rendering aid's projects end-to-end. Proves the whole pipe. | `grim hmm` and `/api/hmm` agree; the page shows aid's real pact state live; meeple status matches thread reality |
| 62 | **Fleet fan-out + WS + Prometheus** — `/api/hmm` fans out to all `rig.json` boxes (mirror `/fleet`); WS push-on-change; `hmm_*` gauges in each rig `/metrics`; host/project switch controls | fleet-wide; a status change on any box reflects in the page within a few s; Prometheus scrapes `hmm_*` |
| 63 | **Guild Hall polish** — full 8-status meeple animations, idle-cycle auto-tour (spec pt 6), gray-out on inactivity (pt 7), info-icon project detail panel (pt 8), visually-distinct avatars per role (pt: distinguishable) | user drives + judges the vibe |

## Out of scope (whole track)

- No model in the hot path — status is parsed, not inferred. No writing to `.mm` (read-only observer).
- Self-contained viewer only — inline Three.js + assets, no CDN/external fetch (CSP).
- Don't duplicate Track F — GPU/util stays `grim rig`; this is session/pact state only.
