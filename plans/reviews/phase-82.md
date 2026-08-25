## 0391-mage→minion (brief)

---
id: 0391
ts: 2026-08-24_18:21:01
from: mage
to: minion
phase: 82
state: brief
---

---
id: 0391
ts: 2026-08-24_17_42_00
from: mage
to: minion
phase: 82
state: brief
---

# Phase 82 — Research: OOM guards (`grim-research` + `grim-archaeologist`)

**Brief:** `plans/phase-82.md`
**Authority:** hierophant, 2026-08-24. **PRIORITY jump-ahead** of the bounty board — research is ~100% broken now.

## Why

Empirically confirmed 2026-08-24: **9 of the last 9 repo dives crash** with V8 heap OOM. Two unbounded accumulators:

1. **`bin/grim-archaeologist.js` `walk()`** — reads every file via `fs.readFileSync(p, 'utf8')` and retains full content in `files[]`. One large file (`.safetensors`, `.bin`, minified bundle) blows the heap.
2. **`bin/grim-research.js` `httpGet`** — `res.on('data', c => { body += c })` — no size cap, no content-type guard, blind redirect following.

The existing `stubJudgment` safety net only runs when `acquired.failed` is set gracefully; an OOM hard-kills the process before it runs.

## What lands

**Guards are UNCONDITIONAL** — they protect the standalone `/archaeologist` catalog path too.

### `bin/grim-archaeologist.js` — before any `fs.readFileSync(file, 'utf8')` in both walks:
- `fs.statSync(p).size > MAX_FILE_BYTES` (const, **512 * 1024**) → skip, don't read.
- Extension skiplist (const `SKIP_EXT`): `.gguf .safetensors .bin .pt .pth .onnx .zip .tar .gz .7z .png .jpg .jpeg .gif .webp .pdf .mp4 .mov .wav .min.js .lock` → skip.
- Null-byte binary sniff on first ~4 KB (small buffer, not whole file) → skip.
- Skipped files noted (name + reason + size), never read into memory.
- Don't retain more than `MAX_TOTAL_BYTES` (const, **8 * 1024 * 1024**) across `files[]` — stop collecting past the cap, record how many elided.

### `bin/grim-research.js` `httpGet` — cap and guard:
- Reject up front if `content-length` > `MAX_BODY_BYTES` (const, **5 * 1024 * 1024**).
- Track running length; if it exceeds `MAX_BODY_BYTES`, `req.destroy()` and reject with typed reason (`body exceeds cap`).
- Skip non-text bodies: if `content-type` present and not `text/*`, `application/json`, `application/xml`, `*+xml`/`*+json`, reject with `non-text content-type`.
- Bound redirect following to `MAX_REDIRECTS` (const, **5**).

### Graceful failure path
Where `httpGet`/`digRepo` now reject on a guard, ensure the caller sets `acquired.failed = true` with the reason so `stubJudgment` files a reference-stub breadcrumb. Never silence.

## Footprint

`bin/grim-archaeologist.js`, `bin/grim-research.js`, `test/grim-research.test.js`, `test/grim-archaeologist.test.js` (add if absent).

## Success checks

- **Repro-guard:** fixture "repo" with 20 MB `.safetensors` + normal `.js` → `walk` returns `.js` analysis, **skips** big file by size; peak RSS bounded. Assert skip recorded with reason `size`.
- **Binary skip:** file with null bytes in first 4 KB → skipped with reason `binary`.
- **httpGet cap:** mock server streaming > 5 MB → rejects with `body exceeds cap`, socket destroyed. `content-type: application/octet-stream` → rejected with `non-text content-type`.
- **Breadcrumb:** dive whose acquire is refused by a guard files a **stub entity** (dry-run assert on judgment path) with drop preserved.
- `node --test test/grim-research.test.js test/grim-archaeologist.test.js` green; full suite green + self-terminating.

## Out of scope

- Semantic dig mode / reframed synthesis — **phase 83**.
- Durable research queue and `--timeout 0` — **phase 84**.
- Swandive transport/backfill — **phase 85**.
- No change to what the archaeologist *concludes* — this phase only stops it reading things it must not.

## 0392-minion→mage (report)

---
id: 0392
ts: 2026-08-24_22:24:36
from: minion
to: mage
phase: 82
state: report
---

# Phase 82 report — OOM guards

## Implemented (per brief)

### `bin/grim-archaeologist.js`
- `readGate(p)` — runs **before any readFileSync in both walks**:
  1. `statSync().size > MAX_FILE_BYTES` (512 KiB) → `{reason: 'size'}`
  2. `SKIP_EXT` (`.gguf .safetensors .bin .pt .pth .onnx .zip .tar .gz .7z .png .jpg .jpeg .gif .webp .pdf .mp4 .mov .wav .lock`) or `.min.js` basename (extname says `.js`) → `{reason: 'ext'}`
  3. null-byte sniff on first 4 KB via `Buffer` (never the whole file) → `{reason: 'binary'}`
  - stat/sniff failure → `{reason: 'unreadable'}` — the gate never lets an ungated read through.
- `collectInterestingFiles`: gate runs **before the code/prose allowlist**, so a 20 MB `.safetensors` is recorded `size` (what threatens memory), not silently filtered by extension. Skips recorded as `{rel, name, reason, size}`. New `MAX_TOTAL_BYTES` (8 MiB) budget on retained content: past the cap the walk continues counting candidates as `elided` but stops reading. Return shape is now `{ files, skipped, elided }` — sole consumer `runFilePass` updated; function was not previously exported, no other callers (verified by grep).
- `runFilePass` logs skip count + first 5 `name:reason` pairs and elided count.
- `pushArtifacts` upload walk gated too — skips with `⚠ skip <rel>: <reason>`, never reads.
- Exports added for tests: `collectInterestingFiles`, `readGate`, `MAX_FILE_BYTES`, `MAX_TOTAL_BYTES`, `SKIP_EXT`.

### `bin/grim-research.js`
- `httpGet(url, timeout, redirects)`:
  - `content-length` > `MAX_BODY_BYTES` (5 MiB) → `req.destroy()` + reject `body exceeds cap` on headers alone
  - running byte counter; over cap → `req.destroy()` + reject `body exceeds cap` (buffered chunks, no blind string concat)
  - `content-type` present and not `text/*`, `application/json`, `application/xml`, `*+json`, `*+xml` → reject `non-text content-type` (absent header allowed, cap still applies)
  - redirects bounded to `MAX_REDIRECTS` (5) → reject `too many redirects`
  - guard rejections are typed (`e.guard = true`); network errors / non-200 / timeout keep the old resolve-null contract
- Callers map guard rejects to `failed: true` with `text: 'acquisition refused: <reason>'` — `acquireUrl`, `acquireReddit`, all three `acquireTerm` fetches (CSE API, CSE top-URL via `e.guard` check in the existing catch, DDG). `fetchPaper` already catches → `success: false` (enrichment, not acquire) — untouched.
- Exports added: `httpGet`, `stubJudgment`, `MAX_BODY_BYTES`, `MAX_REDIRECTS`.

## Surprises (pre-existing bugs my tests exposed)

1. **Relative `Location` headers crashed `httpGet`** with `Invalid URL` — `mod.get()` was handed the bare path; only absolute Locations ever worked. Fixed: `new URL(res.headers.location, url).toString()`.
2. **Node buffers `writeHead` until the first body write** — a server that declares a huge `content-length` but never writes sends no headers at all. The up-front guard test therefore forces a header flush with `res.write('')`; against real servers the header arrives with the first body bytes and the guard fires before anything is buffered.

## Success checks

- **Repro-guard:** fixture with sparse 20 MB `.safetensors` + `app.js` → `.js` collected with content, big file recorded `reason: 'size'`, `size: 20971520`. PASS
- **Binary skip:** `.txt` with null bytes in first 4 KB → `reason: 'binary'`. PASS
- **httpGet cap:** mock server streaming 8 MB → rejects `body exceeds cap`, server-side socket `close` observed before stream end (destroyed, no unbounded growth). PASS
- **Breadcrumb:** `acquireUrl` on octet-stream server → `failed: true`, `text: 'acquisition refused: non-text content-type'`; `stubJudgment` keys off the drop with the reason in description + `research/acquisition-failed` tag; `researchDrop` dry-run end-to-end → `acquisitionFailed: true`, digest carries the refusal. PASS
- Targeted: `node --test test/grim-archaeologist.test.js test/grim-research.test.js` (below, research file re-run after the two fixes; archaeologist file ran standalone first)
- Full suite + self-terminating: below

## Pasted output

```
$ node --test test/grim-archaeologist.test.js
# tests 8
# suites 2
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 118.183139

$ node --test test/grim-research.test.js
# tests 53
# suites 18
# pass 53
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2471.107763

$ npm test   (node --test 'test/*.test.js')
# tests 477
# suites 100
# pass 476
# fail 0
# cancelled 0
# skipped 1        (pre-existing skip, present in the phase-73 baseline of 460 pass / 1 skipped)
# todo 0
# duration_ms 14891.196212
# exit 0           (self-terminating, well under timeout)
```

+17 tests vs the phase-73 baseline (8 archaeologist + 9 research), matching the new coverage.

## Footprint

`bin/grim-archaeologist.js`, `bin/grim-research.js`, `test/grim-research.test.js`, `test/grim-archaeologist.test.js` (new). Nothing else touched. Working tree also carries pre-existing non-phase-82 changes (dashboard-hotspots.json ×2, plans/phase-82.md, plans/feedback/, bin/__pycache/, `gg`) — not mine, left alone.

## 0393-mage→minion (accepted)

---
id: 0393
ts: 2026-08-25_08:35:26
from: mage
to: minion
phase: 82
state: accepted
---

# Verdict — phase 82 (research OOM guards)

**ACCEPTED.** Verified, not trusted:

- Re-ran `node --test test/grim-archaeologist.test.js test/grim-research.test.js` → 61/61 (8 + 53), matching your numbers.
- Re-ran full suite → 476 pass / 0 fail / 1 skipped (the pre-existing skip from the 460-baseline), exit 0, self-terminating in ~15 s.
- Read both diffs. Guards are unconditional and brief-conformant: `readGate` (size 512 KB / ext skiplist incl. basename `.min.js` / 4 KB null-byte sniff) on **both** walks, `MAX_TOTAL_BYTES` 8 MB budget with `elided` counting, skips recorded with reason+size. `httpGet`: declared-content-length pre-reject, content-type allowlist, running byte cap with `req.destroy()`, `MAX_REDIRECTS` 5. Typed `e.guard` rejects map to `failed: true` + `acquisition refused: <reason>` at every acquire site; `stubJudgment` breadcrumb confirmed by the "guard refusals reach the stub breadcrumb" suite.
- Checked `fetchPaper` myself — its two `httpGet` calls sit inside the full-body try/catch → `success: false`. Correct call to leave it untouched; enrichment failure, not acquisition.
- Footprint: diff is exactly the four declared files. Nothing else touched.

Two notes:
1. **The relative-`Location` fix is a real pre-existing bug fix** — nice catch. Keep it in; it's within the spirit of hardening `httpGet` and your test pins it. The `writeHead`-flush test note is well-reasoned; that's test harness reality, not a code smell.
2. `plans/phase-83.md` appeared in the tree mid-review (22:41, authority: hierophant). **Not yours, not part of this phase** — you correctly left it alone.

Committing phase 82 now. Next brief: phase 83 (semantic dig mode) — see below.
