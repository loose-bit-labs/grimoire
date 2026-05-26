---
name: think
description: Delegate heavy analysis to Ollama — use this instead of reasoning in-context about KB content, code patterns, or complex design questions. Keeps Claude's context window clean.
argument-hint: <question> [--context <search terms>] [--deep] [--persona gm|oracle|crawler|glitch]
allowed-tools: [Bash, mcp__grimoire__noise_floor_think]
---

# /think — Delegate to Ollama

Offload analysis work to local Ollama instead of burning Claude's context window.

## Arguments

Question or task: $ARGUMENTS

## When to use this

- Analyzing KB structure, patterns, or gaps
- Summarizing large sets of entities or relationships
- Architectural decisions that need system-level reasoning
- Anything where you'd otherwise read many files and reason in-context
- Connecting dots across the KB without holding it all in Claude's window

## Instructions

1. Parse $ARGUMENTS into:
   - `question` — the main question or task (required)
   - `--context <terms>` — oracle search terms to pull relevant KB context (optional but recommended)
   - `--deep` — use the dreaming model for thorough analysis (slower)
   - `--persona` — gm (default), oracle, crawler, glitch, savestate
   - `--write` — post result to noise floor

2. Run:
   ```bash
   cd ~/src/me/grimoire && node bin/grim-think.js think "<question>" [--context "<terms>"] [--deep] [--persona <name>] [--write]
   ```

3. The command will:
   - Search oracle for relevant KB context (if --context given)
   - Send question + context to Ollama
   - Return Ollama's response

4. Read the response and summarize the key insights for the user in 3-5 lines.
   Do NOT reproduce the full Ollama output — distill it.

5. If the response contains actionable next steps, surface them explicitly.

## Model routing

| Flag    | Model              | Use for                          |
|---------|--------------------|----------------------------------|
| default | qwen2.5-coder:7b   | Quick questions, linking, drafts |
| --deep  | qwen3.5:latest     | Architecture, deep analysis      |

## Example invocations

```bash
# Quick question with KB context
node bin/grim-think.js think "what should we work on next?" --context "grimoire session" --write

# Deep architectural analysis
node bin/grim-think.js think "analyze the nixe cluster and suggest how to extend it" --context "nixe" --deep --persona gm

# Code review delegation
node bin/grim-think.js think "review grim-pathfind.js for correctness and suggest improvements" --persona glitch
```

## Tone

Direct and efficient. You're using Ollama as a cognitive offload, not a chat partner.
Report the result — don't explain the mechanism.
