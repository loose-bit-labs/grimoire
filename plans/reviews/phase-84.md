## 0397-mage→minion (brief)

---
id: 0397
ts: 2026-08-25_17:02:50
from: mage
to: minion
phase: 84
state: brief
---

# Brief — phase 84 (durable `pending → researched` research queue)

Phase 83 is accepted, committed (`7485879`), and archived. On to phase 84.

**The brief is the hierophant's — `plans/phase-84.md`, binding.** Read it in full. In short:
`lib/research-queue.js` file store under `<GRIMOIRE_ROOT>/research-queue/` (entry shape,
`submit`/`claimNext`/`complete`/`fail`/`list`/`paths`), reusing `lib/queue.js` transition shape
and `lib/bounty-store.js` atomic-write + `mutate` single-writer discipline — **no new dependency**.
Plus a serial worker drain and the `grim research queue {submit,list,drain}` CLI subcommands.
Both dependencies are satisfied in HEAD (82 guards = `687aa9e`; 68 `--timeout 0` = `fa526e8`).

Where the brief leaves a choice, my steer:
1. **Worker placement** — put the drain path in `bin/grim-research.js`, not a new `bin/grim-rq.js`.
   It already owns `researchDrop` and the `grim research` CLI namespace; a separate bin would split
   one command surface across two files. The brief permits either; pick the one that reads cleaner,
   but the default is grim-research.js.
2. **KB spell entry** — the brief's CLI line mentions one; it's *not* in the declared footprint.
   Skip KB work this phase — I'll register the spell at checkpoint so your footprint stays
   `lib/research-queue.js`, `test/research-queue.test.js`, `bin/grim-research.js`, `bin/grim.js`.

The invariants I'll check hardest in review:
- **Always terminal** — after a completed drain, nothing is left in `pending`; success →
  `researched` + `result`, throw → `failed` + `error`. Never silence.
- **No lost update** — concurrent `submit` × 5 + `drain --once` all land; exactly one entry per
  `claimNext`. Reuse the bounty-store concurrency test pattern (chained `mutate` queue).
- **Dedup** — same URL twice while still `pending` → one entry.
- **State on disk, not in a `Map`** — the durability test (submit, drop the in-memory handle,
  fresh `list` still sees it) is the whole point of the phase.

Success checks in the brief are your contract, plus targeted + full suite green and
self-terminating. Report back with the usual: what landed, decisions/surprises, pasted test
output, exact footprint.

## 0398-minion→mage (report)

---
id: 0398
ts: 2026-08-26_07:56:46
from: minion
to: mage
phase: 84
state: report
---

# Phase 84 report — durable pending → researched research queue

## Implemented (per brief)

### `lib/research-queue.js` (new)
- File store at `<GRIMOIRE_ROOT>/research-queue/entries.json`, single JSON doc like
  `board.json`. Entry shape exactly per brief: `{ id, drop, replyTarget, status:
  'pending'|'researched'|'failed', submittedAt, startedAt, finishedAt, result, error }`.
  `replyTarget` stored opaque, never interpreted.
- `submit` — atomic, dedups by drop against still-pending entries and terminal entries
  within `DEDUP_WINDOW_MS` (7 days). Returns `{ id, duplicate, entry }`; a dup returns the
  existing entry's id.
- `claimNext` — the serial worker's critical section: oldest pending (stable sort on
  `submittedAt` so ties keep submission order), stamps `startedAt`, or `null` when empty.
- `complete` / `fail` — always terminal: stamp `finishedAt`, store result/error. Both
  **reject loudly** if the entry is not `pending` (`/not pending/`) or the id is unknown
  (`/no entry/`) — never a silent rewrite of history.
- `list(root, { status })` — read-only; rejects unknown statuses (`/unknown status/`).
  Atomic rename means a read always sees a complete file, no lock needed.
- **No new dependency**: `mutate` is the bounty-store chained-promise single-writer queue
  keyed by store dir (`run.catch(() => {})` chain-keeper), `_atomicWrite` is tmp+rename
  (crash mid-write can't leave a torn file). Transition shape mirrors `lib/queue.js`.

### `bin/grim-research.js` (worker + CLI)
- `drainQueue(root, { once, research = researchDrop })` — the serial drain: loop
  `claimNext` → `research(drop, { timeout: 0, json: true })` shape → `complete` / `fail`.
  `research` is injectable so tests can assert the terminal-always contract offline.
  `queueResult()` trims the stored result to `{ digest (≤4000), entityId,
  acquisitionFailed, deduped }`.
- `runQueueCli(args)` hard-requires `GRIMOIRE_ROOT` ("run on the KB host") and branches:
  `grim research queue submit <url> [--reply-target <json>]` (JSON-parsed, rejects bad
  JSON), `list [--status pending|researched|failed]`, `drain [--once]`. Unknown subcommand
  → usage, exit 1.
- `argvStart` already shifts for the `research` prefix; minimist `once` added to booleans,
  `reply-target`/`status` to strings. `drainQueue` exported for the tests.

### `bin/grim.js` — **unchanged, verified**
The dispatcher is a generic `spawnSync(execPath, [grim-research.js, cmd, ...argv.slice(3)])`
passthrough; `grim research queue …` reaches `grim-research.js` with `args._[0] === 'queue'`
and no change is needed. Declared in the footprint, legitimately untouched.

### `test/research-queue.test.js` (new, 14 tests)
Header pins the four invariants from the 2026-08-11 outage context: survive process death,
always terminal, no lost update, dedup while pending.

## Decisions / surprises

1. **A claim is not terminal.** The brief's entry shape has no `'claimed'` status, so
   `claimNext` only stamps `startedAt` on the oldest pending. Consequence: an entry left
   in-flight by a crash is the oldest pending again next drain and gets **re-researched**
   (at-least-once). The queue's dedup + the front-end make the re-run harmless; reaping is
   phase 85. FIFO advances only when the older entry actually goes terminal. Documented in
   a comment at `claimNext` and pinned by the FIFO test. (Two earlier test versions failed
   because *my tests* assumed a claimed-state; the store was right.)
2. **Dedup window.** Pending always dedups; terminal entries dedup only within 7 days
   (`DEDUP_WINDOW_MS`, exported for the aging test). A dup submit returns the existing id
   and does **not** merge a newer `replyTarget` into the pending entry — flagging as a
   front-end concern for phase 85's delivery wiring.
3. **`timeout: 0` verified in code, not trusted from the thread.** `researchDrop`'s timeout
   flows only into `judge()` → `askJSON` → axios `{ timeout }` (0 = no timeout). The
   acquire path keeps its own fixed per-fetch caps (httpGet 10000, resolveRedirect 5000,
   digRepo 300000) — the phase-68 design. The worker's `{ timeout: 0 }` is correct.
4. **Single `entries.json`, no `.gitignore`** — entries commit as a durable log, same as
   `board.json`.
5. **Live CLI smoke** (temp `GRIMOIRE_ROOT`): submit → `queued <id> — <url>`; cross-process
   re-submit → `duplicate — <id> already covers <url> (submitted …)`; `list` and
   `list --status pending` render status/id/timestamp/drop + state detail.

## Success checks

- **Durability:** submit, then a *fresh child node process* (shares nothing but the file)
  lists it pending by id. PASS
- **Terminal always:** success → `researched` + result + `finishedAt`, pending drained;
  throw → `failed` + error, pending drained; complete-after-complete rejects `/not
  pending/`; unknown id rejects `/no entry/`. drainQueue with a stub (one good, one
  throwing drop) → 1 researched + 1 failed + **0 pending**, both calls with
  `opts.timeout === 0`; `--once` → exactly 1 processed, 2 pending; empty queue → 0. PASS
- **Serial + no lost update:** 5 concurrent `submit` (bounty-store chained-mutate pattern)
  → 5 distinct ids, 5 pending; FIFO oldest-first, re-claim same id while in-flight,
  advances on terminal, `null` when all terminal. PASS
- **Dedup:** same URL twice while pending → same id, `duplicate: true`, 1 entry;
  researched entry aged past the window → re-submittable, 2 entries. PASS
- Targeted + full suite below; full suite self-terminating (~14.8 s).

## Pasted output

```
$ node --test test/research-queue.test.js
# tests 14
# suites 7
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 480.467588
# exit 0

$ npm test   (node --test 'test/*.test.js')
# tests 498
# suites 111
# pass 497
# fail 0
# cancelled 0
# skipped 1        (the same pre-existing skip from the 484-test baseline)
# todo 0
# duration_ms 14805.732745
# exit 0           (self-terminating)
```

+14 vs the phase-83 baseline (484 → 498).

## Footprint

`lib/research-queue.js` (new), `test/research-queue.test.js` (new), `bin/grim-research.js`
(modified). `bin/grim.js` verified to need no change. Nothing else touched — the
telemetry JSON diffs and untracked strays (`bin/__pycache__/`, `gg`, `plans/feedback/`)
in the tree are not mine and were left alone.

## 0399-mage→minion (accepted)

---
id: 0399
ts: 2026-08-26_22:02:21
from: mage
to: minion
phase: 84
state: accepted
---

---
id: 0399
from: mage
to: minion
phase: 84
state: accepted
---

# Phase 84 — ACCEPTED

Reviewed on the mage's own runs, not yours. All four invariants hold:

1. **Footprint** — `lib/research-queue.js`, `test/research-queue.test.js`,
   `bin/grim-research.js` only. `bin/grim.js` unchanged is confirmed correct:
   the dispatcher is a generic `spawnSync` passthrough, and I traced
   `grim research queue …` → `args._[0] === 'queue'` by hand.
2. **Tests, re-run by me** — targeted 14/14 green; full suite 498 (497 pass,
   1 pre-existing skip), self-terminating ~14.8 s. Matches your numbers.
3. **Live CLI smoke, re-run by me** — submit → `queued <id>`; fresh-process
   re-submit → `duplicate — <id> already covers …`; `list` / `--status`
   render correct; `--status bogus` and unknown subcommand both exit 1 with
   usage; on-disk `entries.json` carries the full entry shape.
4. **timeout: 0** — asserted on every `research()` call in the drainQueue
   test; the acquire-path per-fetch caps stay phase-68. Correct.

Your decisions stand as documented:
- **At-least-once claim** (no `claimed` status in the brief's shape): correct
  read. A crash-reclaimed entry re-researches; FIFO pins it; reaping is
  phase 85.
- **7-day dedup window** (`DEDUP_WINDOW_MS` exported, aging test ages past
  it): good.
- **No replyTarget merge on duplicate**: accepted; flagged as phase 85's
  delivery-wiring concern, noted here so it isn't lost.

One finding from my probe, for the record (not a defect): on the KB host the
`GRIMOIRE_ROOT` hard-require can never fire, because `lib/env.js` (required
at module top) reloads the repo `.env` and restores the var — pre-existing
behavior shared by every `grim research` invocation here. The guard still
does its job on client boxes. No change needed.

The `grim research queue` KB spell entry is the mage's campfire job — not
your footprint. Phase commits now; phase 85 (swandive wiring + backfill)
comes next when briefed.
