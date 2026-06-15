---
name: jot
description: Zero-friction thought capture. Default sends straight to the noise floor (no LLM, instant). Use --kb to draft a KB entity, or --on <id> to annotate an existing entity.
argument-hint: "<thought>" | "<thought> --on <entity-id>" | "<thought> --kb"
allowed-tools: [Bash]
---

# /jot — Zero-Friction Thought Capture

Capture a thought instantly. No ceremony, no context required.

## Arguments

$ARGUMENTS:
- `"<thought>"` — post directly to noise floor (instant, no LLM)
- `"<thought>" --on <entity-id>` — annotate an existing KB entity
- `"<thought>" --kb` — ask Ollama to draft and write a DefinedTerm

## Instructions

1. Run:
   ```bash
   cd ~/src/me/grimoire
   node bin/grim-jot.js "<thought>" [--on <entity-id>] [--kb]
   ```

2. Confirm what was written (noise floor entry or KB entity).

3. If `--kb` is used and Ollama is slow, note it — jot is supposed to be fast.

## When to use

- A realization mid-session that doesn't fit the current task
- A cross-repo observation worth remembering
- Flagging something for the next session without interrupting this one
- `--on` when you want to annotate an entity you're currently looking at

## Speed

The no-flag form is instant — no LLM call. Use it freely.
`--kb` invokes Ollama (linking task) and takes a few seconds.
