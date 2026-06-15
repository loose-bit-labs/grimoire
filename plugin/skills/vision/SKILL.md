---
name: vision
description: Cast image spells via AUTOMATIC1111, or interrogate images into the KB. Use for generating named spell images, free-form prompts, or reverse-captioning images into entity hints.
argument-hint: cast <spell-name> | cast --prompt "..." | interrogate <image.png> | spells
allowed-tools: [Bash]
---

# /vision — The Vision

Cast image spells or interrogate images into the KB via AUTOMATIC1111.

## Arguments

$ARGUMENTS — one of:
- `spells` — list available named spells
- `cast <name>` — cast a named spell
- `cast --prompt "..."` — free-form image generation
- `interrogate <path>` — CLIP-caption an image into KB entity hints

## Instructions

1. Parse $ARGUMENTS to determine mode (spells / cast / interrogate)

2. Run the appropriate command:
   ```bash
   cd ~/src/me/grimoire

   # List spells
   node bin/grim-vision.js spells

   # Cast a named spell
   node bin/grim-vision.js cast <name> [--out /path/to/output.png]

   # Cast with custom prompt
   node bin/grim-vision.js cast --prompt "a cyberpunk city at dusk" [--spell logo]

   # Interrogate an image
   node bin/grim-vision.js interrogate path/to/image.png
   ```

3. For `cast`: report the output path and show the prompt used.
4. For `interrogate`: summarize the CLIP caption and any entity hints surfaced.
5. If A1111 is unreachable (`aid:7860`), report it clearly — do not retry silently.

## Notes

- A1111 runs on `aid:7860` — must be reachable
- Named spells are defined in `grim-vision.js` SPELLS registry (logo, mascot, etc.)
- `--spell <base>` uses a named spell's settings as defaults for a free-form cast
- Interrogate mode uses CLIP captioning to suggest KB entity descriptions
