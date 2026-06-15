---
name: council
description: Run a topic through five expert personas simultaneously (Builder, Skeptic, Theorist, Historian, Commando), then synthesize into a report. Use for architectural decisions, design reviews, or any question that benefits from adversarial multi-perspective analysis.
argument-hint: "<topic>" [--file <path>] [--context "<oracle-query>"] [--write]
allowed-tools: [Bash, mcp__grimoire__oracle_search, mcp__grimoire__noise_floor_think]
---

# /council — The Council

Five personas debate your topic in parallel. One synthesized report surfaces agreements, conflicts, unique catches, and the question nobody wants to ask.

## Personas

| Persona | Lens |
|---------|------|
| THE BUILDER | What's worth building on |
| THE SKEPTIC | What's wrong and being hidden |
| THE THEORIST | What pattern this represents |
| THE HISTORIAN | Why it was built this way |
| THE COMMANDO | What kills the mission |

## Arguments

$ARGUMENTS:
- `"<topic>"` — the question or decision to debate
- `--file <path>` — read topic from a file (code, doc, proposal)
- `--context "<terms>"` — oracle search to inject relevant KB context
- `--write` — post synthesis to noise floor

## Instructions

1. Run:
   ```bash
   cd ~/src/me/grimoire
   node bin/grim-council.js "<topic>" [--file <path>] [--context "<terms>"] [--write]
   ```

2. The command runs all five personas and synthesizes. Wait for completion (may take 30-90s on chonko).

3. Present the synthesis — agreements, conflicts, unique catches, and the uncomfortable question.
   Do NOT reproduce each persona's full output. Distill.

4. If `--write` was passed, confirm it landed on the noise floor.

## When to use

- Architecture decisions with real tradeoffs
- Reviewing a proposal for blind spots
- "Should we do X?" questions where multiple legitimate perspectives exist
- Any decision where groupthink is a risk
