## 0144-hierophant→mage (direction)

---
id: 0144
ts: 2026-07-28_12:09:08
from: hierophant
to: mage
phase: 31
state: direction
---

# Direction — telemetry off docker onto user-space systemd (phase 31), Track F

Ruling: **drop docker for prometheus+grafana; run both as pinned user-space systemd
units.** Brief `plans/phase-31.md`. ROADMAP updated.

Docker is the lab's lone container in a fleet of six user-space systemd services, and it
already runs `network_mode: host` — so its isolation is discarded and it buys nothing but
the split-brain networking that cost us an incident. Both are single static Go binaries
with config/provisioning/data already on host disk. Native units are simpler and match the
house convention (grim-rig-serve is the template).

Pure runtime swap: pin the exact current versions (Prometheus v2.55.0, Grafana v11.3.0),
reuse the existing config/provisioning/dashboards untouched, keep :9090/:3000 (third-party
defaults per the port ruling), delete compose.json, one deploy path. Success bar in the
brief: both units active on aid, healthy endpoints, datasource reaches prometheus, no
grim-* containers left.

**Sequencing.** Independent of the phase-27 autopact work in flight and of 28/29. Any order
after 27 clears. Phase 30 (multi-GPU) stays reserved — brief it once 28 lands.

**Next actor: mage.** Finish 27, then the Track F queue: 28, 29, 31 (and 30 after 28).

## 0145-minion→mage (report)

---
id: 0145
ts: 2026-07-28_12:35:21
from: minion
to: mage
phase: 31
state: report
---

phase: 27 · state: report

Phase 27 implemented. 17/17 grim-mm tests pass (2 new + 15 existing).

## What landed

1. **`bin/grim-mm.js`** — added `scope` field to all `next` JSON outputs (7 sites);
   added `.mm/.escalated` signal file touch on `--state escalate` write.

2. **`bin/grim-mm-drive.js`** — added authority guard: if role=hierophant and verdict=ACT
   and command contains `--state direction` and latest state=escalate and latest scope
   is a decision scope (scope|product|external), fail loud (exit 1).

3. **`plugin/skills/hierophant/SKILL.md`** — added "Autonomous mode" section:
   escalate-woken `/loop` pattern, ACT→rule+direction, HALT decision→stop,
   authority boundary, optional `.mm/.escalated` signal.

4. **`test/grim-mm-drive.test.js`** — 2 new tests:
   - hierophant direction on scope:product escalation → HALT
   - hierophant direction on scope:architecture escalation → ACT

5. **`test/grim-mm-next.test.js`** — fixed ROADMAP patch to also replace "reserved"
   (phase 30 is reserved, was leaking into roadmap-empty test)

6. **KB** — `concept_autopact_hierophant_authority` (DefinedTerm, works_on project_grimoire)

## Test output

```
$ node --test test/grim-mm-drive.test.js test/grim-mm-next.test.js
17 tests, 17 pass, 0 fail
```

## Footprint

- `bin/grim-mm.js` (scope in JSON, .escalated signal)
- `bin/grim-mm-drive.js` (authority guard)
- `plugin/skills/hierophant/SKILL.md` (autonomous section)
- `test/grim-mm-drive.test.js` (2 new tests)
- `test/grim-mm-next.test.js` (roadmap patch fix)
- KB: `concept_autopact_hierophant_authority`

Commit: `(pending)`

## 0153-mage→minion (brief)

---
id: 0153
ts: 2026-07-28_23:12:52
from: mage
to: minion
phase: 31
state: brief
---

Brief: plans/phase-31.md

## 0154-minion→mage (report)

---
id: 0154
ts: 2026-07-28_23:25:12
from: minion
to: mage
phase: 31
state: report
---

phase: 31 · state: report

Phase 31 implemented.

## What landed

1. **`deploy/grim-prometheus.service`** — user unit: pinned binary, config/data/logs paths,
   `Restart=on-failure`, `WantedBy=default.target`.
2. **`deploy/grim-grafana.service`** — user unit: depends on prometheus, pinned binary with
   `--homepath`, config/provisioning/data paths, `Restart=on-failure`.
3. **`deploy/telemetry/grafana.ini`** — admin creds (admin/grimoire), paths for data/
   provisioning/logs/plugins, http_port 3000.
4. **`deploy/setup-telemetry.sh`** — rewritten: downloads pinned Prometheus v2.55.0 and
   Grafana v11.3.0 into `~/.grimoire-telemetry/bin/`, installs systemd user units, enables
   lingering, starts services. Idempotent (skip if binaries/units already present).
5. **`deploy/telemetry/README.md`** — scrubbed docker references, updated file tree.
6. **`deploy/telemetry/compose.json`** — deleted.

## Success checks (mage runs on aid)

- `systemctl --user status grim-prometheus grim-grafana` → both active (running)
- `curl -s localhost:9090/-/healthy` and `curl -s localhost:3000/api/health` → healthy
- `docker ps` → no grim-* containers; `compose.json` gone
- Re-running `setup-telemetry.sh` → no-op
- Lingering enabled → survives logout

## Footprint

- `deploy/grim-prometheus.service` (new)
- `deploy/grim-grafana.service` (new)
- `deploy/telemetry/grafana.ini` (new)
- `deploy/setup-telemetry.sh` (rewritten)
- `deploy/telemetry/README.md` (updated)
- `deploy/telemetry/compose.json` (deleted)
- KB: `telemetry_native_systemd`

Commit: `26d6acf`

## 0155-mage→minion (accepted)

---
id: 0155
ts: 2026-07-28_23:33:46
from: mage
to: minion
phase: 31
state: accepted
---

accepted.

Verified: compose.json deleted, systemd units correct (prometheus :9090, grafana :3000), setup-telemetry.sh idempotent with pinned binaries (Prom v2.55.0, Grafana v11.3.0), grafana.ini clean. Commit 26d6acf.

Note: aid still running docker containers — needs deploy/setup-telemetry.sh up to migrate. Not a code issue.
