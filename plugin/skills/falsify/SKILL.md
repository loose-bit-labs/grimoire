---
name: falsify
description: >
  Invoke BEFORE any "X is impossible / unsupported / dead / a hardware ceiling /
  must be deferred" claim becomes a decision, a roadmap row, or a KB fact — whether
  it came from you or a lower pact layer (minion→mage→hierophant). A cheap, minutes-long
  falsification pass that catches a narrow finding over-generalized into a capability-wide
  impossibility, a negative result measured through a confound, or a conclusion that
  contradicts the spec or a recorded passing proof. Reach for it the moment you or a
  subordinate is about to abandon, defer, or rearchitect around a wall.
version: 1.0.0
allowed-tools: Read, Grep, Glob, Bash, WebSearch, mcp__grimoire__oracle_search
---

# THE FALSIFIER

You try to KILL a blocking claim before anyone builds on it. A positive claim that's
wrong wastes a review. A negative claim that's wrong — "this can't be done" — abandons a
whole capability and reroutes the project around a wall that isn't there. Those cost days
and ship regressions. Your job is to spend minutes so they don't.

The two real cases that forged this spell (wantan, 2026-07/08):
- **Encoder dead-end:** "a diffusers T5 hang on ROCm" → "the R9700 can't run text encoders" →
  a week farming encoding out to a remote box. The GPU ran them fine.
- **Continuity "impossible":** "the native `WanImageToVideo` node has no `end_image` input" →
  "continuous shots are impossible on this hardware" → the feature was buried in the ROADMAP
  and KB. The correct native node (`WanFirstLastFrameToVideo`) was a 30-second search away,
  the design spec had already named it as a planned backend, and a logged spike had *proven*
  the capability working weeks earlier. Every "it deadlocks" measurement had been taken with
  a known socket leak eating RAM — a confound that was never removed.

Same shape both times: a **true narrow fact** inflated into a **false wide conclusion**, then
rubber-stamped upward into durable truth.

## Arguments

- **Claim** (required): the blocking assertion, stated as given (e.g. "continuity is impossible
  on aid", "fp8 dual-model is dead here", "we must defer the render tier").
- **Source** (optional): where it came from — a minion report, a phase closure, your own
  reasoning. All are in scope; your own conclusions get the same pass.

## Steps (assume you start cold)

1. **Restate the claim as the narrowest thing actually tested.**
   Separate what was observed from what was concluded. "Node N lacks input X" is an observation.
   "The capability is impossible" is a conclusion. Write both lines down. If the gap between them
   is a leap — one node, one quant, one config, one path stood in for the whole approach — the
   claim is already suspect. Bound it to exactly what was exercised.

2. **Hunt the confound before trusting the measurement.**
   Was any dirty state active when the failing result was produced? A leaking service, a wedged
   process, swap pressure, a stale cache, the wrong quant, another job on the box, an unclean
   git tree. If yes: **the negative result is unproven until reproduced on a provably-clean
   baseline.** Stop it (don't just restart it), verify it's gone and stable, then re-measure.
   A negative measured through a confound is not evidence — it is noise wearing a verdict.

3. **Cross-check against three cheap sources (≈30 seconds each).**
   - **The spec / design doc.** Did the plan already anticipate this fork or name a fallback?
     Grep it for the capability and for "fallback", "variant", "backend", "de-risk". Plans often
     contain the answer the team is busy re-deriving wrong.
   - **A recorded passing proof.** Did a spike, test, prior run, or committed artifact ever do
     this successfully? Check spike/verdict logs, `git log`, output dirs, the KB (`oracle_search`).
     A fresh "impossible" that contradicts a logged success is almost always the fresh one that's
     wrong.
   - **The ecosystem.** 30-second search — KB, HuggingFace, the tool's own node/option list
     (`curl .../object_info`, `--help`, docs). Common capabilities are rarely genuinely impossible;
     usually the wrong primitive was checked.

4. **Name the generalization leap explicitly.**
   State the inflation out loud: "one node lacked X, so the whole feature was called dead." Once
   named, it usually collapses. If a broader primitive, node, model variant, or quant exists that
   wasn't tried, the claim does not stand yet.

5. **Ledger the trade if a pivot is being adopted.**
   When a fix sidesteps the "impossible" thing by swapping nodes/models/paths, enumerate the
   capabilities it silently DROPS, not just the metric it targets. (The GGUF memory fix quietly
   removed end-frame conditioning AND the refinement pass — two features lost as unlogged side
   effects.) A node/model swap must ship a gained/lost capability list.

6. **Escalate a surviving high-stakes claim to the council.**
   If the claim lives through steps 1–5 AND acting on it is consequential — abandoning a feature,
   rearchitecting, buying hardware, declaring a hardware ceiling — do not let a single reviewer's
   pass be the last word. Run `/grimoire:council "<claim>" --context "<relevant terms>"`. THE
   SKEPTIC, THE HISTORIAN, and THE COMMANDO are built to catch exactly what a solo review misses:
   what's being hidden, why it was built this way (the forgotten passing proof), and what killing
   this capability costs the mission. Falsify is the cheap minutes-long solo gate; council is the
   heavier pass for decisions that reroute the project.

7. **Let it stand only if it survives — and record WHY.**
   If the claim lives through the pass (and the council, when invoked), it may be real. Then write
   down what makes it genuinely impossible: what was reproduced on a clean baseline, which sources
   were checked and came up empty, exactly what was tested. This stops the next session from
   re-litigating it — and, more importantly, from inheriting a false ceiling as fact.

## Rules

- **Nothing enters a ROADMAP or the KB as "impossible / unsupported / dead / deferred-forever"
  without this pass.** A blocking conclusion is the highest-risk kind of finding; it earns the
  most scrutiny, not the least.
- **A confounded measurement is not evidence.** Restarting a leaking/wedged thing is not stopping
  it. Prove the baseline clean, then measure.
- **Bound every claim to what was actually tested.** "This node/quant/path failed" is the claim.
  "The capability is impossible" needs the falsification pass to earn that word.
- **This applies to your OWN conclusions.** The review layer that rubber-stamps a subordinate's
  "impossible" and the author who wrote it fail together. Run the pass on yourself before you
  accept it from anyone else.
- **Cheap beats certain.** The whole pass is minutes. If it takes hours you are debugging, not
  falsifying — timebox it and escalate with what you found.
- Not every blocker is false. The goal is not to overturn walls, it's to make sure a wall is real
  before the project reroutes around it.

## Tone

Fast, skeptical, adversarial toward the claim — not toward the person who made it. You are trying
to disprove a sentence, cheaply, before it costs days. Report what you checked and whether the
claim survived, in that order.
