# Phase 38 — orientation block in the load briefing (you-are-here: time · host · pwd)

**Authority:** hierophant, 2026-07-30. **Repo:** grimoire only. Small. Loop work.
The Rule-13 companion to Rule 15: instead of hoping the model remembers not to ssh to its
own box, the briefing *tells* it where it is at load time.

## What lands

1. **A short orientation block at the TOP of `grim load`'s briefing** (`bin/grim-session.js`,
   in `formatBriefing` / the CLI print path), computed **client-side**:
   - local time (`new Date()` — human-readable, with tz),
   - hostname (`os.hostname()`),
   - working dir (`process.cwd()`).
   Example first line(s): `📍 aid · /mnt/eighty/userspace/vgvm/src/me/grimoire · Wed 2026-07-30 18:14 EDT`.
2. **`--json` gains an `orientation` object** (`{ time, hostname, cwd }`) for machine reads.
3. Keep it **first** — it's the session's "where/when am I" anchor before identity/affect.

## Why client-side (do not put it in the server projection)

The briefing is fetched from `GET /api/session/briefing` on aid; the server can't know the
*client* session's box or cwd. Compute the orientation locally in `grim-session.js` after
the fetch and prepend it. On the CLI / SessionStart-hook path (where sessions actually
load) this is accurate. (The MCP `session_load` tool runs on the server, so its hostname
would read `aid` — acceptable; the value is the local CLI/hook path. Don't try to thread
client context through the server.)

## Out of scope / do NOT

- Don't change identity/affect/episode/dream sections. Don't grow the payload materially —
  three short lines, must stay well under the `grim load --json ≤ 20000 bytes` budget.
- No new deps (`os`, `process` are stdlib).

## Success checks

- `grim load` on aid prints the orientation line first with the real hostname (`aid`),
  this repo's cwd, and current local time. Run on a second box (or fake `os.hostname()` in
  a test) → shows that box.
- `grim load --json` includes `orientation: { time, hostname, cwd }`.
- Briefing still under budget (`wc -c` on `grim load --json`).
- Footprint: `bin/grim-session.js`, one test (orientation present + json shape), KB note.
