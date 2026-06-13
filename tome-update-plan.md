# Plan: `tome_update` — Grimoire MCP upsert capability

## Problem

`tome_remember` rejects writes to existing entities with `{ ok: false, reason: "duplicate" }`.
There is no way to correct a stale KB entry from within a session without SSH + manual JSON editing.

Discovered during: redux-mmllm vs muscleLLM audit (2026-04-19). Two KB entries had wrong
descriptions; no tool existed to fix them in-session.

---

## Goal

Add a `tome_update` tool to the Grimoire MCP server that merges new data into an existing entity
and rebuilds graph edges — callable from any Claude session the same way `tome_remember` is.

---

## Implementation

### 1. Locate the server

Grimoire plugin source: `/home/vgvm/src/me/grimoire/plugin`
(symlinked from `~/.claude/plugins/cache/grimoire` or `data/claude-plugins/plugins/grimoire`)

Find the tool registration file — likely `server.js`, `index.js`, or `tools.js` in the plugin root.
`tome_remember` is the reference implementation to follow.

### 2. Add `tome_update` tool

**Input schema** (all fields except `id` are optional — only provided fields are changed):

```json
{
  "id":          "project_redux_mmllm",   // required — target entity
  "description": "...",                   // optional — replaces existing
  "name":        "...",                   // optional — replaces existing
  "tags":        ["a", "b"],             // optional — replaces existing tag array
  "relationships": { "related_to": [] }  // optional — merges into existing edges
}
```

**Behaviour:**
- Load the entity JSON file by ID
- For each provided field: overwrite (description, name, tags) or deep-merge (relationships)
- Write the updated JSON back to disk
- Rebuild graph edges for any changed relationships (same as `tome_remember` post-write step)
- Set `metadata.dateModified` to today
- Return `{ ok: true, id: "..." }` on success

**Do NOT:**
- Change `@type`, `@id`, or `file` path
- Wipe fields that were not provided in the call

### 3. Register the tool in the MCP manifest

Add `tome_update` alongside `tome_remember` in whatever tool list / schema export the server uses.
Plugin cache at `~/.claude/plugins/cache/` needs a manual sync after editing source
(known issue from 2026-04-19 session — `cp -r` or symlink re-point).

### 4. Smoke test

```
# Correct the stale redux-mmllm entry:
tome_update({
  id: "project_redux_mmllm",
  description: "The canonical, most complete muscleLLM implementation..."
})

# Verify:
tome_recall({ query: "project_redux_mmllm" })
# → should return updated description
```

---

## Stretch: upsert mode in `tome_remember`

Alternatively (or additionally), add a `force: true` parameter to `tome_remember` that triggers
the same merge logic instead of rejecting on duplicate. Keeps the API surface smaller.

---

## Stale entries to fix once `tome_update` is live

| Entity ID | What's wrong | Correct value |
|---|---|---|
| `project_redux_mmllm` | "Predates muscleLLM's flatfile persona cleanup" — wrong, it's the more complete impl | See audit notes 2026-04-19 |
| `project_musclellm` | Describes full class methods that don't exist in muscleLLM.py (it's truncated ~242 lines) | Note truncation, mid-refactor state, valerie comments at lines 153+165 |
