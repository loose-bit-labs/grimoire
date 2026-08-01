# Phase 39 — `grim rig status` works from any node (location-transparent fleet view)

**Authority:** hierophant, 2026-08-01. **Repo:** grimoire only. **Track F** (telemetry).
Loop work. Small-to-medium, one file + one registry entry + a test.

## The ask (user, 2026-08-01)

> "I want the cli tools to let me check fleet members from any node."

Today `grim rig status` only works on the **hub** (the box with `$GRIMOIRE_ROOT/rig.json`).
On a client (`blip`) it dies: *"no box config found. Expected $GRIMOIRE_ROOT/rig.json"*.
That's correct-by-design for the strict loader, but the user wants the **fleet view from
anywhere** — which the architecture already supports; the CLI just has no remote path to it.

## What already exists (build on it, don't reinvent)

- The hub's rig agent serves **`GET /fleet`** — server-side fan-out to every `rig.json`
  box's `/status` (`bin/grim-rig.js:942`, `getFleet()`). **Live now: `http://aid:18081/fleet`
  → 200.** (The `:3003` dashboard front-door from phase 21 is *not* running; don't rely on it.)
- `grim rig gpu <host>` already fetches a **remote** agent over HTTP
  (`http://<host>/status`) — precedent for the CLI reaching across the LAN.
- `lib/env.js` resolves endpoints from `~/.config/lbl-config.json` on any node
  (`endpoints.grimoire = http://aid:3663`). `isLocal`/`isRemote` are already computed there.

## What lands

### A. `grim rig status` becomes location-transparent

In `status()` (`bin/grim-rig.js:293`):

- **Hub path (has rig.json):** unchanged — local fan-out via `loadBoxes()` + `checkBox`, as today.
- **Client path (no rig.json):** instead of erroring, resolve the **rig hub** (see B) and
  `GET <hub>/fleet`, then render the **same table** `status` prints on the hub.
  - `--json` returns the fleet aggregate JSON (passthrough of `/fleet`, or re-shaped to match
    the current `{ boxes, elapsed }` contract — see the shape note below).
- Decide hub-vs-client by the **existing `isLocal`** signal from `lib/env.js` (GRIMOIRE_ROOT
  set + KB dir exists), not by catching the loader throw. `isLocal` → local; else remote.

**Shape note (the one real risk):** `display()` currently renders the `checkBox` result shape.
`/fleet` members come from each box's `/status` (the agent shape), which may differ from
`checkBox`. Reconcile deliberately — either adapt `display()` to accept the `/fleet` member
shape, or map `/fleet` members into the shape `display()` expects. Don't assume they're
identical; verify against a real `curl aid:18081/fleet`.

### B. One registry entry for the rig hub (authoritative, per the mesh ruling)

The client must know where the fleet lives. Add to `~/.config/lbl-config.json`:

- `endpoints.rig_hub = "http://aid:18081"` (the hub's rig agent).
- Resolution order in the CLI: `endpoints.rig_hub` if set; **else derive** — take the host
  from `endpoints.grimoire` and use the canonical rig port `18081` (agent co-locates with the
  KB server today; the explicit entry lets the hub move without a code change).
- This keeps the registry authoritative (Track B ruling) and adds **no DNS** — resolution
  stays name-based through lbl-config, exactly as the SERVICE-MESH-LITE ruling requires.

### C. Soften the strict-loader error for the client case

The current message (`:71`) tells you to copy `rig.example.json` — **wrong advice on a client**
(it would turn a client into a stale would-be hub). When `status` can't find local rig.json
*and* can't reach a hub, print a client-aware message: *"no local fleet inventory and no
reachable rig hub — if this is a client box, run `deploy/setup-client.sh`; set
`endpoints.rig_hub` in lbl-config to point at the hub."* Keep the copy-rig.json hint only for
the genuine hub-setup case.

## Out of scope / do NOT

- **No DNS / dnsmasq / resolver** — deferred by ruling (ROADMAP, 2026-07-22). Resolution stays
  through `lib/env.js` + lbl-config.
- **Do not** create `rig.json` on clients or set `GRIMOIRE_ROOT` there — clients stay
  inventory-free (phase 23). No inventory duplication/sync.
- Don't build/require the `:3003` front-door; the agent's `/fleet` is the source.
- Don't change the `/fleet` endpoint or `getFleet()` semantics — this is a **client** feature.
- Don't touch `loadBriefing`/session code — that's a separate correctness bug (follow-up phase).

## Success checks

- On **blip** (client, no rig.json, GRIMOIRE_ROOT unset): `grim rig status` prints the full
  fleet table (all members: aid/chonko/meinherz/superack), sourced from `aid:18081/fleet`.
- `grim rig status --json` on a client returns machine-readable fleet data.
- On **aid** (hub): `grim rig status` behavior **unchanged** (local fan-out; verify no
  regression — same output as before).
- Hub unreachable from a client → **clear, actionable** error (no stack trace, no
  `rig.example.json` misdirection).
- Test: cover the remote-mode branch (mock the `/fleet` fetch; assert client renders the
  fleet without local rig.json, and that `isLocal` still selects the local path).
- Footprint: `bin/grim-rig.js` (+ the error text), one test, `~/.config/lbl-config.json`
  (+ its schema if one exists), doc/help-text line for the from-any-node behavior, KB note.
