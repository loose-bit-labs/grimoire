# Phase 44 — finish the grimoire.local retirement: scrub code output + retire the `.grim` duplicate

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. **Track K** (hostname-based
resolution). Cleanup half of the track. Depends on nothing; can run alongside 43.

## Two loose ends from the `grimoire.local` → hostname migration

`grimoire.local` was scrubbed from *config/resolution* back in `e3a1122` (2026-07-08), but two
tails remain, and there's a second, orphaned host-name scheme causing confusion.

### A. `grimoire.local` still printed to users / in messages

It survives in user-facing strings (misleading now that it doesn't resolve):
- `bin/grim-server.js:717-718` — the startup banner prints `LAN: http://grimoire.local:3663`
  and `MCP endpoint: http://grimoire.local:3663/mcp`. **Print the real bound host** (e.g. the
  configured `endpoints.grimoire` / `aid`, or the actual listen address) — this is what a user
  copies for the MCP endpoint, so it must be correct.
- `lib/graph.js:32,45` — error messages tell users to run things "on grimoire.local".
- `bin/grim-ritual.js:7,19`, `bin/grim-crawl.js:259`, `bin/grim-ner-server.py:6` — comments /
  log strings referencing grimoire.local.

Replace with the hostname/lbl-config reality (bare host from config, or "the KB host"). Banner
and error messages are the priority (they're actionable output); comments are lower stakes but
fix them in the same pass so the string is gone.

### B. Retire the orphaned `.grim` host scheme

There are **two** host-name generators:
- `grim host gen-hosts` — KB-sourced, **bare** names (`aid`, `chonko`). **Canonical** — this is
  what lbl-config endpoints and all code resolve. (Phase 43 makes it operational.)
- `grim config gen hosts` — lbl-config-sourced, emits **`.grim`-suffixed** names
  (`aid.grim`, `grimoire.grim`). **Orphaned** — nothing resolves or consumes `.grim`.

**Ruling: bare hostnames from the KB host registry are the one source of truth.** Retire or
repoint the `.grim` variant so there's no second scheme tempting drift:
- Preferred: **remove** the `.grim` output from `grim config gen hosts` (or make it emit bare
  names identical to `grim host gen-hosts`, if that command is wanted as a lbl-config-based
  view). Pick one; state which and why. Don't leave two divergent host generators.
- Update any `plans/*` / docs / help text that reference `.grim` or the dual generators.

## Out of scope / do NOT

- No DNS. No new resolver. Don't change bare-hostname endpoint contracts.
- Don't reintroduce `grimoire.local` anywhere. Don't touch phase-43's gen-hosts/apply work
  beyond the `.grim` reconciliation.

## Success checks

- `grep -rniE 'grimoire\.local' bin/ lib/ deploy/` → no user-facing occurrences (banner +
  error messages clean; comments gone too).
- `grim serve` banner prints a **resolvable** host for the LAN + MCP endpoint URL.
- Exactly **one** host-name generator scheme remains (bare, KB-sourced); the `.grim` output is
  gone or unified. `grep -rn '\.grim' bin/ lib/` shows no orphaned scheme.
- Footprint: `bin/grim-server.js`, `lib/graph.js`, `bin/grim-config.js` (the `.grim` gen),
  plus the comment-only files; doc/help updates; KB note.
