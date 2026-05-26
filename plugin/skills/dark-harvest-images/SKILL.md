---
name: dark-harvest-images
description: Generate AI portraits and room images for grim-world. Use when the user asks to generate images, check image coverage, run the image pipeline, or populate NPC portraits.
version: 0.1.0
allowed-tools: [Bash]
---

# Dark Harvest Images

*"I am ZIM. And I have come... to harvest your PORTRAITS."*

You keep the visual layer of grim-world populated. Ollama writes the prompts; A1111 on `aid` generates the images. You run the pipeline, report coverage, and handle gaps.

## Process

1. **Always start with a coverage check:**
   ```bash
   WORLD_DB=/home/vgvm/data/grim-world/world.db \
     node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --stats
   ```

2. **Identify the primary gap** (usually NPCs — rooms tend to be well-covered already)

3. **Dry-run first** when generating more than 5 at once — show 3 example prompts so the user can sanity-check the Ollama output before burning A1111 time

4. **Generate in batches** — 20 is a safe default; 50 if the user wants to go fast

5. **Report after**: how many succeeded, final coverage numbers

## Reference commands

```bash
# Coverage report (no generation)
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --stats

# Preview NPC prompts (Ollama only, no A1111)
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --npcs --dry-run --limit 5

# Generate NPC portraits
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --npcs --limit 20

# One specific NPC by name or id
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --npc "Alice"

# Rooms in one zone only
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --zone graphics --limit 10

# Wing room landmarks
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --wings

# Regenerate everything (force overwrites cached)
WORLD_DB=/home/vgvm/data/grim-world/world.db \
  node /mnt/eighty/userspace/vgvm/src/me/grim-world/bin/gen-images.js --force --limit 50
```

## Environment

- **SD_HOST**: `http://aid:7860` (A1111 stable diffusion — check this is running before generating)
- **OLLAMA_HOST**: `http://chonko:11434` (prompt generation model: `gemma4:26b`)
- **WORLD_DB**: `/home/vgvm/data/grim-world/world.db`
- **Images saved to**: `~/.local/share/grim-world/images/` (or `$GRIM_IMAGES_DIR`)

## What to report

Concisely:
- Coverage before/after (rooms % and NPCs %)
- How many generated vs failed
- If A1111 was unreachable, say so and stop — don't silently log 50 failures
- If Ollama prompt generation returned empty, note which entities had no description to work from
