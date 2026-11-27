# Phase 100: Research Queue Batching

**Goal:** The research queue drains in batches instead of one-at-a-time. Multiple URLs
submitted within a configurable window are digested together, saving tokens and giving
the judge better cross-reference context.

**FR reference:** FR-2 from `docs/always-on-fr.md`

## What changes

### lib/research-queue.js
- Add `claimBatch(root, max)` — claims up to `max` pending entries at once (instead of claimNext claiming one)
- Add `BATCH_WINDOW_MS` config (default 120s) — entries submitted within this window can be batched
- (No change to `claimNext` — it still works for single-entry drains)

### bin/grim-research.js
- Add `drainQueueBatch(root, { max, batchWindow, research })` — claims a batch, runs one combined research pass
- Add `--batch` flag to the drain CLI: `grim research queue drain --batch`
- `--batch-max N` to cap batch size (default 5)
- `--batch-window N` to configure the window (default 120 seconds)

### test/research-queue.test.js
- Test `claimBatch` claims multiple entries
- Test `drainQueueBatch` processes combined
- Test batching coalesces submissions within the window

## Design decisions

1. **Batch window is submission-time based** — entries submitted within `batchWindow` of each other are batched together. This is simpler than a time-window drain because it doesn't require a separate timer.

2. **Combined research, per-entity output** — the judge prompt includes all URLs with their acquired text, but each KB entity is still filed individually. The digest combines all results.

3. **Dedup still operates per-entry** — if two URLs dedup, they each return the existing entity. The batch just bundles them.

4. **Backward compatible** — `drainQueue` (single-entry) still works for existing systemd timer users. The batching is opt-in via `--batch`.

## Implementation order

1. `claimBatch` in research-queue.js
2. `drainQueueBatch` in grim-research.js
3. CLI integration (`--batch` flag)
4. Tests
5. KB entity + doc update
