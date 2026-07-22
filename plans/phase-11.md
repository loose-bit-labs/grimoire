# Phase 11 — registry generator: derive, don't duplicate

**Authority:** hierophant, 2026-07-22. **Repo:** grimoire only. Track E closer.

The mesh-lite doc's core rule: everything derives from the one registry, nothing is
hand-maintained twice. lbl-config is the registry (Track B). This phase adds the
generator so hosts files / proxy routes / probe lists can never drift from it.

## What lands

1. `grim config gen <format>` subcommand on `bin/grim-config.js`:
   - `gen hosts` — an `/etc/hosts`-style block (`<ip> <service>.grim`) from
     `endpoints`, resolving hostnames to IPs at generation time; stdout only.
   - `gen probes` — JSON list `{name, url, healthPath?}` for every endpoint —
     consumed later by rig/telemetry (phase 12) so probe targets derive from the
     registry too.
   - `gen caddy` — a Caddyfile mapping `<service>.grim` → endpoint URL. Generated
     and printed, **not deployed** — deployment is a human decision (SPOF ruling).
2. Output is deterministic (sorted keys) so diffs are meaningful.
3. KB entity update on the lbl-config pattern entity: registry → generated views.

## Out of scope / do NOT

- No file writes outside stdout (caller redirects). No deploy scripts, no dnsmasq/
  CoreDNS/Caddy installation, no DNS of any kind. Generation only.
- No schema changes to `config/lbl-config.json`.

## Success checks (mage runs these)

- `grim config gen hosts | sort -c`-style determinism: two runs byte-identical.
- `gen probes` round-trips through `JSON.parse` and covers every `endpoints` key.
- `gen caddy` output is syntactically valid Caddyfile (spot-check structure).
- Unknown format → usage error, exit non-zero.
- Footprint: `bin/grim-config.js`, one test file, one KB entity.
