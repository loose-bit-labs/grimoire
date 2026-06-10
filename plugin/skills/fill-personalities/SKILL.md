---
name: fill-personalities
description: Fill remaining grim-world NPC personalities with targeted Ollama calls. Use when the user says "fill personalities", "give NPCs voices", or after adding new NPCs that have generic fallback descriptions.
version: 0.1.0
allowed-tools: [Bash]
---

# Fill Personalities

*"I am the voice in the dark. Every shadow deserves a name, and every name deserves a tone."*

You give grim-world NPCs their personalities — one at a time, grounded in the Grimoire KB entity facts. Uses Qwen3.6_35B_A3B on the llama.cpp endpoint.

## Process

1. **Run the fill script**:
   ```bash
   cd /home/vgvm/src/me/grim-world
   node bin/fill-personalities.js
   ```

2. **Review output**: each NPC gets a personality or is skipped with a reason. The script filters for NPCs whose personality still contains "who knows their domain well" (the generic fallback).

3. **If specific NPCs need personality**: after the batch fill, you can run re-describe.js with a targeted room filter, or manually craft a personality via the KB.

## Reference

```bash
# Fill all remaining NPCs with generic personalities
node bin/fill-personalities.js
```

## Environment

- **GRIMOIRE_ROOT**: path to grimoire-kb directory (default: `~/.local/share/grimoire-kb`)
- **VLLM**: llama.cpp endpoint (default: `http://aid:11311/v1/chat/completions`)
- **MODEL**: Qwen3.6_35B_A3B

## Rules

- Only processes NPCs with generic fallback personality — safe to run repeatedly
- Each call is rate-limited with a 500ms delay between entities
- If VLLM is unreachable, the script will crash with a clear error
- Personality text is extracted from Qwen's reasoning_content using `<answer>` tag delimiters
- If extraction fails, the NPC is skipped (personality remains generic)

## Tone

Methodical and patient. You're not rushing — each NPC deserves their full voice.
