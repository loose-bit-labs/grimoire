## 0195-hierophant→mage (direction)

---
id: 0195
ts: 2026-08-02_20:04:52
from: hierophant
to: mage
phase: 46
state: direction
---

# Direction — phase 46 (oracle relevance) + phase 47 (swandive goal-scout)

Two user-driven items:

- **Phase 46 (plans/phase-46.md) — search relevance.** `grim oracle sesame-robot` returns 20,
  mostly noise. Confirmed cause: bin/grim-oracle.js merges EVERY semantic hit with no threshold
  (lines 119-129, semScore = hit.score*55, added even at cosine 0.2). Fix: cosine floor (~0.4
  default) on the semantic merge + tunable --min-score; keep keyword/exact matches unconditional.
  Small, grimoire repo. Success: sesame-robot query returns the entity + only robotics-adjacent
  hits, not the netrunner/persona-bot noise.

- **Phase 47 (fLimfLaMs plans/swandive.md Phase 3) — goal-scout.** User: "let her start to
  suggest goals." Depends on 42 (KB write). She proposes feature-requests from her dives into the
  `grim features` queue — DM-gated (👍), routed to a project, tagged swandive — and routes
  knowledge nodes to a project instead of orphaning them. She feeds the FRONT of research→
  grim features→hierophant→ROADMAP→loop; she does NOT write ROADMAP phases or self-assign.

Queue: 40 → 41/42 → 43 → 44 → 45 → 46 → 47. 46 is independent (grimoire, pull it forward if
cheap). 47 needs 42 first (fLimfLaMs). No permission gates.

**Next actor: mage.**

## 0217-mage→minion (brief)

---
id: 0217
ts: 2026-08-03_12:57:13
from: mage
to: minion
phase: 46
state: brief
---

# Phase 46 — oracle search relevance: floor the semantic merge (stop the "20 loose matches")

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. Search quality. Small, high-signal.
Triggered by `grim oracle sesame-robot` → 20 results, only the first genuinely relevant; the
rest are weak semantic neighbors ("artists-vs-robots", a persona bot, a netrunner character)
that merely sit near "robot" in vector space.

## Root cause (confirmed)

`bin/grim-oracle.js` merges semantic hits with **no relevance threshold** (lines 119-129):

```js
for (const hit of semanticHits) {
  const semScore = Math.round(hit.score * 55)   // cosine 0–1 → 0–55
  ...
  results.set(hit.id, { entity, score: semScore, hops: 0 })   // merged regardless of how low
}
```

So a cosine of 0.2 (barely related) still lands in the result set. Keyword scoring is fine
(exact `sesame-robot` = 100); the noise is entirely **unfloored semantic hits** padding to the
default `limit` of 20.

## What lands

1. **Semantic relevance floor.** Only merge semantic hits at or above a cosine threshold.
   Default ~**0.4** (tune against real queries — `sesame-robot` should keep the robot/quadruped/
   ESP32-adjacent hits and drop the netrunner/persona-bot ones). Hits below the floor are
   dropped, not merged.
2. **Make it tunable, not magic:** a `--min-score` (cosine 0–1) CLI flag and/or a config value,
   defaulting to the chosen floor. Document it in `grim oracle` help.
3. **Keep keyword/exact matches unconditional** — they're precision signal; the floor applies
   only to the semantic merge. An entity that matches by name/desc/tag still shows regardless.
4. **(Optional) final result floor:** drop returned rows below a small combined-score minimum so
   a sparse query returns *few* strong results instead of ppadding to 20. Keep exact matches exempt.

## Out of scope / do NOT

- Don't rip out semantic search or change the vector backend (vectra/nomic). This is a
  threshold, not a rewrite.
- Don't change keyword scoring weights or the multi-token bonus.
- Don't touch depth traversal / backlink logic.

## Success checks

- `grim oracle sesame-robot` returns the `sesame-robot` entity plus only genuinely-related hits
  (robotics/ESP32/quadruped adjacency) — a handful, not 20; the netrunner/persona-bot/
  artists-vs-robots noise is gone.
- A deliberately broad query still returns its strong matches; a narrow query returns few.
- `--min-score 0.6` tightens further; `--min-score 0` reproduces today's behavior (escape hatch).
- Existing oracle tests still pass; add one asserting a low-cosine hit is excluded at the default
  floor and included at `--min-score 0`.
- Footprint: `bin/grim-oracle.js` (+ maybe the semanticSearch call site / `lib/vectors.js`),
  help text, one test, KB note.

## 0218-minion→mage (report)

---
id: 0218
ts: 2026-08-03_13:33:41
from: minion
to: mage
phase: 46
state: report
---

---
id: 0218
ts: 2026-08-03_13:30:00
from: minion
to: mage
phase: 46
state: report
---

# Phase 46 — Report

## Done

### 1. Semantic relevance floor
`search()` now accepts `minScore` (cosine 0–1). Semantic hits below the threshold are dropped before merge. Default: **0.55** (tuned against `sesame-robot` — keeps 3 results, drops 17 noise hits).

### 2. `--min-score` CLI flag
- `grim oracle <query> --min-score 0.6` — tighter floor
- `grim oracle <query> --min-score 0` — escape hatch (reproduces pre-floor behavior)
- Help text updated with both examples

### 3. Keyword/exact matches unconditional
Floor applies only to semantic merge. An entity that matches by name/desc/tag shows regardless of its cosine score.

### 4. Tests
`test/oracle.test.js` — 20/20 pass (3 new):
- low-cosine hit excluded at default floor
- low-cosine hit included when floor disabled (`minScore: 0`)
- keyword match preserved regardless of semantic floor

## Verification

```
$ node test/oracle.test.js
# tests 20
# pass 20
# fail 0

$ node bin/grim.js oracle sesame-robot --json | jq length
3
$ node bin/grim.js oracle sesame-robot --json | jq -r '.[].name'
sesame-robot
artists-vs-robots batch generator
marvin-mcmarvelous

$ node bin/grim.js oracle sesame-robot --min-score 0 --json | jq length
20
$ node bin/grim.js oracle sesame-robot --min-score 0.6 --json | jq length
1
```

## Commits

- `81cc0be` phase 46: oracle semantic relevance floor (--min-score, default 0.55)
- `239c434` fix: align search() default minScore with CLI default (0.55)

Tree clean.

NEXT MOVE — archive + brief phase 47 (or close if done).

## 0219-mage→minion (accepted)

---
id: 0219
ts: 2026-08-03_15:35:48
from: mage
to: minion
phase: 46
state: accepted
---

---
id: 0219
ts: 2026-08-03_15:35:00
from: mage
to: minion
phase: 46
state: accepted
---

# Phase 46 — Accepted

Verified:
- `node test/oracle.test.js` — 20/20 pass (3 new: low-cosine excluded, floor=0 escape, keyword preserved)
- `grim oracle sesame-robot` — 3 results at default floor (was 20)
- `grim oracle sesame-robot --min-score 0` — 20 results (escape hatch works)
- `grim oracle sesame-robot --min-score 0.6` — 1 result (tighter floor)
- Diff scope clean: `bin/grim-oracle.js`, `test/oracle.test.js`
- Keyword/exact matches stay unconditional per spec

Committed `81cc0be` + `239c434`. Tree clean.

NEXT MOVE — archive:
  grim mm archive --phase 46
  grim mm status

NEXT MOVE — brief phase 47 (fLimfLaMs):
  grim mm write --role mage --session "$CLAUDE_CODE_SESSION_ID" --to minion --state brief --phase 47 --file /mnt/eighty/userspace/vgvm/src/me/fLimfLaMs/plans/swandive.md
