# Phase 48 — `grim config invalidate` regression: don't brick config resolution

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. **Track K.** Correctness/safety.
A regression the phase-45 work introduced, found live on aid 2026-08-02.

## What happened

`grim config invalidate` deletes `~/.config/lbl-config.json`. On **aid** (the server) that
bricked all endpoint resolution:
- aid has `GRIMOIRE_ROOT` but **no `GRIMOIRE_HOST`**, so after the cache is gone
  `config.host = process.env.GRIMOIRE_HOST || _lblEndpoint('grimoire')` = **null**.
- `grim config sync` then fails: *"No server configured"* — it can't fetch `/config/lbl`
  because it no longer knows where the server is. **Unrecoverable via the CLI.**
- Every `use.*` intent resolved to null → the model client hung on an undefined endpoint →
  `grim research` (and anything model-backed) hung silently. (Root-caused a live outage.)

Two design holes: (1) `invalidate` can strand a box with no way back; (2) **local mode never
falls back to the authoritative repo config** — the server depends on a *deletable cache* for
config it already owns on disk (`config/lbl-config.json`).

## What lands

1. **Local-mode reads the authoritative config.** When `GRIMOIRE_ROOT` is set (server/local
   mode), `lib/env.js` resolution (`_lbl()`/`lblEndpoint`/`config.*`) must fall back to the
   repo's `config/lbl-config.json` when `~/.config/lbl-config.json` is absent. The box that
   *owns* the authority should never be unresolvable because a cache was cleared. (The server
   already serves `/config/lbl` from the repo file — resolution should use the same source.)
2. **`invalidate` won't strand a box.** `grim config invalidate` must keep the box recoverable:
   either preserve a minimal bootstrap (`endpoints.grimoire` / the `GRIMOIRE_HOST` it needs to
   re-`sync`), or refuse with a clear message when there's no bootstrap (no `GRIMOIRE_HOST`, no
   repo config) — never silently leave it with zero endpoints. State which approach and why.
3. **Ties to phase 43's bootstrap-seed:** `setup-client.sh` seeding `GRIMOIRE_HOST`/
   `endpoints.grimoire` means `invalidate`→`sync` round-trips cleanly on clients. Confirm the
   two interoperate (invalidate then sync restores on a seeded client).

## Out of scope / do NOT

- Don't remove `invalidate` (it's wanted) — make it safe. No DNS. Don't change the intent
  contract or endpoint names.

## Success checks

- On aid (server, no `GRIMOIRE_HOST`): `grim config invalidate` then any resolution still works
  (falls back to repo `config/lbl-config.json`); `grim research` does not hang.
- On a seeded client: `invalidate` → `sync` restores the cache and resolves intents.
- `invalidate` on an unseeded, non-server box gives a clear recoverable message, not a silent brick.
- Test: local-mode resolves with the cache deleted (repo fallback); invalidate/sync round-trip.
- Footprint: `bin/grim-config.js`, `lib/env.js`, test, KB note.
