# Phase 93 — `lib/jev.js`: reusable TypeSafe/Jev client (`bin/grim-jev.js`)

**Authority:** hierophant, 2026-09-23. **Repo:** grimoire. **Track: TypeSafe Integration.**
**Depends on:** nothing (pure addition; no bounty-board dependency).

## Why

TypeSafe (Jev) has been used three times this project (mm role-stamp guard design, hardware-parts
schema depth, tbona experiment-backlog triage) — each time via a hand-written one-off script under
`~/tmp/locatesta/` that reimplements the same ~15 lines: load the key from
`~/.config/api-keys/keys.json`, POST `https://api.typesafe.ai/v1/systemone`, check `res.ok`, save the
raw response as an artifact. Per Rule 13 (mechanics belong in code the skill/session *calls*, not
re-derived each time — same rationale as `grim mm`), this mechanical part becomes a shared client +
CLI. **What stays bespoke per call site:** designing the actual `state`/`questions` shape is a
judgment call each time (TypeSafe's own doctrine: "design the judgments" is not generic) — this phase
does not template that away.

## What lands

- **`lib/jev.js`** — `async function askJev(state, questions, { model = 'jev-latest' } = {})`:
  loads the key from `~/.config/api-keys/keys.json` (field `typesafe`; throw a clear error if
  absent), POSTs `{state, model, questions}` to `https://api.typesafe.ai/v1/systemone` with
  `Authorization: Bearer <key>`, throws `` `typesafe ${status}: ${body.slice(0,300)}` `` on a
  non-`ok` response, returns the parsed JSON. No retries, no caching — a thin client, mirroring
  `lib/a1111-client.js`'s style (`'use strict'`, doc-block header, one exported class or function).
- **`bin/grim-jev.js`** — `grim jev ask <file.json> [--out <path>] [--model <name>]`: reads a JSON
  file shaped `{state, questions}` (the same shape every existing one-off script hand-assembled),
  calls `askJev`, writes the full raw response to `--out` (default:
  `~/tmp/jev-<timestamp>.json`, mirroring the existing `~/tmp/locatesta/` artifact-saving habit —
  **do not silently drop the raw-artifact convention**, it's how prior judgments stay auditable),
  and prints `out.answers` to stdout plus `out.usage` to stderr (same shape as
  `jev-mm-stamp-guard.mjs`'s `Main.run()`).
- Add one `COMMANDS` entry to `bin/grim.js` after the `'bounty'` line:
  `'jev': { script: 'grim-jev.js', desc: 'TypeSafe/Jev judgment client              (ask a typed question)' }`.

## Footprint

Create `lib/jev.js`, `bin/grim-jev.js`; modify `bin/grim.js` (one line); `test/jev.test.js`. Register
the spell in the KB (new-CLI convention, same as phase 76): a `SoftwareApplication` entity for
`grim jev`, `part_of: project_grimoire`, `related_to: system_typesafe_jev_system_one_judgment_api_typesafe_ai_plugin`.

## Success checks

- `askJev` throws a clear, named error when `~/.config/api-keys/keys.json` has no `typesafe` field
  (test via a temp keys file / injected path — do not require a real network call in tests; mock
  `fetch`, matching the codebase's existing test style for HTTP clients).
- `askJev` throws on a non-ok mocked response, with the response body (truncated to 300 chars) in
  the message.
- `bin/grim-jev.js ask <file>` with a mocked/injected client writes the artifact file and prints
  `answers` to stdout — assert both.
- `chmod 755 bin/grim-jev.js`.
- `node --test test/jev.test.js` green; full suite green + self-terminating.
- **Never write the actual API key into the artifact file or logs** — only `out.answers` / `out.usage`
  / the response body get persisted; the key itself is read once per process and never echoed.

## Out of scope

No prompt/question templates for specific use cases (that's phases 94/95). No caching, no retry
logic, no batching multiple question sets in one call — TypeSafe's own guidance says ask independent
questions together in one request when they share state; batching *across* unrelated requests is not
this phase's job. This is a thin client, nothing more.
