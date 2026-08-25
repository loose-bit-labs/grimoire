# Phase 84 — Research: durable `pending → researched` queue (`lib/research-queue.js`)

**Authority:** hierophant, 2026-08-24. **Repo:** grimoire. **Track: G-v3 (research durability).**
**Depends on:** phase 82 (guards — a dive must not OOM the worker), phase 68 (timeout refresh —
`--timeout 0` fire-and-forget must actually work). Master coupling: the KB feature request
`concept_feature_request_decouple_the_researcher_from_swandive_standa`.

## Why

Dives currently run as in-memory `Map` entries tied to swandive's process lifetime — a restart or a
crash drops them with no trace (the 2026-08-11 outage lost every request for hours). User direction
(2026-08-24): **everything dumps into a durable queue, and only moves to a "researched" queue once it
has actually been researched.** The queue must survive front-end restarts, so it owns the state — the
front-end (swandive, phase 85; or any caller) only *submits* and gets a terminal outcome back.

## What lands

Reuse existing primitives — **no new dependency:**
- `lib/queue.js` already models `enqueue` / `updateEntry` with a status transition
  (`pending → synced`); mirror that shape (`pending → researched`, plus a terminal `failed`).
- `lib/bounty-store.js` already gives atomic temp+rename writes and a single-writer `mutate` lock;
  reuse that store discipline so concurrent submit + worker never lose an update.

- **`lib/research-queue.js`** — file store under `<GRIMOIRE_ROOT>/research-queue/`:
  - Entry shape: `{ id, drop, replyTarget, status: 'pending'|'researched'|'failed', submittedAt,
    startedAt, finishedAt, result, error }`. `replyTarget` is opaque to the queue (e.g.
    `{ kind:'discord-dm', channelId, userId }`) — the front-end interprets it on delivery.
  - `submit(root, { drop, replyTarget })` → append a `pending` entry (atomic, dedup by `drop` against
    still-pending/recent entries), return the id. Returns immediately.
  - `claimNext(root)` → the single serial worker's critical section (`mutate`): pick the oldest
    `pending`, stamp `startedAt`, return it (or null). No parallel workers.
  - `complete(root, id, { result })` / `fail(root, id, { error })` → move to `researched` / `failed`,
    stamp `finishedAt`. **Always terminal** — never silence.
  - `list(root, { status })`, `paths(root)`.
- **Worker** — `bin/grim-research.js` gains a `queue`-drain path (or a thin `bin/grim-rq.js` if it
  reads cleaner): loop `claimNext` → `researchDrop(drop, { timeout: 0, json: true })` → `complete`/
  `fail`. Serial, one at a time (the user's "queue… come back an hour later"). Runs as a oneshot drain
  (`grim research queue drain`) and/or a long-lived worker; a systemd unit is out of scope here
  (wire-up in deploy is a follow-up).
- **CLI** — `grim research queue submit <url> [--reply-target <json>]`, `grim research queue list
  [--status pending|researched|failed]`, `grim research queue drain [--once]`. Dispatcher entry +
  KB spell entry.

## Footprint

`lib/research-queue.js`, `test/research-queue.test.js`, `bin/grim-research.js` (drain path + CLI
subcommand) or `bin/grim-rq.js`, `bin/grim.js` (dispatcher entry).

## Success checks

- **Durability:** `submit` then simulate a process exit (drop the in-memory handle) → a fresh
  `list({status:'pending'})` still shows the entry (state is on disk, not in a `Map`).
- **Terminal always:** a drop that acquires fine → `researched` with `result`; a drop whose research
  throws → `failed` with `error`. Never stuck in `pending` after a drain completes.
- **Serial + no lost update:** 5 concurrent `submit` calls + one `drain --once` → all 5 land, exactly
  one is claimed per `claimNext`, final counts consistent (reuse the bounty-store concurrency test
  pattern).
- **Dedup:** submitting the same URL twice while the first is still `pending` does not create two
  entries.
- `node --test test/research-queue.test.js` green; full suite green + self-terminating.

## Out of scope

- Swandive wiring, `onReady` catch-up, embed delivery, and the 11-URL backfill — **phase 85**.
- A server HTTP route for remote submit — can ride phase 85 or a follow-up; not required for the CLI +
  local worker to be correct here.
- Semantic synthesis quality — phase 83 (this phase just runs `researchDrop`, whatever mode it uses).
