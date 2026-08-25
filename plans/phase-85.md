# Phase 85 — Swandive as transport + backfill (fLimfLaMs)

**Authority:** hierophant, 2026-08-24. **Repo:** fLimfLaMs. **Track: G-v3 (research durability).**
**Depends on:** phase 84 (the durable queue must exist and be drainable).

## Why

Swandive should be a **transport/body**, not the research engine (bot-ville separation: engine vs
transport). Today it runs dives in-process, so a restart or OOM loses them. With the phase-84 queue
owning durability, swandive's job shrinks to: submit a drop, return immediately, and deliver the
terminal outcome whenever it's ready — even an hour later, even across a restart.

## What lands

- **`src/main/js/bots/discord/SwandiveDiscordBot.js`** — on a URL/reddit drop:
  - **Submit, don't run.** Replace the in-process `_diveAsync` research call with a queue submit
    (`grim research queue submit <url> --reply-target '{"kind":"discord-dm","channelId":...,
    "userId":...}'`, or the server route if 84 added one). Ack immediately (keep the persona line),
    then return. No `grim research` child in the bot process.
  - **Deliver-back.** When the queue entry reaches `researched`/`failed`, post the embed
    (title/digest/`[signal still wet]` + Discuss button) or an honest error embed. Mechanism: a small
    poller over `grim research queue list --status researched` for entries whose `replyTarget` matches
    a channel it owns and that it hasn't delivered yet (track delivered ids), **or** subscribe if 84
    exposed a stream. Always a terminal post — never silence.
  - **`onReady` catch-up.** On connect, scan recent DM history for URL drops that have **no** result
    reply after them and submit those to the queue (covers drops sent while swandive was down). Bound
    the scan (recent N messages).
  - Keep the grim-npc observation write (`addObservation`) on delivery, and **fix `diveCounter`** —
    it is stuck at 0 despite 11 dives; increment it on each delivered dive.
- **Backfill.** One-time: enqueue the **11 dropped URLs** recorded in
  `~/.config/flimflams/grim-npc.db` (owner `swandive`, `[dive]` observations) into the queue so the
  research that fell in the hole since 2026-08-12 actually runs. A small script/CLI invocation, not new
  bot code — list them, submit each with the original `replyTarget` if recoverable, else a default
  channel. Verify they move `pending → researched`.

## Footprint

`src/main/js/bots/discord/SwandiveDiscordBot.js` (+ its test), a one-shot backfill script under the
repo's scripts dir. No change to the grimoire repo (the queue + CLI are phase 84).

## Success checks

- **Submit-and-return:** dropping a URL enqueues one `pending` entry and the bot process spawns **no**
  research child (assert no in-process `grim research` invocation); the ack posts immediately.
- **Cross-restart delivery:** submit a drop, restart the bot before the worker finishes → after the
  worker completes, the restarted bot still posts the embed to the right channel (delivery keys off the
  durable queue + reply-target, not in-memory state).
- **Catch-up:** a DM'd URL with no reply, present in history at `onReady`, gets submitted exactly once.
- **diveCounter:** increments per delivered dive (no longer stuck at 0).
- **Backfill:** the 11 recorded URLs are enqueued and reach a terminal state; none silently dropped.
- fLimfLaMs test suite green (respect the pre-existing `lbl/a1111` ENOENT skips).

## Out of scope

- Queue internals, worker, `--timeout 0` — phase 84 (+ 68).
- Semantic synthesis — phase 83.
- Reddit Playwright / clone-to-`~/src/3rd` acquire improvements — separate (the acquisition-rules
  note), not this phase.
