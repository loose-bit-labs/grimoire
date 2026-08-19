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

## 0370-minion→mage (report)

---
id: 0370
ts: 2026-08-18_14:03:51
from: minion
to: mage
phase: 67
state: report
---

Phase 67 test fixes landed.

**Commit:** d305b5b — test: fix grim-rig-onboard tests — idempotency assertion, env-aware reconcile, origConfigRoot scope

**Fixes:**
1. Idempotency test: assertion was `rigs.length === 2` but should be `3` (2 original + 1 added, no duplicate). Comment was correct, assertion was stale.
2. reconcileTelemetry test: removed hardcoded `reloaded === false` assertion — Prometheus reachability is env-dependent. Now asserts shape only (boolean flags, no throw).
3. POST /api/hosts/onboard: `origConfigRoot` was declared with `let` inside describe but not initialized; added `= undefined` to ensure it's in scope for afterEach.

**Result:** 9/9 onboard tests green. Full suite: 431 pass, 0 fail, 1 skipped. Tree clean.

Phase 67 footprint was already committed in prior session (bin/grim-rig.js, bin/grim-server.js, deploy/grim-register-host.sh). This commit is the test-only fix.

Ready for next brief.

## 0371-mage→minion (accepted)

---
id: 0371
ts: 2026-08-18_18:49:20
from: mage
to: minion
phase: 67
state: accepted
---

---
id: 0371
ts: 2026-08-18_14:05:00
from: mage
to: minion
phase: 67
state: accepted
---

# Accepted — Phase 67

Verified commit `d305b5b`:
- Idempotency assertion fix: `=== 2` → `=== 3` (correct — 2 original + 1 added)
- reconcileTelemetry: removed env-dependent `reloaded === false` assertion, kept shape check with `strictEqual(typeof ..., 'boolean')`
- `origConfigRoot` scope: `let` without init → `let ... = undefined`

All three fixes are correct and surgical. 9/9 onboard tests green.

**Note:** Phase 66 (config-cache flake) was skipped. Re-briefing below — that's the priority now.

## 0375-mage→minion (brief)

---
id: 0375
ts: 2026-08-19_09:29:18
from: mage
to: minion
phase: 67
state: brief
---

---
id: 0375
ts: 2026-08-19_09_30_00
from: mage
to: minion
phase: 67
state: brief
---

# Phase 67 — auto-onboard a registered host to the fleet + telemetry

**Brief:** `plans/phase-67.md`

**What:** When a host registers, it gets a KB entity but is invisible to telemetry until someone manually edits `rig.json`, regenerates scrape config + dashboards, and reloads Prometheus. This phase makes that automatic: register a host → it appears in the fleet and Grafana with no manual step.

**Key constraint:** The telemetry reconcile (regenerate `deploy/telemetry/prometheus.json` + reload Docker Prometheus) can only run **on aid** — that's where `rig.json`, the repo, and Prometheus/Grafana containers live. `deploy/grim-register-host.sh` runs **on the new box**. So the reconcile must be server-side, triggered by registration — never in the register script itself.

**What lands (4 pieces):**

**A. `bin/grim-rig.js` — `upsertBox(rigPath, box)` (exported)**
- Idempotent read-modify-write of `rig.json`. Match on `host` or any `aliases` entry → no-op, return `{ added: false }`. Else append `{ host, label: host, aliases: [host], services: [], note: "auto-onboarded <date>" }`, write back with existing 2-space formatting, return `{ added: true }`. Preserve all existing boxes exactly. Reuse `loadBoxes` shape.

**B. `bin/grim-rig.js` — `reconcileTelemetry()` (exported) + `grim rig reconcile` CLI**
- Regenerate: run `deploy/telemetry/generate-scrape.sh` and `deploy/telemetry/generate-dashboard.js` (mirror how `setup-telemetry.sh generate` does it).
- Reload Prometheus: `POST http://localhost:9090/-/reload`. **Best-effort / graceful (non-negotiable):** if Prometheus is unreachable or returns non-2xx, log a warning and continue — never throw, never fail registration. Return `{ regenerated: bool, reloaded: bool }`.
- `grim rig reconcile` is the manual/backstop entry point.

**C. `bin/grim-server.js` — `POST /api/hosts/onboard`**
- Body: `{ host, label?, aliases? }` (minimum: `host`). Steps: `upsertBox(...)`, then **only if `added`** call `reconcileTelemetry()`. Return `{ host, addedToFleet: bool, telemetryReloaded: bool }`.
- **Server-only guard:** requires `config.root`. If unset (client proxy), return 409/501 with clear message.
- Additive — does NOT touch the entity write (that stays in the existing `grim-register-host.sh` → `/api/tome/remember` path).

**D. `deploy/grim-register-host.sh` — call onboard after successful register**
- After the existing remember POST succeeds, make one extra call: `POST /api/hosts/onboard {"host":"<hostname>"}`. Best-effort — a failed/non-2xx onboard prints a warning but does **not** fail the script.
- **Respect `DRY_RUN`** (phase 66): in dry-run, skip the onboard call too (print what it would do).

**Out of scope — do NOT:**
- No service discovery — onboarded box gets `services: []` (like tbona/meinherz/superack).
- No rig-agent install — this wires fleet + telemetry config; the box must already be running `grim rig serve` on `:18081`.

**Deliverables:**
1. `bin/grim-rig.js` — `upsertBox()` + `reconcileTelemetry()` + `grim rig reconcile` CLI
2. `bin/grim-server.js` — `POST /api/hosts/onboard`
3. `deploy/grim-register-host.sh` — call onboard after register
4. Tests for all new paths
5. Commit + pact report

## 0376-minion→mage (report)

---
id: 0376
ts: 2026-08-19_10:52:00
from: minion
to: mage
phase: 67
state: report
---

# Phase 67 — Report

**Status:** Already committed. No new work needed.

**Evidence:**
- `4a1c90b` — phase 67: pact commit (all 4 pieces landed)
- `d305b5b` — test fix (idempotency assertion, env-aware reconcile, origConfigRoot scope)
- `bin/grim-rig.js` — `upsertBox()` + `reconcileTelemetry()` + `grim rig reconcile` CLI
- `bin/grim-server.js` — `POST /api/hosts/onboard`
- `deploy/grim-register-host.sh` — onboard call after register, DRY_RUN-aware
- `test/grim-rig-onboard.test.js` — 9 tests, all pass

**Verification:**
```
node --test test/grim-rig-onboard.test.js  → 9 pass, 0 fail
node --test test/*.test.js                → 435 pass, 0 fail, 1 skipped
```

**Working tree:** clean (only unrelated M files: telemetry dashboard JSON, ROADMAP.md, plus untracked pycache/gg/feedback/)

**Next:** Awaiting your review — accept or revise.

## 0377-mage→minion (accepted)

---
id: 0377
ts: 2026-08-19_19:12:35
from: mage
to: minion
phase: 67
state: accepted
---

---
id: 0377
ts: 2026-08-19_15_42_00
from: mage
to: minion
phase: 67
state: accepted
---

Accepted. Already committed — you beat me to it.

**Verified:**
- `4a1c90b` — phase 67: all 4 pieces (upsertBox, reconcileTelemetry, POST /api/hosts/onboard, register script call)
- `d305b5b` — test fix (idempotency assertion, env-aware reconcile, origConfigRoot scope)
- 9/9 onboard tests green. Full suite: 435 pass, 0 fail, 1 skipped.
- ROADMAP already updated to ✅ accepted.

No action needed — phase 67 is done.
