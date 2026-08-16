# grim-bounty-board — Design Spec

**Date:** 2026-08-15 · **Authority:** hierophant + user + crowd review (see Sources) · **Repo:** grimoire · **Status:** design, pre-plan

## 1. Purpose

Give the fleet (~12 local 256k-context worker sessions, plus the cloud hierophant) a **hub-and-spoke
execution-coordination layer**: a shared pool of prioritized, cross-repo work items that workers
**pull** from, claim atomically, work, and submit for review — instead of being **pushed** one phase
at a time down a strict mage→minion tree. This is the post-scarcity methodology shift made concrete:
abundance of capable local workers makes a claimable pool + lateral review affordable.

It is **not** a project-management tool and **not** a second planning system. It is an *agent
coordination protocol*. The roadmap still defines *what should be built*; the board records *what is
available, who owns it, and its execution state*.

## 2. Core decisions (locked)

1. **Native build** on KB/roadmap/`grim-server` — no external tracker, no new daemon, no cloud.
   Local-first is a core value; adapters would duplicate `roadmap + .mm + KB` and add a SPOF/sync-drift
   in the hot path. Native is *less abstraction*, not merely "more local."
2. **Bounty = the atom; phase = a tag.** Schema is the general model (`kind` + `phase_tag`); **v1
   exposes only `kind=phase`** ("3 conceptually, ship as 1"). No new artifacts today, no migration later.
3. **Lease + TTL + heartbeat**, self-healing. Watchdog behaviors are **functions inside the server
   sweep**, not a separate daemon (build later without protocol change).

## 3. Invariants (write these in bold; they keep the design honest)

- **The board must never become smarter than the mage.** WHY = hierophant · WHAT = bounty · HOW = mage
  · work = minions. The board knows *availability, ownership, liveness, priority, execution state*. It
  does **not** do dependency resolution, task decomposition, or implementation planning. The moment it
  does, the separation is broken.
- **`grim-server` (:3663, aid) is the sole authority** for claim/heartbeat/submit/review/release. Workers
  never compute ownership or expiry themselves.
- **A bounty is an execution offer referencing a durable artifact**, not the artifact itself. A phase
  brief (`plans/phase-N.md`) lives for months; the bounty records the *execution state* of that work.
  `Phase --offered_as--> Bounty`.
- **No self-approval.** A bounty's reviewer must be a different session than its author/claimant
  (same repo is fine). Preserves the pact's foundational "never self-accept" rule.
- **Durable, recoverable state.** Lease expiry is derivable from persisted state, never dependent on an
  in-memory timer surviving the process. Server dies → restart → recompute expirations → workers reclaim.

## 4. Storage — split durable from ephemeral (the key insight)

A bounty has two kinds of state that **must not share a store**:

- **Durable** (rarely changes, worth versioning): `id, kind, repo, priority, title, body_path,
  phase_tag, size, state, claim_history[]`.
- **Ephemeral / high-churn** (changes every few minutes per active worker): `owner, lease_epoch,
  expires_at, last_beat, wip_ref`.

Heartbeating lease timestamps into the git-committed KB (librarian pushes nightly) would thrash git
history and bloat the graph. Therefore:

- Bounties live in a **dedicated lightweight store `grim-server` owns**, under the KB root — durable
  fields committable, **lease/ephemeral fields gitignored (or in-memory + persisted separately)**.
- The store needs an **index on `state`** so `list` doesn't full-scan a flat pool.
- The KB gets an **optional link entity** per significant bounty (for search/graph + failure knowledge);
  **live claim state never touches the KB.**
- Atomic writes are the hard part (not hand-wave): claim is a **compare-and-swap** at :3663 (single
  writer). Whether backed by sqlite (WAL) or a locked JSON store is an implementation-plan decision, but
  the CAS + an **active server sweep that writes** reclaimed bounties back to OPEN are required — lazy
  reclaim-on-read is insufficient (a dead claim would sit CLAIMED until someone happens to `list`).

## 5. Data model

```
Bounty {
  id            string          # stable
  kind          "phase"         # v1; later: "task" | "bug" | "chore" | "review"
  repo          string          # REQUIRED
  priority      "P0".."P3"      # REQUIRED
  phase_tag     string          # REQUIRED unless kind=chore  (v1: the phase, e.g. "70")
  body_path     string          # kind=phase -> plans/phase-N.md (enforced link; body never diverges)
  size          "S"|"M"|"L"     # hint, anti-sprawl
  title         string
  state         State
  # lease (ephemeral, separate store):
  lease { owner, lease_epoch, expires_at, last_beat, wip_ref }?
  claim_history [ { epoch, owner, claimed_at, ended_at, outcome } ]   # outcome: expired|released|submitted|rejected|accepted
  review { verdict, reviewer, reason, at }?                            # last review, if any
  attempts      int             # = count of reclaim/reject cycles
}
```

**Authorship rules (enforced server-side):** `kind=phase` — **hierophant only** (authority intact;
roadmap stays `list --kind phase`). `kind=task|bug|chore` (post-v1) — any worker may create (this is
what lets agents *post* work). Task-bounties are for *independent/cross-cutting* work (bugs, chores,
research) — **not** a phase's internal steps (that decomposition is the mage's job, inside a claim).

## 6. State machine

```
OPEN ──claim──▶ CLAIMED{owner, lease_epoch, expires_at, wip_ref}
                   │
   heartbeat ──────┤  (epoch-checked; renews expires_at = now + TTL(kind); updates wip_ref)
   (renew)         │
                   ├─ submit ───▶ NEEDS_REVIEW        (epoch-checked)
                   ├─ release ──▶ OPEN                (voluntary, or auto on stale-epoch 409)
                   └─ lease EXPIRES (server sweep) ──▶ OPEN   (attempts++, history+= "reclaimed from X")
                                                          └─ if attempts >= 3 ──▶ NEEDS_TRIAGE (poison; needs-human, NOT auto-OPEN)

NEEDS_REVIEW ──review:accept──▶ ACCEPTED (terminal; triggers grim mm commit / phase accept)
             ──review:reject──▶ OPEN (attach structured review{verdict,reviewer,reason}; attempts++; KB-linked)

(any) ──blocked──▶ BLOCKED (needs hierophant/user; used only where roadmap semantics already need it)
```

- **Legal transitions only** — no arbitrary state mutation.
- **Fencing:** each claim increments `lease_epoch`. `heartbeat`/`submit`/`release` carry the epoch; the
  server rejects any that don't match the current epoch → a stale woken worker cannot mutate a bounty
  another worker now owns.
- **SSE emits every transition:** `bounty:created|claimed|heartbeat|submitted|reclaimed|released|
  reviewed|accepted|triage`. Makes stalls visible; workers already speak the `grim mm news` doorbell.

## 7. Timing (per-kind policy knobs, invariant `TTL >> heartbeat`)

| kind        | heartbeat | lease TTL |
|-------------|-----------|-----------|
| phase       | 5 min     | 30 min    |
| task / bug  | 2 min     | 8 min     |

Tunable; not hard-coded magic numbers. Heartbeat piggybacks the worker's existing `/loop` tick, so it
is effectively free. Heartbeat payload: `{ bounty_id, lease_epoch, worker_id, session_id, ts, wip_ref
}` — `wip_ref` (last commit sha / `.mm` checkpoint) so a reclaim resumes rather than discards work.

## 8. CLI surface (deliberately tiny — resist creep)

```
grim bounty list     [--repo R] [--kind K] [--state S] [--mine] [--json]   # the board, priority-sorted
grim bounty show     <id>
grim bounty next                                     # highest-priority OPEN this worker is eligible for (the "pull" verb)
grim bounty claim    <id>                            # atomic CAS at :3663 -> lease + epoch
grim bounty heartbeat <id>                           # renew lease (piggybacks loop tick; carries wip_ref)
grim bounty submit   <id> --file report.md
grim bounty review   <id> --accept|--reject --file notes.md
grim bounty release  <id>                            # voluntary return to pool
grim bounty create   --repo R --priority P [--phase TAG] [--size S] --title ... [--body plans/phase-N.md]
grim bounty watch                                    # SSE doorbell stream
```

**Explicitly NOT building:** `edit / move / assign / label / comment / project / milestone / sprint` —
the slippery slope back toward a GitHub/Forgejo clone.

`grim roadmap` **becomes a view** over the board filtered by `kind=phase` — the existing ledger, now
reading execution state from the pool instead of parsing `plans/*.md`.

## 9. Observability (from day one — ties into Track F telemetry)

Emit as Prometheus gauges via the rig agent: **claim contention (`409` rate)** — if >1%, add backoff;
**time-in-OPEN** per priority; **reclaim rate**; **poison list** (`NEEDS_TRIAGE` count); board size /
`state`-index scan cost. These are the future watchdog's inputs; capturing them now makes it a reader,
not a rebuild.

## 10. Failure philosophy (emergent — each failure has its own recovery)

| Failure | Recovery |
|---|---|
| Worker crashes / disappears | Lease expires → OPEN |
| Worker voluntarily stops | `release` |
| Network hiccup | Heartbeat grace (TTL slack) |
| Stale worker wakes post-expiry | Rejected by fencing epoch |
| Bad implementation | Review → reject → OPEN (with reasons) |
| Repeated failure (poison) | 3 reclaims → NEEDS_TRIAGE (human) |
| Bad phase definition | Hierophant revises the brief |
| **grim-server dies** | **Durable state + recompute-expiry-on-restart** (the one real SPOF; accepted for local, per mesh-lite — do NOT build Raft/etcd) |

## 11. v1 scope / cut line

**In:** native store + CAS claim + per-kind lease/heartbeat/epoch + active server sweep + poison
hard-stop + `kind=phase` only + hierophant-authored + reviewer≠author + the CLI in §8 + SSE transitions
+ the day-one gauges in §9 + `grim roadmap` reading from the board.

**Fast-follow (not v1):** `kind=task|bug|chore` + agent authorship rules; **read-only web board**
(`grim bounty board --web`) built on the **Guild Hall (Track Q)** viewer substrate — Muse's warning:
without it, humans recreate GitHub as a shadow board.

**Deliberately later:** the watchdog session (interprets §9 telemetry: stalled/starved/thrashing).

## 12. Out of scope / do NOT

- No external tracker, no new forge/daemon/DB service, no cloud in the hot path.
- No consensus/Raft/etcd — `grim-server` single-writer is the accepted tradeoff (mesh-lite ruling).
- No board-side decomposition/dependency/planning logic (see §3 invariant).
- No CLI creep beyond §8.

## Sources

Crowd review (2026-08-15), `plans/feedback/bounty-system/`:
- **feedback-chatgpt.md** — fencing tokens/`lease_epoch`; durable-state + recompute-on-restart;
  claim-history-as-telemetry; informative rejection; "board must not outsmart the mage"; tiny-API/anti-creep;
  bounty-as-offer-referencing-phase.
- **feedback-gemini.md** — full system diagram; `STALLED` poison state; per-parameter tuning table.
- **feedback-muse.md** — reviewed the *actual* picks; per-kind TTL; WIP-ref in heartbeat; poison
  hard-stop (no auto-OPEN); active server sweep (not lazy-on-read); authorship rules enforce grain;
  `body_path→brief` link; 409/observability; shadow-board warning → ship a web view early.
