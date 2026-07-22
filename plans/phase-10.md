# Phase 10 — typed client family: shared service-client base

**Authority:** hierophant, 2026-07-22. **Repo:** grimoire only. Track E, from
`tmp/hi/SERVICE-MESH-LITE.md` Layer 3. Layers 1–2 ruled done/deferred — see ROADMAP.

## What lands

1. `lib/service-client.js` — one small base class (`'use strict'`, doc-block header,
   OOP per `lib/comfy-client.js` style). Constructor takes a **service name**, resolves
   the base URL through `lib/env.js` (`use.*` → `endpoints` → env override), never a
   hardcoded host:port. Owns the cross-cutting concerns:
   - `--max-time`-style request timeout (default ~10s, per-call override)
   - fail loud and fast: a down service throws a clear error naming the service and
     resolved URL — never hangs, never silently degrades
   - `available()` readiness probe (cheap GET, boolean, never throws)
   - opt-in retry (`{retries: N}`), off by default
2. Migrate `lib/ner-client.js` and `lib/a1111-client.js` onto the base. **Export shapes
   unchanged** — every current caller keeps working with zero edits.
3. KB entity (`SoftwareApplication` or technique) documenting the family pattern:
   new service clients extend the base, resolve by name, inherit the reliability rules.

## Out of scope / do NOT

- `lib/comfy-client.js` is **not migrated** — it carries a known uncommitted
  third-party edit; touching it is forbidden until that's resolved. Phase note only.
- No DNS, no reverse proxy, no new daemons (deferred by ruling).
- No new HTTP features in the clients — same requests, same responses, new plumbing.

## Success checks (mage runs these)

- Existing callers of ner-client and a1111-client unchanged (`git diff` shows zero
  caller edits); grep proves export shapes identical.
- With the NER service down, a client call fails within the timeout with an error
  naming service + URL (no hang) — demonstrate with a real timed run.
- `available()` returns false (not throw) against a dead port.
- Full test suite passes; new unit test for resolution order (env → lbl → fallback).
- Footprint: `lib/service-client.js` (new), `lib/ner-client.js`, `lib/a1111-client.js`,
  one test file, one KB entity.
