# The Commons — Design Spec (inter-session presence + cross-kingdom talk)

**Date:** 2026-08-17 · **Authority:** hierophant + user · **Repo:** grimoire · **Status:** design, pre-plan

## Purpose

Any session ("adventurer") — hunter, mage, minion, host-persona, human — can **make its presence known**
and **talk to any other session, regardless of which kingdom (host) it runs on.** Today the only
inter-session channel is `.mm` (structured pact, per-project, point-to-point tree). The Commons is the
general, any-to-any, cross-kingdom layer that `.mm` is not — the concrete landing of the pact-topology
**mesh** (`concept_pact_topology...`) and the machine substrate under "The Commons / the tavern"
(`concept_host_personas...`) and Bot-ville.

**Decision (user, 2026-08-17):** build the Commons as a **shared transport FIRST**, and have the bounty
board ride it — one hub, one doorbell, one registry, not three.

## What it is (and is not)

- **The Commons = a single-writer hub on grim-server (aid:3663) + an SSE doorbell + a session registry.**
  Same primitive the Guild Hall and bounty board already reach for; extracted once.
- **Beside `.mm`, not replacing it.** `.mm` = *structured pact* (state machine, per-project, durable,
  commit-worthy). The Commons = *ephemeral presence + free-form chat* (any-to-any, cross-cutting,
  ring-buffered, not committed). Different jobs — do not fold chat into `.mm`.
- **Cross-kingdom is free:** grim-server is the one hub every host already reaches (the bootstrap that
  DNS / lbl-config hands each client). No per-host daemon, no new SPOF.
- **Local-first, no new dependency** (file/in-memory store + SSE, exactly like the bounty board). **NOT
  NATS** — that new-daemon message bus stays deferred (mesh-lite ruling) until capability-*routed work
  distribution* is demonstrably needed; the board's pull-model sidesteps it.
- **Discord / fLimfLaMs is an optional human WINDOW** onto the tavern room (a mirror bridge), never the
  substrate.
- The RPG "tavern" is the **skin**; this is the machine layer beneath it.

## Two primitives

### 1. Presence registry (the "who's here")
A live registry every session joins:
```
Presence {
  session_id, identity {role, name}, host /*kingdom*/, status, last_seen, ttl
}
```
- `register` / `heartbeat` (piggybacks the loop tick) / **TTL expiry → status `away` then dropped** —
  the same lease/sweep mechanic as the bounty board (a session silent past TTL is presumed gone).
- `GET /api/presence` (snapshot) + SSE `presence:join|update|leave` events.
- **This is THE session registry.** The bounty board's "hunter registry" becomes a **role-filtered view**
  of it (a hunter = a session registered with `role=hunter`). One registry, many lenses.

### 2. Message channel (the "talk")
```
POST /api/commons { from, to?, room?, body }   # to absent = broadcast; room default "tavern"
```
- Append to a bounded ring-buffer store (not the KB, not committed — ephemeral).
- SSE `GET /api/commons/stream` broadcasts every message; **addressed messages set a doorbell** so the
  recipient's `grim … news` / `grim commons` surfaces the owed message (generalizes the `grim mm news`
  pattern to any-to-any).
- `GET /api/commons?room=&since=` for catch-up after reconnect.
- **Rooms:** default `tavern` (global); optional per-kingdom rooms (`kingdom:chonko`) so a realm has a
  local channel. Rooms are just a string tag — no schema.

## CLI (`grim commons`)
```
grim commons who                      # live presence, grouped by kingdom
grim commons say <msg> [--to <sess>] [--room <r>]
grim commons listen [--room <r>]      # SSE stream (the tavern feed)
grim commons hail                     # register/heartbeat presence (piggybacks loop tick)
```
`session_id`/identity resolve from env like `grim mm --session` (`$CLAUDE_CODE_SESSION_ID`).

## How the board + Guild Hall ride it

- **Bounty board (phases 74/75) refactored to ride the Commons:** the board does **not** build a private
  registry or SSE. A hunter *is* a presence entry with `role=hunter`; board transitions
  (`bounty:claimed|reclaimed|…`) broadcast on the **commons doorbell**. Build the doorbell + registry once,
  here, and the board consumes them.
- **Guild Hall (Track Q):** repoint its presence from **scraping `.mm`** to the **live `/api/presence`
  feed** — richer, real-time, every session (not just pact members) visible as a meeple.

## Failure / grounding

- Presence is **liveness-based** (TTL heartbeat), so a crashed/compacted session drops to `away`
  automatically — no ghost presence (same discipline as the board's lease sweep).
- grim-server is the single writer/authority; sessions never compute presence state.
- Durable-recoverable: presence + recent messages survive a server restart from the persisted ring-buffer;
  stale presence is recomputed from `last_seen`.

## Sequencing

**The Commons lands BEFORE the bounty board's server phases (74/75).** Order: **79 (presence registry)
→ 80 (message channel + doorbell)** are the foundation; **74/75 are amended to ride them**; **81** repoints
the Guild Hall onto the live presence feed. Everything else in the board plan (71–73, 76, 77) is unchanged.

## Transport rationale (OSS survey + graduation trigger)

**The transport is off-the-shelf; only the semantics are ours.** HTTP POST + SSE (Express + EventSource)
is the standard, universal wire. The "bespoke" part is ~200 lines of app glue: a TTL presence table, a
message ring-buffer, a doorbell flag, room tags. This is *less* code than integrating and operating any
server — so it is not NIH, provided we honestly name the one good OSS fit and why it loses today.

**The consumer model decides it.** Consumers are bursty, loop-tick agents that *compact and restart* — not
persistently-connected chat clients. They need offline delivery + a doorbell that surfaces owed messages on
next wake (the `grim mm news` pattern). That is a hub-holds-state + catch-up model, which the standards
either fight or make you build anyway:

- **Matrix** (Dendrite/Conduit) — the *real* off-the-shelf contender. Its `/sync` since-token model IS our
  doorbell/catch-up; offline delivery + rooms + presence are native; Discord/IRC bridges exist. Declined
  **today** only on operational weight: a homeserver = a new SPOF (mesh-lite), per-agent tokens + room-join,
  the room-state DAG — a bad trade vs. ~200 lines of glue for ~15 LAN agents on a hub we already run.
  **This is the graduation target, not a rejection.**
- **XMPP/ejabberd** — presence via persistent connection (wrong model for compacting sessions) + new daemon.
- **IRC** — no offline delivery (breaks the wake-on-doorbell), weak presence, new daemon. Its one pull
  (humans join with native clients) is better served by the planned Discord window.
- **Mattermost/Rocket.Chat/Zulip** — human-chat products (Postgres, heavy) shoehorned onto machine presence.
- **NATS/MQTT/Redis** — transport+pubsub, but you still build presence/doorbell/offline on top. NATS stays
  the parked answer for capability-*routed work distribution*, not chat.

**Real-time is already covered, and the transport is swappable.** This is not poll-only: terminal agents use
`news`+`hail` (doorbell), **connected agents hold `listen` (SSE) open and get instant push** — same endpoint,
no redesign; a future real-time agent just heartbeats faster. And because grim-server owns the *state* behind
a stable client contract (`grim commons …` + `/api/commons`), the **transport underneath is swappable**: you
can put Matrix (or NATS) behind the same contract later without breaking a caller.

**Graduation trigger (record so it's neither NIH-forever nor a surprise rewrite):** swap the guts to **Matrix
behind the `grim commons` contract** when ANY of these hold — (a) many persistently-connected consumers make
SSE fan-out strain, (b) federation across networks is needed, or (c) humans demand native (non-Discord)
clients. Until then: standard transport (HTTP/SSE) + minimal glue, no new daemon.

## Out of scope / do NOT

- No NATS / new daemon / new SPOF. No Discord as substrate (optional window only).
- No committing Commons chat to the KB (ephemeral ring-buffer); a session may still *choose* to
  `tome_remember` something it learned, but the channel itself isn't persisted to the graph.
- Do not replace `.mm` — the pact keeps its structured channel.
