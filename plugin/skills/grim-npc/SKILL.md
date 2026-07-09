---
name: grimoire:grim-npc
description: Read-only inspector for grim-npc SQLite databases — list NPCs, dump memories, view conversations, check context snapshots, list assets/portraits, run health diagnostics
version: 1.1.0
allowed-tools:
  - Bash
---

# GRIM-NPC INSPECTOR

You are THE ARCHAEOLOGIST — you dig into grim-npc databases and surface what's alive.

## Arguments

`<db_path>` — optional path to the grim-npc SQLite database (default: `grim-npc.db` in the repo root)

## What it does

grim-npc is a shared embedded Node library for NPC identity, conversation, memory, and capabilities. It stores everything in one SQLite file (WAL mode). This tool is the read-only inspector — poke around without touching anything.

## Invocation

```bash
# From the grim-npc repo root
node bin/grim-npc.js <subcommand> [args] --db <path>
```

If `--db` is omitted, defaults to `./grim-npc.db` in the current working directory.

## Subcommands

### `npcs` — roster listing
```bash
node bin/grim-npc.js npcs --db <path>
```
Lists all NPCs in the scoped world: slug, name, skill count, memory count.

### `npc <slug>` — single NPC detail
```bash
node bin/grim-npc.js npc <slug> --db <path>
```
Shows full NPC record: slug, world, name, personality, description, appearance_short, goals, fallback, skills (array), updated_at, memory_count.

### `memories <slug>` — NPC memories
```bash
node bin/grim-npc.js memories <slug> --db <path>
```
Lists memories for an NPC, scoped to `--world` like other subcommands (use `--world '*'` for all worlds). Shows subject_slug, subject_type, last_interaction (relative), interaction_count, and summary.

### `chats` — conversation listing
```bash
node bin/grim-npc.js chats [--open] [--room <roomSlug>] --db <path>
```
Lists conversations with room slug, room name, participant count, message count, and start/close time. `--open` filters to active only (no `closed_at`). `--room` filters by room slug.

### `transcript <id>` — ordered message replay
```bash
node bin/grim-npc.js transcript <id> --db <path>
```
Replays all messages from a conversation in order (by seq), showing from_name, text, and timestamp.

### `context <slug>` — headline command: full context snapshot
```bash
node bin/grim-npc.js context <slug> --db <path>
```
Shows what `buildContext` would produce for an NPC: the NPC record, active conversations, relevant memories. This is the exact data flow that feeds into an LLM call.

### `stats` — database row counts
```bash
node bin/grim-npc.js stats --db <path>
```
Counts rows in every table: npcs, conversations, messages, memories, assets, migrations.

### `doctor` — health check
```bash
node bin/grim-npc.js doctor --db <path>
```
Runs diagnostics:
- Open conversations (active but no recent message)
- NPCs without memories (potential data gap)
- Memory orphans (message references to non-existent messages)
Exits non-zero if anomalies found.

### `assets <ownerType> <ownerId>` — list media assets
```bash
node bin/grim-npc.js assets <ownerType> <ownerId> --db <path>
```
Lists assets (kind, mime, uri, caption) attached to an owner (e.g. `npc` + slug). Assets are file refs, never DB blobs.

### `portrait <slug>` — NPC portrait lookup
```bash
node bin/grim-npc.js portrait <slug> --db <path>
```
Shows the portrait asset (kind, mime, uri, caption) for an NPC, or nothing if none is set.

## Flags

All subcommands accept:
- `--db <path>` (`-d`) — path to the SQLite database
- `--world <world>` (`-w`) — scope queries to a specific world (default: `default`)
- `--world '*'` — scope queries across ALL worlds
- `--json` (`-j`) — output as JSON instead of human-readable tables

## World scoping

grim-npc uses `world` as a queryable dimension (tenant/save-slot/shard key). Default queries scope to the constructor world. Use `--world '*'` to search across all worlds — useful when an NPC exists in multiple save slots.

## Rules

- Read-only — never modify the database
- If `--db` path doesn't exist, check `~/.config/lbl-config.json` for the `grimNpcDbPath` key (the standard shared-config location)
- Skills are stored as JSON strings in SQLite; the CLI parses them to arrays for display
- If the database is locked (WAL contention), retry once after a short pause
