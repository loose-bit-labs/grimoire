---
name: blender-vision
description: Give Claude eyes in a Blender scene. Assigns debug colors by object category, renders 4 camera angles via Workbench engine, saves PNGs to scratchpad so Claude can read and diagnose geometry, overlap, material, or layout problems. Use any time you can't tell what's wrong in a Blender scene without seeing it.
version: 1.0.0
allowed-tools: Bash, Read, Write
---

# THE SCENE READER

You are blind until you run this. One script, four angles, instant context.

## Arguments

- **scene** (optional): path to .blend file — if not open already, load it first via blender-mcp
- **categories** (optional): custom object category map beyond the defaults

## The Core Problem

Claude can't see Blender. Every geometry fix, material assignment, or layout decision is made blind. This spell closes that gap: assign diagnostic colors by object type, render quick multi-angle snapshots, read the PNGs back here, then act with full visual context.

## When to reach for it

- "I can't tell what's road vs sidewalk"
- "The districts seem to overlap but I'm not sure how bad"
- "Something looks wrong but I can't describe it precisely"
- "I want to verify a script worked before moving on"
- Any time the user says the scene looks off and you need to see it

## How it works

1. **Classify** each mesh object by name → material → collection (name takes priority)
2. **Set object colors** by category
3. **Switch render engine** to BLENDER_WORKBENCH with `scene.display.shading.color_type = 'OBJECT'` and `light = 'FLAT'` — this is the key step that makes colors appear without any lighting setup
4. **Render 4 angles** via `bpy.ops.render.opengl(write_still=True, view_context=False)` — `view_context=False` uses scene camera, not viewport
5. **Restore everything** — engine, shading settings, object colors
6. **Read the PNGs** here with the Read tool

## Default color palette

| Category | Color | Hex |
|----------|-------|-----|
| road | near-black | `#0F0F0F` |
| sidewalk | light concrete | `#C7BFB3` |
| building | blue | `#2E6BD1` |
| prop | yellow | `#FFD91A` |
| other | magenta | `#D91AD9` |

**Magenta = unknown** — if you see a lot of magenta, your classifier needs tuning. It's a feature, not a bug.

## Classifier priority

Name check FIRST, then materials, then collections last. Collections are often named for grouping (`Roads` contains both road and sidewalk objects), so they fire last to avoid misclassification.

```python
def classify(obj):
    name = obj.name.lower()
    mats = [s.material.name.lower() for s in obj.material_slots if s.material]
    cols = [c.name.lower() for c in obj.users_collection]

    # Name first — most specific
    if any(k in name for k in ('sidewalk', 'pavement', 'curb')): return 'sidewalk'
    if any(k in name for k in ('road', 'asphalt', 'ground', 'street')): return 'road'
    if any(k in name for k in ('globe', 'pole', 'lamp', 'light')): return 'prop'
    if 'building' in name: return 'building'
    # Patch_districts naming: A_0_0_0 / B_1_1_0
    if len(name) > 2 and name[1] == '_': return 'building'

    # Material fallback
    for m in mats:
        if 'sidewalk' in m: return 'sidewalk'
        if 'ground' in m or 'road' in m: return 'road'
        if 'lamp' in m or 'glow' in m: return 'prop'
        if any(k in m for k in ('glass', 'apartment', 'concrete', 'dark')): return 'building'

    # Collections last
    if any('sidewalk' in c for c in cols): return 'sidewalk'
    if any(c in ('roads',) for c in cols): return 'road'

    return 'other'
```

## Camera angles

Compute scene bounds from building locations, then orbit:

```python
R = span * 0.7
SHOTS = [
    ('topdown',   (cx, cy, span),                            (cx, cy, 0)),
    ('isometric', (cx + R, cy - R, span * 0.6),              (cx, cy, 0)),
    ('north',     (cx, cy - R, span * 0.3),                  (cx, cy, 0)),
    ('street',    (cx, cy - span * 0.55, 4),                 (cx, cy, 10)),
]
```

Use `direction.to_track_quat('-Z', 'Y').to_euler()` to point camera at target.

Always call `bpy.context.view_layer.update()` between camera moves.

## Geometry Nodes instances

GN instances (trees, scatter objects) inherit the **template object's** color, not the instancer. Color the template objects (TreeTemplate, LeafSphere, BranchTpl) to control how GN instances appear. They won't appear in `bpy.data.objects` as individual items but will render with the template's object color.

## What to look for

**Top-down:** district overlap (buildings at conflicting angles piling up), ground coverage, overall city shape

**Isometric:** height variation, material coverage, ground plane extent

**North/street:** proportions, tree scale vs building scale, what the space between buildings feels like

**Magenta objects:** unclassified — check their names, collections, and materials to decide where they belong

## Rules

- Always restore engine + display shading + object colors — leave the scene exactly as you found it
- `view_context=False` on the render call — without it, you get the viewport view, not the camera
- BLENDER_WORKBENCH is the right engine — EEVEE/Cycles ignore `scene.display.shading`
- Don't run this mid-animation or with complex drivers — it moves the camera object directly
- After diagnosing, run the actual fix script, then run this again to verify

## Output

Four PNGs saved to the scratchpad `snapshots/` subdirectory plus a JSON result with `inventory` (object counts by category), `scene_center`, `scene_span`, and `renders` (list of paths).

Read all four PNGs before writing fix code. Top-down first, then isometric for scale, then street level for proportions.

## Tone

Eyes open, then act. No guessing.
