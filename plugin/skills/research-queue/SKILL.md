---
name: research-queue
description: Durable research-dive queue (phase 84). Submit a URL to be researched off-process — it survives restarts and crashes, runs with no wall-clock cap, and always lands terminal (researched/failed). Use when a dive must not block this session or must outlive it.
argument-hint: "submit <url> [--reply-target <json>]" | "list [--status <pending|researched|failed>]" | "drain [--once]"
allowed-tools: [Bash]
---

# /research-queue — Durable Dive Queue

Dives used to live in in-memory Maps tied to a front-end's process lifetime — a restart or
crash dropped them with no trace (the 2026-08-11 outage). The queue owns the state on disk;
front-ends only submit and get a terminal outcome back.

## Arguments

- `"submit <url> [--reply-target <json>]"` — enqueue a drop
- `"list [--status <pending|researched|failed>]"` — inspect the queue
- `"drain [--once]"` — run the serial worker

## Instructions

1. Run on the **KB host** (the queue is file state under `<GRIMOIRE_ROOT>/research-queue/`):
   ```bash
   grim research queue submit <url> [--reply-target '{"kind":"discord-dm","channelId":"…","userId":"…"}']
   grim research queue list [--status pending|researched|failed]
   grim research queue drain [--once]
   ```

2. `submit` returns immediately and prints `queued <id> — <url>` or
   `duplicate — <id> already covers <url> (submitted …)`. **Duplicate is success** — the drop
   is already covered; do not re-submit expecting a new entry. Dedup: always while pending,
   within 7 days of a terminal entry, re-requestable after.

3. `drain` is the serial worker: claims the oldest pending, runs the real dive pipeline with
   **`timeout: 0` (no wall-clock cap)** — "come back an hour later" is a feature. `--once`
   processes exactly one entry. It runs the real pipeline (model + network): expect minutes
   per entry, not seconds.

4. Every entry ends **terminal** — `researched` (carries `result.{digest, entityId, …}`) or
   `failed` (carries `error`). Nothing is ever left in limbo after a drain completes. A crash
   mid-dive leaves the entry re-claimable (at-least-once) — the next drain re-researches it;
   the dedup makes that harmless.

## Rules

- **Run on the KB host only.** Without `GRIMOIRE_ROOT` the command exits 1 with
  "requires GRIMOIRE_ROOT (run on the KB host)" — on the KB host itself the repo `.env`
  restores the var at load, so the guard fires only on client boxes.
- `--reply-target` must be a JSON object; the queue stores it **opaque** and never
  interprets it — the front-end (Swandive, phase 85) owns delivery semantics.
- Don't merge or rewrite entries by hand — the store is a single-writer atomic
  temp+rename JSON doc (`entries.json`); concurrent submits and the worker never lose
  an update.
- A `drain` you started is still running if the previous `list` shows an entry "in
  progress" with a fresh `startedAt` — check before draining again from another session.

## When to use

- A URL/repo worth researching that must not block the current session
- Anything that must survive a restart or crash (the front-end's "fire and forget")
- Backfilling dropped work (phase 85's 11-URL backfill rides this)
- NOT for quick one-off dives you want answered now — plain `grim research <drop>` is the
  in-process path

## Tone

Queue discipline. A drop is either in the queue or it isn't; an outcome is either terminal
or it isn't. No silence, no limbo.
