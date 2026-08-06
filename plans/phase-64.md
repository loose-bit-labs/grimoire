# Phase 64 — `grim host list` remote mode: clients see the fleet without a local KB

**Authority:** hierophant, 2026-08-06. **Repo:** grimoire. **Track K (onboarding robustness).**
Found live on the **new box joining the fleet**: `grim host list` throws
`GRIMOIRE_ROOT not set — local KB required` and **never tries aid**. Same class as vier's 53/54/59.

## What happened

`grim host list` → `list()` → `scanHostEntities(config.root)` (`bin/grim-host.js:122`, helper at `:81`)
reads the **local KB** (`$GRIMOIRE_ROOT/entities`) and nothing else. On a fresh client `GRIMOIRE_ROOT`
is unset **by design** (clients resolve the server via lbl-config, they have no local KB — see the env
table in CLAUDE.md), so it throws immediately with no remote fallback.

Only **`gen-hosts`** ever got remote mode (phase 54: `bin/grim-host.js:165–184` fetches
`${config.host}/api/hosts` when there's no local KB). `list` was left local-only, **and** the server
exposes no inventory endpoint — `GET /api/hosts` (`bin/grim-server.js:171`) returns only the
`/etc/hosts` text block (`buildHostsOutput`), not the host entities `scanHostEntities` produces. So a
client literally has nothing to call. This finishes what 54 started.

## What lands

**A. Server inventory endpoint — `GET /api/hosts/inventory`** (`bin/grim-server.js`, beside the
existing `/api/hosts` at :171).
- Returns `scanHostEntities(env.root)` as JSON (`scanHostEntities` is already exported from
  `grim-host.js`). Same source the local CLI uses, so remote bytes == local bytes (the phase-54
  invariant). If the server itself has no `env.root`, respond 503 with a clear message (shouldn't
  happen on aid, but fail loud).

**B. Client remote fallback in `list()`** (`bin/grim-host.js`).
- Refactor so the **formatting** of the host list is a pure function of the entities array (split
  "get entities" from "render them"), then:
  - `config.root` present → `scanHostEntities(config.root)` (unchanged local path).
  - `config.root` null → `axios.get(\`${config.host}/api/hosts/inventory\`, { timeout: 5000 })` and
    render the fetched array **identically** — mirror the `gen-hosts` fallback (`:165–184`) exactly,
    including its error handling.
- **Actionable failure** when neither works: if `config.root` is null **and** `config.host` is null
  (lbl-config didn't resolve `grimoire`), print guidance — *"no local KB and no grimoire server
  resolved; run the client setup so lbl-config knows where the grimoire is."* Don't dump a raw stack.
- Output must be **byte-identical** local vs remote (same invariant `gen-hosts` holds).

## Out of scope / do NOT

- Don't touch `gen-hosts`, `register`, or `sync-config` in this phase — `list` only. (If `register`
  turns out to also need the server on a fresh client, that's a **separate** finding — escalate, note
  it, don't scope-creep here.)
- Don't change `/api/hosts` (the `/etc/hosts` block) — add a **new** endpoint beside it.
- Don't hardcode aid — `config.host` comes from lbl-config via `lib/env.js` (`env.host`). Resolve.
- No auth/write paths — this is read-only inventory. Out-of-footprint defects → escalate.

## Success checks (verify in the real invocation path)

- **On aid (has KB):** `grim host list` output **unchanged** (regression) — capture it.
- **On a client (unset `GRIMOIRE_ROOT`, lbl-config resolves grimoire):** `grim host list` now prints the
  fleet, **byte-identical** to aid's local output. Simulate by running with `GRIMOIRE_ROOT` unset against
  a running server (e.g. `env -u GRIMOIRE_ROOT node bin/grim-host.js list`). Show it matching.
- **`curl -s http://aid:3663/api/hosts/inventory`** returns the host-entities JSON array.
- **Neither local nor remote:** unset `GRIMOIRE_ROOT` **and** point at no server → clear actionable
  message, non-zero exit, **no stack trace**.
- Note in the phase report that the endpoint requires a **`grimoire.service` restart on aid** to go live
  (deploy step is user-gated — surface it, don't attempt it).
- `node --test` from the repo root (auto-discovers `test/*.test.js`) green + self-terminating — **not**
  `node --test test/` (a bare dir errors `Cannot find module` on this Node; that's not a real failure).
- Footprint: `bin/grim-server.js` (new `/api/hosts/inventory`), `bin/grim-host.js` (`list()` remote
  fallback + format/get split), `test/` (endpoint shape + remote-mode list renders + graceful no-source).
