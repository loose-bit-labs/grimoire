# Phase 77 — Bounty Board: telemetry gauges + determinism gate

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phase 74 accepted (reads a persisted board). Closes the Bounty Board track.

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 7** — exact code + tests there.

## What lands

- `boardMetrics(bountyList, nowMs)` (pure, in `lib/bounty.js`) → `{open_total, open_by_priority:{P0..P3},
  claimed, needs_review, triage, reclaim_total, avg_time_in_open_ms}`.
- `GET /api/bounty/metrics` on `bin/grim-server.js` → Prometheus exposition text (`# HELP`/`# TYPE gauge`,
  `grim_bounty_*` series), mirroring the rig `toPrometheusText` style. Ties into Track F telemetry — these
  are the future watchdog's inputs (409/contention, time-in-OPEN, reclaim rate, poison count).
- **Determinism gate (phase-66 discipline):** run the whole suite twice; identical PASS counts, process
  exits on its own (the 75 sweep timer must be `unref`'d).

## Footprint

`lib/bounty.js` (add `boardMetrics`), `bin/grim-server.js` (metrics endpoint), `test/bounty-metrics.test.js`.

## Success checks

- `boardMetrics` counts states + `open_by_priority` correctly (see plan test).
- `GET /api/bounty/metrics` returns valid Prometheus text with `grim_bounty_open_total`,
  `grim_bounty_open{priority=…}`, `grim_bounty_claimed`, `grim_bounty_needs_review`, `grim_bounty_triage`,
  `grim_bounty_reclaim_total`.
- **`node --test 'test/*.test.js'` run twice ⇒ identical PASS counts, both terminate** (no hang, no order-coupling).

## Out of scope

No Grafana dashboard JSON in this phase (fast-follow, uses `/grimoire:grafana` conventions). No reputation
gauges beyond what `deriveReputation` already yields via `/api/bounty/hunters`.
