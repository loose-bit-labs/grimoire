---
name: ingest
description: Ingest a conversation, chat log, meeting notes, or messy transcript into the KB. Use when you have unstructured text and want Ollama to judge what's KB-worthy. Different from grim-crawl (which extracts all entities via NER) — ingest is selective, judgment-based.
argument-hint: "<file>" [--context <oracle-query>] [--format chat|meeting|diary|notes|thread] [--yes] [--dry-run]
version: 1.0.0
allowed-tools: [Bash, mcp__grimoire__oracle_search]
---

# /ingest — THE ARCHIVIST

Ruthless selectivity. Most conversation is noise. Extract only signal worth finding in 6 months.

## Arguments

$ARGUMENTS

## Ingest vs Crawl

| Tool | Input | Method | Output |
|------|-------|--------|--------|
| `grim ingest` | Conversation, transcript, notes | Ollama judges KB-worthiness | Selected durable entities |
| `grim crawl` | Structured files, code, docs | NER pipeline (GLiNER+Rebel) | All entities present |

Use ingest for: Claude Code sessions, meeting notes, chat exports, diary entries, design threads.
Use crawl for: codebases, structured documents, data files.

## Instructions

1. Parse $ARGUMENTS:
   - `file` — path to text file (or pipe via stdin)
   - `--context <query>` — oracle search to inject KB context (helps Ollama avoid duplicates)
   - `--format` — hint for input type: `chat`, `meeting`, `diary`, `notes`, `thread` (default: auto)
   - `--yes` — write without confirmation prompt
   - `--dry-run` — show extraction only, never write
   - `--source <label>` — label for entity metadata

2. If the user wants to dedup against the KB, run oracle first:
   ```bash
   grim oracle "<topic of the transcript>"
   ```

3. Run ingest:
   ```bash
   cd ~/src/me/grimoire && grim ingest <file> [--context "<query>"] [--format <type>] [--yes]
   ```

   Or pipe from stdin:
   ```bash
   cat transcript.md | grim ingest [--format chat]
   ```

4. Review the proposed entities with the user if `--yes` was not passed.

5. After writing, confirm what was added to the KB.

## What THE ARCHIVIST extracts

**Will extract:**
- Named concepts or patterns that were defined or clarified
- Decisions reached and the reasoning behind them
- Projects, tools, or systems described with enough detail to be useful standalone
- Non-obvious relationships — latent connections, dependencies
- Bugs, constraints, or quirks that would surprise future-you

**Will skip:**
- Ephemeral status ("it's working now", "done", "looks good")
- Open questions without answers
- Generic observations without specifics
- Information already present in KB context

## Rules

- Always run with `--dry-run` first if the transcript is large or sensitive
- `--context` significantly improves dedup quality — use it when you know the topic
- Format hints reshape extraction emphasis — `chat` focuses on decisions and concepts; `meeting` focuses on architecture and cross-team deps

## Tone

Selective and precise. Report what was written and why it was KB-worthy.
