# Phase 54 — `grim host gen-hosts` must work on clients (remote mode)

**Authority:** hierophant, 2026-08-03. **Repo:** grimoire. **Track K.** Completes phase 43 —
found onboarding **vier** (a client). This is the hole that makes phase 43's client story
impossible today.

## The gap

`GrimHost` throws in its constructor without local KB access
(`bin/grim-host.js:80` — `if (!config.root) throw new Error('GRIMOIRE_ROOT not set — local KB
required')`). But **clients have no `GRIMOIRE_ROOT`** (by design — phase 23), and there is **no
server endpoint** serving the host registry. So:
- `grim host gen-hosts [--apply]` fails on every client with *"GRIMOIRE_ROOT not set."*
- Phase 43 wired `setup-client.sh` to run `gen-hosts --apply` — which therefore **cannot work on
  the boxes it targets**. The host block only applies on aid (the one box with the KB).

The intent-resolution layer already solved this shape for config (client fetches `/config/lbl`
from the server). Host generation needs the same: fetch the list from the server, don't require
local KB.

## What lands

1. **Server endpoint for the host registry.** `grim-server.js` serves the generated host list —
   e.g. `GET /api/hosts` (or `/hosts`) returning the same `IP  name` lines `gen-hosts` produces
   (one canonical LAN IP per registered host, from the KB host entities — reuse the phase-43
   dedup/canonical-IP logic server-side so there's one implementation).
2. **`gen-hosts` works in remote mode.** When `config.root` is absent but `config.host` is set
   (client), `grim host gen-hosts` **fetches from the server endpoint** instead of throwing.
   `--apply` / `--out` behave identically on the fetched block. Local mode (aid) is unchanged
   (reads the KB directly).
3. **Don't require KB access for the client path** — relax the `GrimHost` constructor throw so
   the `gen-hosts` remote path is reachable (guard the KB-only subcommands like `sync-config`
   separately; those legitimately need `rig.json`/root).

## Out of scope / do NOT

- No DNS. Don't change the managed-block format or `--apply` write logic (phase 43/53).
- Registration (`grim-register-host`) is separate — this is read/generate only.

## Success checks

- On a **client** (vier/nezumi/blip, no `GRIMOIRE_ROOT`, `endpoints.grimoire` seeded):
  `grim host gen-hosts` prints the fleet block (fetched from the server), and
  `grim host gen-hosts --apply` writes `/etc/hosts` — no "GRIMOIRE_ROOT not set."
- On **aid** (local): `gen-hosts` unchanged (reads KB directly), output identical to the server
  endpoint's.
- `GET /api/hosts` returns the canonical one-IP-per-host block; server and CLI share the
  generation logic (no drift).
- `setup-client.sh`'s `gen-hosts --apply` (phase 43) now actually succeeds on a client.
- Footprint: `bin/grim-server.js` (endpoint), `bin/grim-host.js` (remote fetch + relaxed guard),
  shared gen logic, test (remote-mode gen-hosts), KB note.
