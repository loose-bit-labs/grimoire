---
name: blender-facades
description: Generate tileable building facade textures via A1111 + DiffuseTexture_v11 LoRA and load them into a Blender scene. Use when building an architectural or city scene that needs convincing, repeating facade textures (glass skyscraper, concrete, brick, dark steel, etc.).
version: 1.0.0
allowed-tools: Bash, Read, Write
---

# THE FACADE PAINTER

You pull architecture textures out of thin air and stamp them onto buildings. One LoRA, four facades, infinite city.

## Arguments

- **output dir** (optional): where to save PNGs — defaults to `/tmp/city_tex/`
- **texture list** (optional): custom building types beyond the defaults

## The LoRA

`DiffuseTexture_v11` is the key. It forces A1111 to produce tileable, seamless surface textures rather than complete scenes. Without it the model generates random scenes instead of facade panels.

Always append `<lora:DiffuseTexture_v11:1>` to the prompt.

## A1111 endpoint

Read from `~/.config/lbl-config.json` — never hardcode:

```js
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

function a1111Url() {
  try {
    const cfg = JSON.parse(readFileSync(path.join(homedir(), '.config', 'lbl-config.json'), 'utf8'));
    const host = cfg.use?.a1111 ?? 'superack';
    return cfg.endpoints?.[host] ?? `http://${host}:7860`;
  } catch { return 'http://superack:7860'; }
}
```

The current A1111 host is `superack` at port 7860 (as of 2026-06-29).

## Generation parameters

```js
{
  prompt: `<your building type description> <lora:DiffuseTexture_v11:1>`,
  negative_prompt: 'people, cars, sky, trees, logo, text, blurry, low quality',
  width: 512, height: 512,
  steps: 30, cfg_scale: 7,
  sampler_name: 'DPM++ 2M',
  batch_size: 1,
}
```

Endpoint: `POST ${A1111}/sdapi/v1/txt2img`
Response: `data.images[0]` is a base64 PNG.

## Default texture set (city scenes)

| Name | Prompt prefix | Use for |
|------|--------------|---------|
| `facade_glass` | `Exterior window texture of glass skyscraper, blue tinted curtain wall, reflective panels` | Downtown towers |
| `facade_concrete` | `Exterior window texture of brutalist concrete office building, gray panels, grid windows` | Mid-ring offices |
| `facade_brick` | `Exterior window texture of brick apartment building, red brick, rectangular windows` | Low-rise residential |
| `facade_dark` | `Exterior window texture of dark steel modern skyscraper, black cladding, narrow windows` | Prestige towers |

Always start with "Exterior window texture of..." — this framing tells the model you want a repeated panel surface, not a photo of a building.

## Loading into Blender

After generating, load the PNGs and assign them to materials:

```python
import bpy

# Load image (assumes PNG is already on disk)
img = bpy.data.images.load('/tmp/city_tex/facade_glass.png')
img.name = 'Facade_glass'

# Assign to existing material via node tree
mat = bpy.data.materials['M_GlassBldg']
# ... wire img into ShaderNodeTexImage node
```

For correct UV tiling on all 4 building faces: use two-projection triplanar UV (XZ for front/back, YZ for left/right, blended by abs(object-space normal.Y)). See `fix_uvs.py` in the city scene scratchpad for the full node setup.

## Image names in Blender

After loading, Blender uses the filename (without extension) as the image name:
- `facade_glass.png` → `bpy.data.images['Facade_glass']` (capital F — Blender capitalizes)

Check with `list(bpy.data.images.keys())` if assignment fails.

## Step-by-step

1. Read A1111 URL from `~/.config/lbl-config.json`
2. For each texture in your list: POST to `/sdapi/v1/txt2img` with DiffuseTexture_v11 LoRA in prompt
3. Decode base64 PNG and write to output dir
4. Send a Blender Python script (via blender-mcp) that loads each PNG with `bpy.data.images.load()`
5. Wire images into material node trees with triplanar UV projection

## Rules

- Never hardcode the A1111 hostname — always resolve from `lbl-config.json`
- Always include `<lora:DiffuseTexture_v11:1>` — without it textures look like scenes, not surfaces
- Keep negative prompt broad: `people, cars, sky, trees, logo, text, blurry, low quality`
- 512×512 is sufficient for Blender tile textures; 768×768 if detail matters at close range
- `DPM++ 2M` at 30 steps is the sweet spot — faster samplers produce muddy results
- Refactor candidate: `gen_facades.mjs` hardcodes `superack:7860` — update to use lbl-config.json pattern before reuse

## Tone

Brisk. Four textures in 30 seconds, load them, done. Don't overthink the prompts — the LoRA does the heavy lifting.
