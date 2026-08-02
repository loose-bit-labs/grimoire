# Phase 40 — `grim load` 500: prefer `isLocal` over `isRemote` in the briefing/session path

**Authority:** hierophant, 2026-08-01. **Repo:** grimoire only. Correctness bug. Small.
Loop work. **`grim load` is currently broken on aid** — this restores it.

## The bug (confirmed live, 2026-08-01)

`grim load` / `mcp__grimoire__load` / `GET /api/session/briefing` all return **500** on aid.
The server is otherwise healthy (oracle 200, KB loads, service up). Root cause:

- `lib/env.js`: `isLocal = !!(config.root && fs.existsSync(config.root))` and
  `isRemote = !!(config.host)` are **not mutually exclusive**. On aid both are true:
  `{ root: '/home/vgvm/data/grimoire-kb', host: 'http://aid:3663', isLocal: true, isRemote: true }`.
- `bin/grim-session.js` `loadBriefing()` (~line 204) checks **`if (isRemote)` first** and, when
  true, does `axios.get(\`${config.host}/api/session/briefing\`)`. On the server that host **is
  itself** → the endpoint calls its own endpoint → recursion → 500. The axios-shaped error
  ("Request failed with status code 500") is that self-proxy propagating back.
- Oracle survives because it reads the graph directly and never branches on `isRemote`.

**Regression origin:** `e3a1122` (2026-07-08) added `endpoints.grimoire = http://aid:3663` to
lbl-config (same commit that scrubbed `grimoire.local`). Before that, `config.host` was null on
the server → `isRemote` false → the local branch ran. Adding the server's own address to the
registry flipped `isRemote` true on the server itself, exposing the ordering bug.

## What lands

- In `bin/grim-session.js`, make the mode check **prefer local when both are available**:
  the remote/proxy branch should run only when remote-**only** (`isRemote && !isLocal`), or
  equivalently branch on `isLocal` first (have KB access → read the graph directly; else proxy).
- **`loadBriefing()` (~204) and `saveSession()` (~346)** both have this `if (isRemote)` shape —
  audit **both** (and any other `if (isRemote)` in the file) and apply the same fix so the
  server never proxies to itself. Grep `isRemote` in `bin/grim-session.js`.
- Consider centralizing the intent in `lib/env.js` (e.g. an `isServer`/`preferLocal` helper) if
  it reads cleaner than repeating `isRemote && !isLocal` at each call site — implementer's call,
  keep it minimal.

## Out of scope / do NOT

- Don't change `isLocal`/`isRemote` **definitions** in `lib/env.js` (other callers rely on
  "is a remote endpoint configured?" being true even on the server) — fix the **branch order**
  at the call sites, not the flags.
- Don't touch the rig/fleet work (phase 39), the DNS ruling, or lbl-config contents.
- Don't reintroduce `grimoire.local`.

## Success checks

- On **aid**: `grim load` prints the briefing (identity/affect/etc.), `grim load --json` returns
  valid JSON (and still ≤ 20000 bytes — phase 8/38 budget), `curl -s localhost:3663/api/session/briefing`
  → 200 with real data (not `{"error":...}`), `mcp__grimoire__load` succeeds.
- From a **client** (real remote-only, no GRIMOIRE_ROOT): `grim load` still proxies to the
  server and works — the remote path is preserved, not deleted.
- `saveSession`/`grim save` verified on the server (no self-proxy regression).
- Test: assert that with both `isLocal` and `isRemote` true, `loadBriefing` takes the **local**
  branch (mock/inject env; assert no outbound axios call). Regression guard for exactly this bug.
- Footprint: `bin/grim-session.js` (+ maybe a small `lib/env.js` helper), one test, KB note.
