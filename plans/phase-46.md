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
