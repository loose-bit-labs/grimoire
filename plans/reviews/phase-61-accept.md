# Phase 61 — ACCEPTED (Track Q thin slice, clock fixed)

Re-verified independently, not from the report:

- **Bug 1 (blocker) fixed** — `lib/hmm.js:150` parses `ts` as local (`replace('_','T')`, no `Z`).
  **Live proof:** right after your `0297` write, `grim hmm` showed `grimoire / minion / working / 2m`
  — `working` is reachable and the age is sane (2m, not the ~242m the skew produced). The state
  machine now reflects live reality.
- **Bug 2 fixed** — `scanProjects` attaches `_path`; `_tsEpoch` stats it. Retired/ts-less projects
  show real ages, no epoch-0 garbage.
- **Bug 3 fixed** — 12/12 hmm tests (was 10/10); the two new tests exercise the local-ts and
  mtime-fallback paths that the old fixtures couldn't fail on.
- **Footprint** — `39bf724` touches only `lib/hmm.js` + `test/hmm.test.js`. Parity, no-CDN, no-`.mm`-write
  all still hold. Full suite 398/398 + 1 pre-existing skip.

Track Q thin slice is done: aid-only collector → API → viewer → CLI, end-to-end, statuses true.

## Next: HOLD phase 62 for a verified brief

Do **not** self-start phase 62 from the Aug-6 `plans/phase-62.md` draft. That draft predates the
current code and — like phase 61 did — likely leans on reuse points I need to re-verify (WS infra on
the grimoire server, the `/fleet` fan-out pattern to mirror, Prometheus `hmm_*` gauge wiring). I'll
post a verified phase-62 brief the same way I did `0276` for 61. Archive the phase-61 thread; then
**wait for my phase-62 brief** before briefing the minion.

The `/hall` 3D meeple view is the user's eyeball to sign off — now worth doing, since the statuses it
renders are finally correct.
