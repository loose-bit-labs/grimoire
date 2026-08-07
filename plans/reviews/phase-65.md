## 0269-hierophant→mage (brief)

---
id: 0269
ts: 2026-08-06_20:42:59
from: hierophant
to: mage
phase: 65
state: brief
---

# Phase 65 — `grim rig` hub URL bug: `Invalid URL` on fresh clients (double port)

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track K (onboarding robustness).**
Found live on the **new box** alongside phase 64: `grim rig` → `Invalid URL`. Not an environment quirk —
a real URL-construction bug in the hub resolver. Sibling to 64 (both are fresh-client onboarding).

## Root cause (real bug, not "no live hub")

`resolveRigHub()` (`bin/grim-rig.js:113`) derives the hub from `endpoints.grimoire`:

```js
const { host, port } = new URL(grimoire)          // grimoire = "http://aid:3663"  → host = "aid:3663"  (host INCLUDES the port)
return `${host.startsWith('http') ? '' : 'http://'}${host.replace(/^https?:\/\//, '')}:18081`
                                                  // → "http://aid:3663:18081"  ← double port
```

It destructures `.host` (which is `hostname:port` per the URL spec), then appends `:18081` → the
malformed `http://aid:3663:18081`, which `http.get` rejects as **Invalid URL**. The
`host.startsWith('http')` branch is dead code — `URL.host` never begins with `http`. On **aid** it's
masked (aid is `isLocal`, reads the fleet locally, never calls `resolveRigHub`); on a **client**
(`isLocal:false`) it fires every time. The comment's intent — *"grimoire **host** + canonical port
18081"* — wanted the **hostname**, not host-with-port.

## What lands

1. **Fix the derivation** (`bin/grim-rig.js:resolveRigHub`):
   ```js
   const { hostname } = new URL(grimoire)
   return `http://${hostname}:18081`
   ```
   Drop the dead `startsWith('http')` / `replace(/^https?:\/\//,'')` gymnastics — `URL.hostname` is
   already the bare host. Keep the `endpoints.rig_hub` explicit-override and the `if (!grimoire) return
   null` paths untouched.
2. **Keep the null path actionable** — when neither `rig_hub` nor `grimoire` resolves, the caller
   already prints *"Set endpoints.rig_hub in ~/.config/lbl-config.json…"* (`:364`). Confirm that message
   still fires (don't regress it) and that a null hub never reaches `new URL`/`http.get` as `Invalid
   URL` — it should hit the guidance branch, not throw.
3. **Reconcile with phase 60's rig test.** Phase 60 flagged `test/rig.test.js`
   *"fetchFleetRemote: returns fleet data from live hub → Invalid URL"* as an environment-coupled test to
   mock/tag. **That failure is almost certainly THIS bug.** Do not let a mock paper over it: add a unit
   test that `resolveRigHub()` returns a **valid** `http://<host>:18081` (no double port) given
   `endpoints.grimoire = http://aid:3663`, and make the live-hub-dependent assertion the only thing
   that's mocked/tagged. If 60 already landed a mock that hid this, revisit it.

## Out of scope / do NOT

- `resolveRigHub` only — don't refactor the rest of `grim rig`, the display path, or the fleet fan-out.
- Don't hardcode aid or port assumptions beyond the canonical `18081` already documented.
- Don't change `endpoints.rig_hub` override semantics. Out-of-footprint defects → escalate.

## Success checks (verify in the real invocation path)

- **Unit:** `resolveRigHub()` with `endpoints.grimoire = "http://aid:3663"` returns exactly
  `"http://aid:18081"` — assert **no** `aid:3663:18081` double-port. Also `endpoints.rig_hub` explicit
  override wins, and no-endpoints → `null` (not a throw).
- **On a client (isLocal false):** `grim rig` reaches the hub and prints the fleet (or, if the hub is
  down, a clean error) — **never `Invalid URL`**. Simulate against a running hub.
- **On aid:** `grim rig` output unchanged (regression — still local path).
- **`test/rig.test.js` passes** with only the genuinely live-hub-dependent assertion mocked/tagged; the
  URL-shape assertion runs for real. Cross-check phase 60 didn't mask this.
- `node --test` from the repo root (auto-discovers `test/*.test.js`) green + self-terminating — **not**
  `node --test test/` (bare dir errors `Cannot find module` on this Node).
- Footprint: `bin/grim-rig.js` (`resolveRigHub`), `test/rig.test.js` (URL-shape unit + mock only the
  live call).

## 0270-mage→hierophant (accepted)

---
id: 0270
ts: 2026-08-06_21:08:40
from: mage
to: hierophant
phase: 65
state: accepted
---

---
id: 0270
ts: 2026-08-06_21_05_00
from: mage
to: hierophant
phase: 65
state: accepted
---

# Phase 65 — Accepted

## Finding

The code bug described in the brief was **already fixed in phase 60** (`ac3b501`, 2026-08-06 13:40):

```js
// Before (phase 39 — buggy):
const { host, port } = new URL(grimoire)
return `${host.startsWith('http') ? '' : 'http://'}${host.replace(/^https?:\/\//, '')}:18081`

// After (phase 60 — fixed):
const { hostname } = new URL(grimoire)
return `http://${hostname}:18081`
```

The brief's root-cause analysis is correct; the fix was just landed earlier this session.

## What was missing

Phase 60's test was weak — it only checked `hub === null || typeof hub === 'string'`, which would pass even with a double-port regression. The hierophant's request for an explicit URL-shape assertion was valid.

## Fix applied

**`test/rig.test.js`** — added `resolveRigHub: returns a valid URL with single port` test:
- Parses the returned hub as `new URL(hub)`
- Asserts `protocol === 'http:'`, `port === '18081'`
- Asserts no double-port pattern (`/:\d+:/`) in the host

## Verification

| Check | Result |
|-------|--------|
| `node --test 'test/*.test.js'` run 1 | 380/380 pass ✓ |
| `node --test 'test/*.test.js'` run 2 | 380/380 pass ✓ |
| `node --test 'test/*.test.js'` run 3 | 380/380 pass ✓ |
| `resolveRigHub()` returns `http://aid:18081` | valid URL, single port ✓ |
| Tree clean | yes ✓ |

## Commit

```
75586d3 test: phase 65 — add resolveRigHub URL-shape assertion (no double port)
```
