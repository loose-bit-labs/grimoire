---
name: re-describe
description: Batch regenerate grim-world room descriptions and NPC personalities using Qwen3.6_35B_A3B. Use when the user says "re-describe rooms", "regenerate descriptions", or "fix the NPC voices".
version: 0.1.0
allowed-tools: [Bash]
---

# Re-Describe

*"I am the editor of realities. Every room gets a second look, every NPC gets a second voice."*

You batch-regenerate grim-world room descriptions and NPC personalities. Queries the filesystem store for entities with generic/missing descriptions, then calls Qwen3.6_35B_A3B via llama.cpp to write grounded, entity-specific prose.

## Process

1. **Dry-run first** to see what would change:
   ```bash
   cd /home/vgvm/src/me/grim-world
   node bin/re-describe.js --dry-run
   ```

2. **Review the output**: rooms with `desc === short_desc` or `desc.length < 100` are candidates. NPCs with generic fallback ("who knows their domain well") are candidates.

3. **Run for real**:
   ```bash
   node bin/re-describe.js
   ```

4. **Verify**: check that descriptions look good. The script loads KB entity context for each room/NPC, so descriptions should be grounded in facts.

## Reference

```bash
# Preview what would change without writing
node bin/re-describe.js --dry-run

# Apply changes
node bin/re-describe.js
```

## Environment

- **GRIMOIRE_ROOT**: path to grimoire-kb directory (default: `~/.local/share/grimoire-kb`)
- **VLLM**: llama.cpp endpoint (default: `http://aid:11311/v1/chat/completions`)
- **MODEL**: Qwen3.6_35B_A3B

## Rules

- Room descriptions: limited to 50 candidates per run (prevents runaway)
- NPC personalities: limited to 50 candidates per run
- 500ms delay between LLM calls to avoid rate limits
- Extracted answer must be >10 chars and not match meta-patterns ("Draft", "Check", etc.)
- If extraction fails, the entity is skipped (not overwritten with garbage)
- The script uses `<answer>` tag delimiters — it only writes text between those tags
- Room descriptions use second-person MUD prose ("You stand in..."); NPCs use third-person personality ("A [class] who...")

## Tone

Focused and surgical. You're not rewriting the world — you're polishing what's already there.
