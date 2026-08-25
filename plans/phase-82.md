# Phase 82 — Research: OOM guards (`grim-research` + `grim-archaeologist`)

**Authority:** hierophant, 2026-08-24. **Repo:** grimoire. **Track: G-v3 (research durability).**
**Depends on:** nothing — **PRIORITY jump-ahead** of the bounty board (research is ~100% broken now).

## Why

Empirically confirmed 2026-08-24 from `~/.config/flimflams/grim-npc.db`: **9 of the last 9 repo
dives (since 2026-08-17) crash**, every one with the identical `<--- Last few GCs --->` signature —
a **V8 heap OOM**, not a blocked page. Two unbounded accumulators cause it:

1. **`bin/grim-archaeologist.js` `walk()`** reads *every* file in a shallow-cloned repo via
   `fs.readFileSync(fullPath, 'utf8')` and retains the full content of all of them in one `files[]`
   array. ML repos (`deepseek-harness`, `minimax-h3`, `kimodo.cpp`, HF `*-GGUF`) carry weights/blobs/
   minified bundles; one large file read as a UTF-8 string blows the heap. The upload walk
   (`walk(outDir)` → `upload(rel, fs.readFileSync(...,'utf8'))`) has the same flaw.
2. **`bin/grim-research.js` `httpGet`** does `res.on('data', c => { body += c })` — no size cap, no
   `content-length`/`content-type` guard, and it follows redirects blindly. A large or binary payload
   buffers wholesale into one string.

The existing `stubJudgment` safety net ("never fall in a hole", `grim-research.js`) only runs when
`acquired.failed` is set gracefully; an OOM **hard-kills the process** before it runs, so nothing is
filed — not even a stub. Fail-loud silently became fail-silent.

## What lands

**Guards are UNCONDITIONAL** — they protect the standalone `/archaeologist` catalog path too, not just
research (semantic mode is phase 83; this phase is memory safety only).

- **`bin/grim-archaeologist.js`** — before any `fs.readFileSync(file, 'utf8')` in both walks, gate on:
  - `fs.statSync(p).size > MAX_FILE_BYTES` (const, **512 * 1024**) → skip, don't read.
  - extension skiplist (const `SKIP_EXT`): `.gguf .safetensors .bin .pt .pth .onnx .zip .tar .gz
    .7z .png .jpg .jpeg .gif .webp .pdf .mp4 .mov .wav .min.js .lock` → skip.
  - a null-byte binary sniff on the first ~4 KB (read via a small buffer, not the whole file) → skip.
  - Skipped files are noted (name + reason + size), never read into memory. Don't retain more than
    `MAX_TOTAL_BYTES` (const, **8 * 1024 * 1024**) of file content across the `files[]` array — stop
    collecting past the cap and record how many files were elided.
- **`bin/grim-research.js` `httpGet`** — cap and guard:
  - Reject up front if `content-length` header exceeds `MAX_BODY_BYTES` (const, **5 * 1024 * 1024**).
  - Accumulate bytes, not string concat blind: track a running length; if it exceeds `MAX_BODY_BYTES`,
    `req.destroy()` and reject with a typed reason (`body exceeds cap`).
  - Skip non-text bodies: if `content-type` is present and not `text/*`, `application/json`,
    `application/xml`, or `*+xml`/`*+json`, reject with `non-text content-type`.
  - Bound redirect following to a small hop count (const `MAX_REDIRECTS`, **5**).
- **Graceful failure path** — where `httpGet`/`digRepo` now reject on a guard, ensure the caller sets
  `acquired.failed = true` with the reason so `stubJudgment` files a reference-stub breadcrumb (the
  drop is recorded, "acquisition refused: <reason>"), never silence.

## Footprint

`bin/grim-archaeologist.js`, `bin/grim-research.js`, `test/grim-research.test.js`,
`test/grim-archaeologist.test.js` (add if absent).

## Success checks

- **Repro-guard:** a fixture "repo" dir containing a 20 MB `.safetensors` (or a sparse large file) +
  a normal `.js` → `walk` returns the `.js` analysis and **skips** the big file by size; peak RSS
  stays bounded (no OOM). Assert the skip is recorded with reason `size`.
- **Binary skip:** a file with null bytes in the first 4 KB is skipped with reason `binary`.
- **httpGet cap:** a mock server streaming > 5 MB → `httpGet` rejects with `body exceeds cap` and the
  socket is destroyed (no unbounded growth). A `content-type: application/octet-stream` response →
  rejected with `non-text content-type`.
- **Breadcrumb:** a dive whose acquire is refused by a guard files a **stub entity** (dry-run assert
  on the judgment path) with the drop preserved — not a hard crash, not silence.
- `node --test test/grim-research.test.js test/grim-archaeologist.test.js` green; full suite green +
  self-terminating.

## Out of scope

- Semantic dig mode / reframed synthesis — **phase 83**.
- Durable research queue and `--timeout 0` fire-and-forget — **phase 84** (+ the phase-68 timeout
  refresh it depends on).
- Swandive transport/backfill — **phase 85**.
- No change to what the archaeologist *concludes* — this phase only stops it reading things it must
  not. Reddit/JS-render acquire gap is untouched (separate, not the crasher).
