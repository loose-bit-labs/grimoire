# Phase 29 — client boxes self-report services (decouple discovery from rig.json)

**Authority:** hierophant, 2026-07-28. **Repo:** grimoire only. Track F.
Live gap found during dashboard testing. The other half of phase 23's graceful
degradation: 23 stopped the crash and left `services: []`; this actually fills it.

## The bug (confirmed in code)

`bin/grim-rig.js` `buildSnapshot` (~line 592–600):
```
const localBox = boxes.find(b => (b.aliases||[]).includes(hostname) || b.host===hostname ...)
const declared = localBox?.services || []
const svcList  = declared.length > 0 ? declared : (localBox ? discoverLocalServices() : [])
```
Client boxes (meinherz/superack/chonko) run with **`$GRIMOIRE_ROOT` unset by design**
(setup-client.sh) → no rig.json → `boxes` is empty → `localBox` is `undefined` →
`svcList = []`. So `discoverLocalServices()` (line ~534, explicitly *"no rig.json config
needed"*) **never runs on the boxes that need it.** Only aid (hosts the KB) has a
`localBox`. That's why "Models Loaded" and per-service alerts are empty everywhere but aid.

The design error: **an agent introspecting itself needs no box-match.** The `localBox`
lookup answers "which *declared* services do I poll"; absent that, self-discovery should
just run — it inspects `systemctl --user` locally, which is always available.

## What lands

1. **Ungate self-discovery.** When there are no declared services, always fall back to
   `discoverLocalServices()` — not only when a `localBox` exists:
   ```
   const svcList = declared.length > 0 ? declared : discoverLocalServices()
   ```
   `discoverLocalServices()` already needs no config; this is the whole fix. Client boxes
   now populate `services[]` from their own running `--user` units.
2. **Keep aid's declared path intact** — if a `localBox` with `services` exists, that
   still wins (explicit inventory beats discovery). Only the *fallback* changes.
3. **Confirm `discoverLocalServices()` maps units → the same service shape** the snapshot
   expects (name/type/port for `pollService`/`parseServiceMetrics`), so a discovered
   llama-server on a client reports models/slots just like a declared one. If it doesn't,
   make the discovered entries carry enough to poll `/status`-style metrics; don't expand
   scope beyond that.

## Out of scope / do NOT

- Don't set `$GRIMOIRE_ROOT` on clients — it stays intentionally unset (phase 23 ruling).
- Don't touch the GPU selector (phase 28) or multi-GPU (later).
- No new deps, no dashboard changes.

## Success checks (mage runs these)

- On a client box (no rig.json, `$GRIMOIRE_ROOT` unset): `curl :18081/status` →
  `services[]` lists the box's actual running `--user` units (e.g. llama-server), with
  per-service metrics where the type is known. Paste it — compare to the empty array today.
- aid unchanged — declared services still reported.
- Unit test: `buildSnapshot([])` (no boxes) still calls `discoverLocalServices()` and
  returns a non-empty `services` when units are present (mock the discovery).
- Footprint: `bin/grim-rig.js` (the one-line gate + any shape fix), one test, KB note.
