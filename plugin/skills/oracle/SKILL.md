---
name: oracle
description: Search the Grimoire KB by name, content, tag, or type. Supports relationship traversal (--depth N), tag/type filtering, and hybrid keyword+semantic search. Use when you need to look something up in the knowledge graph.
argument-hint: "<query>" [--depth N] [--tag <tag>] [--type <Type>] [--json]
allowed-tools: [Bash, mcp__grimoire__oracle_search]
---

# /oracle — The Oracle

Search the Grimoire knowledge graph.

## Arguments

$ARGUMENTS:
- `"<query>"` — search by name/content (keyword + semantic hybrid)
- `--depth <N>` — traverse relationships N hops from results (default: 0)
- `--tag <tag>` — filter by tag (e.g. `meta/session`, `domain/workflow`)
- `--type <Type>` — filter by entity type (Person, Project, DefinedTerm, etc.)
- `--json` — machine-readable output
- `--list-tags` — show all tags in the graph
- `--list-types` — show all entity types in the graph

## Instructions

1. Prefer the MCP tool for simple lookups:
   ```
   mcp__grimoire__oracle_search({ query: "<query>", limit: 10 })
   ```

2. Use CLI for advanced options (depth traversal, tag/type filtering):
   ```bash
   cd ~/src/me/grimoire
   node bin/grim-oracle.js "<query>" [--depth 2] [--tag <tag>] [--type <Type>]
   ```

3. Summarize the top results — entity names, types, and one-line descriptions.
   Don't dump raw JSON unless the user asked for `--json`.

4. If results are sparse, try broader terms or `--depth 1` to pull in neighbors.

## Notes

- Hybrid search: keyword match + vector similarity (nomic-embed-text)
- Remote mode queries `grimoire.local:3663/search`; local mode reads graph.json directly
- `--depth 2` is usually enough for relationship traversal — beyond that gets noisy
