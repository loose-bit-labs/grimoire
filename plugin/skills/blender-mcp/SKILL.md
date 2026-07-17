---
name: blender-mcp
description: Drive Blender from the CLI via the blender-mcp add-on (HTTP transport). Use when you need to run Blender Python scripts programmatically, inspect scene state, or automate geometry/material/render operations from the terminal or from Claude.
version: 1.0.0
allowed-tools: Bash, Read, Write
---

# THE BLENDER DRIVER

You script Blender via MCP. The add-on listens; you command.

## Arguments

- **action** (required): what to do — `exec <script.py>`, `tool <tool-name> [json-args]`, or `info`
- **script path** (for exec): path to the Python script to run in Blender's context

## Setup

The blender-mcp add-on must be installed and running inside Blender:
- Add-on name: "MCP" (search Extensions in Blender preferences)
- TCP port: 9876 (default, internal — Blender Python ↔ add-on socket)
- HTTP port: 9119 (exposed — the port this skill calls)
- The HTTP server is started separately: `blender-mcp --transport http --port 9119`
- Or: add-on `Auto Start` toggle enables on Blender launch

Confirm it's live before scripting: `curl -s http://127.0.0.1:9119/` should return a response (not connection refused).

## The Caller — blender.mjs

The canonical Node.js caller lives at `scratchpad/blender.mjs` (copy it next to your scripts).

**Invoke a Python script file:**
```bash
node blender.mjs exec my_script.py
```

**Invoke a named MCP tool with JSON args:**
```bash
node blender.mjs get_blendfile_summary_datablocks
node blender.mjs execute_blender_code '{"code":"import bpy; print(len(bpy.data.objects))"}'
```

**From Node.js (import):**
```js
import { callTool } from './blender.mjs';
const result = await callTool('execute_blender_code', { code: pythonString });
```

## How it works

Protocol: MCP JSON-RPC 2.0 over HTTP POST to `http://127.0.0.1:9119/`.
Response format: SSE stream — scan lines for `data:` prefix, parse JSON, extract `.result`.
Default timeout: 180s. Large scene builds may need 300s+.

The primary tool is `execute_blender_code` — sends a Python string that runs in Blender's active context. The script must assign `result = {...}` or `print()` for output; the content of the first `text` block in the MCP response is what comes back.

## Writing Blender Python scripts

Key conventions from working scripts:

```python
import bpy, bmesh, math, random

# Always clean up first — remove old objects you're replacing
for obj in list(bpy.data.objects):
    if obj.type in {"CAMERA", "LIGHT"} or obj.name in KEEP_SET:
        continue
    bpy.data.objects.remove(obj, do_unlink=True)

# Materials: use_nodes=True, clear, rebuild from scratch
m = bpy.data.materials.new("MyMat"); m.use_nodes = True
nt = m.node_tree; nt.nodes.clear()

# Geometry: use bmesh, call bm.to_mesh(me) then bm.free()
bm = bmesh.new()
bm.verts.new((x, y, z))
bm.to_mesh(me); bm.free()

# Always end with a result dict for debugging:
result = {"status": "ok", "msg": f"Built {n} objects"}
```

**Collections:** link objects to named collections, not scene root:
```python
col = bpy.data.collections.new("MyCol")
bpy.context.scene.collection.children.link(col)
col.objects.link(obj)
```

**Geometry Nodes:** reference node groups by name (`bpy.data.node_groups["GN_Tree"]`). Don't add ShaderNodes to GN trees — use `GeometryNodeInputNormal`, `FunctionNodeCompare`, etc.

## Common tools

| Tool name | What it does |
|-----------|-------------|
| `execute_blender_code` | Run arbitrary Python in Blender |
| `get_blendfile_summary_datablocks` | List all datablocks (meshes, materials, objects, node groups) |
| `get_scene_info` | Camera, render settings, active scene |

## Timeout notes

- Simple queries: 30s default is fine
- Building 100+ objects: use 180s
- Full city rebuild (300+ objects + materials): use 300s
- The script may complete even if the MCP response times out — check Blender's console

## Rules

- Never hardcode the MCP URL — it's always `http://127.0.0.1:9119/` (localhost, no auth)
- Scripts run in Blender's main thread; long scripts block the UI — that's expected
- If a script sets `result = {...}` the value comes back in the MCP response text
- Blender 5.1 renamed some socket names (e.g. Volume Principled "Scatter Color" → "Color") — check node socket names if you get KeyErrors
- `ShaderNodeVolumePrincipled` removal: collect nodes to kill list first, then remove — iterating and removing in the same loop causes stale-reference errors

## Tone

Methodical. Build, verify, iterate. When a script fails, read the error from the response text and fix the specific line — don't rewrite the whole script.
