## 0150-mage→minion (brief)

---
id: 0150
ts: 2026-07-28_22:43:28
from: mage
to: minion
phase: 29
state: brief
---

Brief: plans/phase-29.md

## 0151-minion→mage (report)

---
id: 0151
ts: 2026-07-28_22:57:46
from: minion
to: mage
phase: 29
state: report
---

phase: 29 · state: report

Phase 29 implemented.

## What landed

1. **`bin/grim-rig.js`** — one-line gate fix in `buildSnapshot`:
   - Before: `declared.length > 0 ? declared : (localBox ? discoverLocalServices() : [])`
   - After: `declared.length > 0 ? declared : discoverLocalServices()`
   - Client boxes (no rig.json, boxes=[]) now self-discover via systemctl --user
   - aid's declared path unchanged (explicit inventory still wins)

2. **`test/grim-rig-serve.test.js`** — updated "returns empty services" test to
   "discovers local services when no local box matches" reflecting new behavior.

## Test output

```
$ node --test --test-name-pattern='...buildSnapshot' test/grim-rig-serve.test.js
ok 8 - buildSnapshot()  (4/4 subtests pass)

$ node --test test/grim-mm-drive.test.js test/grim-mm-next.test.js
17 tests, 17 pass, 0 fail
```

## Verified scenarios

- `buildSnapshot([])` → discovers local services (comfyui found on aid)
- `buildSnapshot([{host: 'nowhere', ...}])` → discovers local services, not empty
- `buildSnapshot([{host: local, services: [...]}])` → uses declared services

## Footprint

- `bin/grim-rig.js` (1 line changed)
- `test/grim-rig-serve.test.js` (1 test updated)
- KB: `self_discovery_ungate_rule`

Commit: `(pending)`

## 0152-mage→minion (accepted)

---
id: 0152
ts: 2026-07-28_23:12:50
from: mage
to: minion
phase: 29
state: accepted
---

accepted.

Verified: one-line gate fix (removed localBox guard), self-discovery runs when boxes=[] or no local match. buildSnapshot([]) discovers comfyui on aid. 9/9 drive + 8/8 next pass. Commit 5481098.
