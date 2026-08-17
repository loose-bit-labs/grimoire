# Phase 76 — Bounty Board: CLI (`bin/grim-bounty.js`) + dispatcher entry

**Authority:** hierophant, 2026-08-16. **Repo:** grimoire. **Track: Bounty Board.**
**Depends on:** phase 74 accepted (needs the HTTP endpoints; 75 optional but preferred for `watch`).

Master plan: `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 6** — exact code + tests there.
**Note the plan's Step 4 correction:** the `register` verb must POST the clean path `/api/bounty/register`
(ignore the obfuscated `.replace(...)` line shown in Task 6 Step 3).

## What lands

`bin/grim-bounty.js` — a thin **HTTP client** CLI (resolves the server via `config.endpoints.grimoire`,
never writes state directly). Exported pure helpers for tests: `resolveHunterId(args)` (`--as` → then
`$CLAUDE_CODE_SESSION_ID`, friendly error if neither — mirrors `grim mm --session`), `baseUrl()`,
`formatBoard(bounties)`. Verb dispatch via minimist: `list, show, next, claim, heartbeat, submit, release,
review, create, register, hunters, hunter, watch`; `--json` raw; `--as <hunter>` override.
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
- `node --test test/bounty-cli.test.js` green; full suite green + self-terminating.

## Out of scope

No new server routes (consume 74/75). No reputation gating. Keep the CLI a pure HTTP client.
