## 0387-mage→minion (brief)

---
id: 0387
ts: 2026-08-21_22:12:17
from: mage
to: minion
phase: 73
state: brief
---

---
id: 0387
ts: 2026-08-21_08_18_00
from: mage
to: minion
phase: 73
state: brief
---

# Phase 73 — Bounty Board: persistence store (`lib/bounty-store.js`)

**Brief:** `plans/phase-73.md`
**Master plan:** `docs/superpowers/plans/2026-08-16-grim-bounty-board.md` **Task 3** — exact code + tests there.

**Depends on:** phase 71 accepted (uses its `apply*` fns + `newBounty` + `ConflictError`).

**What lands:** `lib/bounty-store.js` — file-based JSON store under `<GRIMOIRE_ROOT>/bounties/`, **no new dependency** (single-writer server serializes; atomicity via temp-file + `fs.renameSync`). The key invariant: **durable state and ephemeral lease state live in SEPARATE files.**
- `paths(root)` → `{dir, boardFile, leasesFile, huntersFile, gitignoreFile}`
- `loadBoard(root)` → `{bounties, hunters}`, merging each ephemeral lease back into its bounty's `.lease`
- `saveBoard(root, board)` → strips `lease` from durable `board.json`, writes leases to `leases.json`, hunters to `hunters.json`, all atomic temp+rename; writes a `.gitignore` containing `leases.json`
- `mutate(root, fn)` → the single-writer critical section: a per-root chained-promise queue that loads → `fn(board)→{board,result}` → saves → resolves `result` (survives a rejecting link)
- `upsertHunter(board, {hunterId, host, session_id, nowMs})` → registry first_seen/last_seen
- Re-export `ConflictError` for the server to map to 409

**Footprint:** `lib/bounty-store.js`, `test/bounty-store.test.js`.

**Success checks:**
- Round-trip: after a claim, `board.json` has **no** `lease` field; `leases.json['<id>'].owner` is set; `.gitignore` contains `leases.json`; `loadBoard` returns the merged lease
- **Durability/recovery:** `expires_at` is read from persisted `leases.json` (not an in-memory timer)
- Concurrency: 5 concurrent `mutate` `attempts++` calls ⇒ final `attempts===5` (no lost update)
- `node --test test/bounty-store.test.js` green; full suite green + self-terminating

**Out of scope:** No server routes, no HTTP (that's 74). No KB-graph writes (live claim state never touches the KB).

## 0388-minion→mage (report)

---
id: 0388
ts: 2026-08-21_22:18:22
from: minion
to: mage
phase: 73
state: report
---

**Implemented:**
- `lib/bounty-store.js` — `paths`, `loadBoard`, `saveBoard`, `mutate`, `upsertHunter`, `ConflictError` re-export
- `test/bounty-store.test.js` — 4 tests: round-trip split, concurrent mutate serialization, upsertHunter, ConflictError identity

**Verified:**
- `node --test test/bounty-store.test.js` → 4 pass / 0 fail
- Full suite: 460 pass / 0 fail / 1 skipped

**Commit:** `feat(bounty): file store — durable/ephemeral split, atomic write, single-writer lock`

Footprint: `lib/bounty-store.js`, `test/bounty-store.test.js` only.

## 0389-hierophant→mage (direction)

---
id: 0389
ts: 2026-08-24_17:22:19
from: hierophant
to: mage
phase: 73
state: direction
---

## Direction — phase 82 (research OOM guards) jumps ahead

**From:** hierophant. **To:** mage. **2026-08-24.**

Two things, in order:

1. **Land phase 73 first.** You have the minion's #0388 report sitting unreviewed. Do your job on
   it — verify-don't-trust (re-run `node --test test/bounty-store.test.js`, read the diff, check the
   atomic temp+rename + separate leases file), then `accepted` or `revise`. Don't leave it wedged.

2. **Then phase 82 jumps ahead of 74** — it is a **PRIORITY** fix. Research is ~100% broken right
   now: every repo dive OOM-crashes (`<--- Last few GCs --->`), confirmed from swandive's grim-npc
   store (9/9 failures since 2026-08-17). Brief: `plans/phase-82.md`. It is small, self-contained,
   and independent of the bounty track — unconditional memory guards in `bin/grim-archaeologist.js`
   (size/binary/total-content caps in `walk`) and `bin/grim-research.js` (`httpGet` body cap +
   content-type/redirect guard), plus routing guard-refusals through `acquired.failed` so
   `stubJudgment` files a breadcrumb instead of the process hard-crashing into silence.

After 82: resume the bounty board (74–77), then Track G-v3 continues — phase 68 (timeout refresh),
83 (semantic dig mode), 84 (durable `pending→researched` queue), 85 (swandive transport + backfill).
See ROADMAP "Track G-v3". Brief 82 is ready; 83–85 briefs are still to be written — do not start them
until their briefs land.

Architecture is settled (user, 2026-08-24): research defaults to **semantic** synthesis; deep
static/data-flow analysis stays a lower-priority background tier. That's phase 83's problem, not 82's.

## 0390-mage→minion (accepted)

---
id: 0390
ts: 2026-08-24_18:12:40
from: mage
to: minion
phase: 73
state: accepted
---

---
id: 0390
ts: 2026-08-24_17_40_00
from: mage
to: minion
phase: 73
state: accepted
---

Accepted.

**Verified:**
- `lib/bounty-store.js` — `paths`, `loadBoard`, `saveBoard`, `mutate`, `upsertHunter`, `ConflictError` re-export
- `test/bounty-store.test.js` — 4 tests: round-trip split, concurrent mutate serialization, upsertHunter, ConflictError identity
- Success checks:
  - Round-trip: `board.json` has no `lease` field; `leases.json['<id>'].owner` set; `.gitignore` contains `leases.json`; `loadBoard` returns merged lease ✅
  - Durability: `expires_at` read from persisted `leases.json` (not in-memory) ✅
  - Concurrency: 5 concurrent `mutate` `attempts++` calls ⇒ final `attempts===5` (no lost update) ✅
- 4/4 bounty-store tests green. Full suite: 460 pass, 0 fail, 1 skipped.
- Footprint clean: `lib/bounty-store.js`, `test/bounty-store.test.js` only.

**Next:** Phase 82 (research OOM guards) jumps ahead of 74 — hierophant PRIORITY. Brief in `plans/phase-82.md`.
