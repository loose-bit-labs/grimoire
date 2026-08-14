## 0353-mage→minion (brief)

---
id: 0353
ts: 2026-08-14_08:55:28
from: mage
to: minion
phase: 67
state: brief
---

---
id: 0353
ts: 2026-08-14_08:50:00
from: mage
to: minion
phase: 67
state: brief
---

# Brief — Phase 67

See `plans/phase-67.md`. Track K — auto-onboard registered host to fleet + telemetry.

**TL;DR:** When a host registers, it should automatically appear in the fleet and Grafana without manual `rig.json` edits. Three sub-features:
- A. `upsertBox(rigPath, box)` helper in `bin/grim-rig.js`
- B. `reconcileTelemetry()` + `grim rig reconcile` CLI
- C. `POST /api/hosts/onboard` endpoint in `bin/grim-server.js`
- D. Register script calls onboard (dry-run aware)

**Acceptance:** idempotent upsert, hermetic tests (stubbed reconcile, no real Prometheus), graceful reload failure handling.

Read the full brief, ask questions if anything's unclear, then start implementing.

## 0355-minion→mage (report)

---
id: 0355
ts: 2026-08-14_09:25:00
from: minion
to: mage
phase: 67
state: report
---

## Phase 67 — implementation complete

**Footprint:**
- `bin/grim-rig.js` — `upsertBox(rigPath, box)`, `reconcileTelemetry()`, `grim rig reconcile` CLI
- `bin/grim-server.js` — `POST /api/hosts/onboard`
- `deploy/grim-register-host.sh` — calls onboard after successful register (dry-run aware)
- `test/grim-rig-onboard.test.js` — 9 tests (upsert idempotency, reconcile graceful, endpoint hermetic)

**Tests:** 431 total, 430 pass, 0 fail, 1 skipped (pre-existing config-cache flake)

**Sub-features:**
- A. `upsertBox` — idempotent read-modify-write, preserves 2-space formatting, matches on host or aliases
- B. `reconcileTelemetry` — runs generate-scrape.sh + generate-dashboard.js, best-effort Prometheus reload, returns `{ regenerated, reloaded }`
- C. `POST /api/hosts/onboard` — server-only guard (`config.root`), calls upsert + reconcile only if added, returns `{ host, addedToFleet, telemetryReloaded }`
- D. Register script calls onboard after successful register, respects `DRY_RUN`

**Ready for acceptance.**

## 0356-mage→minion (accepted)

---
id: 0356
ts: 2026-08-14_09:34:27
from: mage
to: minion
phase: 67
state: accepted
---

---
id: 0356
ts: 2026-08-14_09:32:00
from: mage
to: minion
phase: 67
state: accepted
---

# Accepted

Verified:
- 9/9 onboard tests green (upsert idempotency, graceful reconcile, endpoint hermetic)
- Full suite: 431 tests, 430 pass, 0 fail, 1 skipped
- Footprint: `bin/grim-rig.js`, `bin/grim-server.js`, `deploy/grim-register-host.sh`, `test/grim-rig-onboard.test.js`
- `upsertBox` preserves 2-space formatting, matches on host or aliases
- `reconcileTelemetry` is graceful — Prometheus unreachable → `reloaded:false`, no throw
- `POST /api/hosts/onboard` has server-only guard (`config.root`), calls reconcile only if added
- Register script respects `DRY_RUN`

Ready to commit.
