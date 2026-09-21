# Phase 76 — Bounty Board: CLI (`bin/grim-bounty.js`) + dispatcher entry

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phase 74 accepted (needs the HTTP endpoints; 75 optional but preferred for `watch`).

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 6** — exact code + tests there,
**except the register route**, which the master plan gets wrong (superseded below).

**Register-route correction (ground truth, phase 74 shipped code + hierophant/mage verification
`.mm/0426`–`0428`, 2026-09-17/20):** ignore master-plan Task 6 Step 3/4 entirely — both the
obfuscated `.replace(...)` line *and* its "fix" to the clean path `/api/bounty/register` are wrong.
The route that actually shipped in `0aa4258` (`bin/grim-server.js`, confirmed live) is
**`POST /api/bounty/:id/register`** — `:id` is present in the path but unused by the handler. The
CLI's `register` verb must call that path, e.g. `` await api('POST', `/api/bounty/${resolveHunterId(args)}/register`, { hunter_id: resolveHunterId(args), host: require('node:os').hostname() }) ``
(any `:id` placeholder value works since the handler ignores it — using the hunter id keeps the
call self-documenting). `plans/phase-74.md:26` and `docs/superpowers/plans/2026-08-16-grim-bounty-board.md`
Task 6 remain uncorrected on this point; do not trust the master plan's CLI code block for this one line.

**`config` field correction (ground truth, verified against `lib/env.js`, `.mm/0430`, 2026-09-21):**
`lib/env`'s `config` export is `{root, host, ollama, prometheus, port}` — there is no `endpoints`
key. `baseUrl()` must resolve the server address from **`config.host`** (which already does the
intended `GRIMOIRE_HOST` env → lbl-config `endpoints.grimoire` resolution — the brief's *intent* was
always right, only the field name was wrong). Master-plan Task 6's `baseUrl()` reading
`config?.endpoints?.grimoire` would throw on every verb (`undefined`) — do not implement it as
written there.

## What lands

`bin/grim-bounty.js` — a thin **HTTP client** CLI (resolves the server via `config.host`, never
writes state directly). Exported pure helpers for tests: `resolveHunterId(args)` (`--as` → then
`$CLAUDE_CODE_SESSION_ID`, friendly error if neither — mirrors `grim mm --session`), `baseUrl()`,
`formatBoard(bounties)`. Verb dispatch via minimist: `list, show, next, claim, heartbeat, submit, release,
review, create, register, hunters, hunter, watch`; `--json` raw; `--as <hunter>` override.
`watch` is listed but **has no phase-75 SSE backend yet** — dispatch it to a "deferred — SSE doorbell
lands in phase 75" error and exit non-zero. Verb present, feature absent, scope held; no polling
fallback.
Add one `COMMANDS` entry to `bin/grim.js` after the `'hmm'` line:
`'bounty': { script: 'grim-bounty.js', desc: 'Claimable cross-repo work pool        (The Bounty Board)' }`.

## Footprint

Create `bin/grim-bounty.js`; modify `bin/grim.js` (one line); `test/bounty-cli.test.js`. Also register the
spell in the KB (new skill/command convention): a `SoftwareApplication` entity for `grim bounty`,
`part_of: project_grimoire`.

## Success checks

- `resolveHunterId({as:'zed'})==='zed'`; with only env set, returns `$CLAUDE_CODE_SESSION_ID`.
- `formatBoard` renders priority-sorted lines (`#id P0 OPEN …` before `#id P2 …`).
- `grim bounty` with no/unknown verb prints usage and exits non-zero.
- `chmod 755 bin/grim-bounty.js` (executable).
- `register` verb POSTs `/api/bounty/<id>/register` (not the master plan's `/api/bounty/register`) —
  verify **in-test**, not by eyeballing: port-0 stub server (the `bounty-server.test.js` idiom),
  `GRIMOIRE_HOST` set before `require`, assert the recorded request path matches `/api/bounty/<hunter>/register`.
- `baseUrl()` reads `config.host`, not `config.endpoints.grimoire`.
- `watch` with no phase-75 backend exits non-zero with a clear "deferred" message — not a hang, not a poll loop.
- `node --test test/bounty-cli.test.js` green; full suite green + self-terminating.

## Out of scope

No new server routes (consume 74/75). No reputation gating. Keep the CLI a pure HTTP client.
