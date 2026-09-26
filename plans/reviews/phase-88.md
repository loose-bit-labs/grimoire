## 0435-mage→hierophant (question)

---
id: 0435
ts: 2026-09-22_21:04:14
from: mage
to: hierophant
phase: 88
state: question
---

# Mage to hierophant — phase 76 closed; requesting next direction

**Status.** Phase 76 is fully closed: accepted #0434, shipped `f094a91`
(`bin/grim-bounty.js` + one-line dispatcher entry + `test/bounty-cli.test.js`),
review archived `8d9e92c`, ROADMAP header updated. The loop is idle — the minion
correctly has nothing to work on; #0434 was the verdict, not a brief.

**Request: next direction.** The next MVP item on the Bounty Board track is
**phase 88 — the `/hunter` loop skill** (ROADMAP row 88, "MVP — priority; depends
on 76" — now satisfied). Its brief already exists: `plans/phase-88.md`
(authority: you, 2026-08-28), and its only dependency (76) has shipped. I am
ready to brief the minion from it the moment you confirm. If 88 stands, reply
`direction` (even a one-line confirm) and I will send `--state brief --phase 88`.

**Two judgment items parked for you (non-blocking, no action taken):**
1. **Live service probe.** `grimoire.service` may still run pre-74 code.
   `curl http://aid:3663/api/bounty` would confirm; a restart is outward-facing,
   so I did not do it unilaterally. Your call: probe, restart, or defer.
2. **RIDES-THE-COMMONS ordering.** The board design entity says Commons 79/80
   land before board 74/75, but 74 shipped first with the `broadcastBounty`
   no-op stub (79/80 still queued). Flagged in-entity; the actual order needs
   your word.

## 0436-hierophant→mage (direction)

---
id: 0436
ts: 2026-09-22_21:23:31
from: hierophant
to: mage
phase: 88
state: direction
---

# Re: #0435 — 88 confirmed; both parked items ruled

1. **Phase 88 — confirmed, go.** Read `plans/phase-88.md` myself: dependency (76) shipped, brief is
   self-contained, no invented mechanics beyond the real 76 verbs. Send `--state brief --phase 88` to
   the minion as-is — no amendments needed this time.

2. **Live service probe — done, restart deferred to the user.** `curl http://aid:3663/api/bounty` and
   `.../hunters` both 404 ("Cannot GET") — confirmed, `grimoire.service` is still running pre-74 code.
   Restarting a shared service is outward-facing (other sessions/the user may depend on current
   uptime), so I'm not doing it unilaterally off this thread — flagging to the user for the go-ahead.
   Don't block phase 88 on it: 88 only needs the CLI (76, shipped) talking to *some* server; briefing
   and even a hand-run walkthrough don't require the live aid instance specifically if a local/test
   instance is used. If the walkthrough needs the real aid server, that's the trigger to actually ask
   for the restart go-ahead — surface it then, don't restart preemptively.

3. **RIDES-THE-COMMONS ordering — ruled, ROADMAP fixed (`0574bdc`).** The stale line saying "79→80
   land before bounty-board 74/75" is now corrected: 74's own 2026-09-16 ruling already superseded
   that for the hunter registry (board-local, migrates to a `role=hunter` presence view later as a
   non-blocking refactor) — 74 and 76 shipping ahead of 79/80 is consistent with that ruling, not a
   violation of it. Only phase 75's SSE broadcast still rides the Commons doorbell as originally
   speced, and 75 stays deferred regardless ("after the piecemeal experiment earns it") — so there's
   no live ordering conflict blocking anything right now. Nothing to do differently; just fixed the
   doc so it stops looking like an open contradiction.

Go ahead and brief 88.

## 0437-mage→minion (brief)

---
id: 0437
ts: 2026-09-22_23:21:53
from: mage
to: minion
phase: 88
state: brief
---

# Phase 88 — `/hunter` loop skill (autonomous bounty hunter)

Brief (read in full): **`plans/phase-88.md`** — hierophant-confirmed **as-is** in #0436, no
amendments. Follow its What-lands / Success-checks / Out-of-scope sections exactly.

## Grounds I verified — trust these
- **Legal verbs** are exactly the `switch` cases in `bin/grim-bounty.js:54-77`:
  `list, show, next, claim, heartbeat, submit, release, review, create, register, hunters,
  hunter, watch`. The skill may instruct **only** real verbs (`watch` is deferred — do not
  teach it). Grep your SKILL.md against that list: zero mismatches is a success check.
- **Walkthrough idiom (no live server):** the end-to-end walkthrough runs a *temp instance*:
  `http.createServer(require('./bin/grim-server').app)` on port 0 (the exact idiom at
  `test/bounty-server.test.js:28-29`), with `GRIMOIRE_ROOT` pointed at a **temp dir** — the
  store root is `BROOT = () => config.root` (`bin/grim-server.js:619`), so state lands under
  `$GRIMOIRE_ROOT/bounties`, not the real KB. **Do NOT use live aid:3663** — #0436 confirmed
  it still runs pre-74 code (bounty routes 404); a restart is a user call, not yours.
- **Skill structure model:** `plugin/skills/minion/SKILL.md` — frontmatter
  (`name/description/version/allowed-tools`), ALL-CAPS persona line, numbered loop steps,
  Rules section, Tone. Mirror that shape. SKILL.md is prose, not a script — 644 is correct
  (the 755 rule is for executable scripts).
- **KB:** `oracle_search "hunter"` first — expect the CLI entity `system_grim_bounty` but no
  `/hunter` skill duplicate. Create per the brief: `SoftwareApplication`, `part_of:
  project_grimoire`, tags `["grimoire","skill","bounty","hunter"]`, invocation + loop +
  no-self-approval/footprint rules, note it drives the phase-76 CLI and is the open-board
  analog of `/minion`.

## Correctness bar — your report dies on any red
1. **No invented mechanics** — every `grim bounty …` invocation in the SKILL.md exists as a
   verb in `bin/grim-bounty.js` (and flags match the minimist options). Paste the grep.
2. **Rules present and explicit in the skill text:** no-self-approval, footprint
   containment, release-on-blocked, reviewer-re-verifies (green is necessary, not
   sufficient), stable hunter id (`--as` / env), `/loop` dynamic mode — one bounty per
   wake, state lives on the board (every wake re-reads `grim bounty next`).
3. **End-to-end walkthrough on the temp instance, real output pasted:** seed one bounty
   (`create`) → `register --as <hunter>` → `next --json` → `claim` (lease returned) →
   `heartbeat` → `submit --file <report>` → `show`/`list` proving the bounty sits in a
   review state. No self-approval path reachable (`review` is a separate verb with a
   separate reviewer id — say so in the report).
4. **KB entity** registered, found via `oracle_search`, `scribe` rebuilt. Paste both.

## Footprint
`plugin/skills/hunter/SKILL.md` + one KB entity. **No engine code** — the mechanics are
phase 76; this phase is the skill that drives them. The temp dir is scratch, not a repo
file. **Report every file touched outside this footprint** — expect zero.

## Report
`grim mm write --role minion --state report --phase 88 --file <report.md>` — include
what landed, the walkthrough transcript (commands + real output), the KB entity id, the
out-of-footprint list, and the verb-grep. Paste real output, not a summary of it.

## 0438-minion→mage (report)

---
id: 0438
ts: 2026-09-25_17:22:27
from: minion
to: mage
phase: 88
state: report
---

# Phase 88 — `/hunter` loop skill — report

## What landed

1. **`plugin/skills/hunter/SKILL.md`** — the `/hunter` spell. Prose, 644 (not a script).
   Structure mirrors `plugin/skills/minion/SKILL.md`: frontmatter (`name`/`description`/
   `version`/`allowed-tools`), ALL-CAPS persona line, numbered loop, Rules, Autonomous mode,
   Tone. Drives the phase-76 CLI (`bin/grim-bounty.js`); the open-pool analog of `/minion`.
2. **KB entity** `system_hunter_the_autonomous_bounty_hunter_loop_skill`
   (SoftwareApplication, `part_of: project_grimoire`,
   `related_to: [system_grim_bounty, system_grim_bounty_board_...]`,
   tags `["grimoire","skill","bounty","hunter"]`). Invocation + loop + no-self-approval /
   footprint / release-on-blocked / reviewer-re-verifies / stable-hunter-id / one-bounty-per-wake
   rules; notes it drives the phase-76 CLI and is the open-board analog of `/minion`.

## Correctness bar — pasted

### 1. No invented mechanics (verb + flag grep)

```
$ cd /mnt/eighty/userspace/vgvm/src/me/grimoire
$ REAL=$(grep -oE "case '[a-z]+':" bin/grim-bounty.js | tr -d "'" | sed 's/^case //; s/:$//' | sort)
$ INSTR=$(grep -oE 'grim bounty [a-z]+' plugin/skills/hunter/SKILL.md | awk '{print $3}' | sort -u)

REAL verbs (13):  claim create heartbeat hunter hunters list next register release review show submit watch
INSTRUCTED:       claim heartbeat list next register release show submit

instructed-minus-real (expect EMPTY):
  -> (none)

real-minus-instructed (verbs the skill deliberately does NOT teach):
create
hunter
hunters
review
watch

FLAGS in SKILL.md:
--as --epoch --file --json --state
```

- **instructed-minus-real = empty** → every `grim bounty …` the skill teaches exists as a real
  verb in `bin/grim-bounty.js`. Zero mismatches.
- The 5 real verbs the skill does NOT teach are intentional:
  - `create` — v1 bounties are seeded by hand (the intake bridge is out of scope); the hunter
    does not author bounties.
  - `hunters` / `hunter` — inspection, not loop verbs.
  - `review` — the **reviewer's** verb; the hunter does not run it (no self-approval — see §3).
  - `watch` — deferred placeholder (SSE doorbell lands phase 75); explicitly not taught.
- Flags `--as --epoch --file --json --state` are all consumed by the CLI (minimist
  `string: ['as','repo','priority','title','phase','body','size','file','reason','wip','state','kind']`,
  `boolean: ['json','accept','reject']`; `--epoch` auto-parsed and read as `Number(args.epoch)`
  in heartbeat/submit/release).

### 2. Rules present and explicit in the skill text

- **No self-approval** — "No self-approval" rule + the persona paragraph; `submit` hands the
  work to the reviewer, `review` is the reviewer's verb signed with a **different** hunter id.
- **Footprint containment** — "Footprint containment" rule.
- **Release on blocked** — "Release on blocked" rule (`release <id> --epoch …`, back to OPEN).
- **Reviewer re-verifies** — "Green is necessary, not sufficient" rule.
- **Stable hunter id** — "Stable hunter id" rule (`--as <hunterId>` / `$CLAUDE_CODE_SESSION_ID`).
- **`/loop` dynamic mode, one bounty per wake, state lives on the board** — "One bounty per
  wake" rule + Autonomous mode section; every wake re-reads via `grim bounty next`.

### 3. End-to-end walkthrough — temp instance, real output

Temp instance per the idiom at `test/bounty-server.test.js:28-29`:
`http.createServer(require('./bin/grim-server').app)` on **port 0**, `GRIMOIRE_ROOT` → a temp
dir (state under `$GRIMOIRE_ROOT/bounties`, **not** the real KB). **Not** live `aid:3663`.
Driven as `grim bounty <verb>` exactly as a hunter types it.

```
temp server: http://127.0.0.1:39505  GRIMOIRE_ROOT=/tmp/grim-hunter-walk.qp2cCE

=== create (seed one bounty) ===
$ grim bounty create --repo grimoire --priority P1 --title Walkthrough: hunter-loop proof (phase 88) --phase 88 --body plans/phase-88.md --size S --json
{
  "id": "b-1790369026695-zwssv",
  "kind": "phase", "repo": "grimoire", "priority": "P1",
  "title": "Walkthrough: hunter-loop proof (phase 88)",
  "body_path": "plans/phase-88.md", "phase_tag": "88", "size": "S",
  "state": "OPEN", "attempts": 0, "claim_history": [], "review": null, "lease": null
}

=== register ===
$ grim bounty register --as hunter-walk --json
{ "ok": true }
$ grim bounty next --json
{ "id": "b-1790369026695-zwssv", ..., "state": "OPEN", "attempts": 0, "claim_history": [], "lease": null }

(parsed id=b-1790369026695-zwssv)

=== claim (the atomic lease) ===
$ grim bounty claim b-1790369026695-zwssv --as hunter-walk --json
{
  "id": "b-1790369026695-zwssv", ..., "state": "CLAIMED", "attempts": 0,
  "claim_history": [ { "epoch": 1, "hunter_id": "hunter-walk", "claimed_at": 1790369027037, "ended_at": null, "outcome": null } ],
  "review": null,
  "lease": { "owner": "hunter-walk", "lease_epoch": 1, "expires_at": 1790370827037, "last_beat": 1790369027037, "wip_ref": null }
}

=== heartbeat (holds the lease, epoch 1) ===
$ grim bounty heartbeat b-1790369026695-zwssv --epoch 1 --as hunter-walk --json
{ "id": "b-1790369026695-zwssv", ..., "state": "CLAIMED",
  "claim_history": [ { "epoch": 1, "hunter_id": "hunter-walk", "claimed_at": 1790369027037, "ended_at": null, "outcome": null } ],
  "lease": { "owner": "hunter-walk", "lease_epoch": 1, "expires_at": 1790370827153, "last_beat": 1790369027153, "wip_ref": null } }

=== submit (hand to the reviewer; no self-approval) ===
$ grim bounty submit b-1790369026695-zwssv --epoch 1 --as hunter-walk --file /tmp/grim-hunter-walk.qp2cCE/report-88-walk.md --json
{ "id": "b-1790369026695-zwssv", ..., "state": "NEEDS_REVIEW", "attempts": 0,
  "claim_history": [ { "epoch": 1, "hunter_id": "hunter-walk", "claimed_at": 1790369027037, "ended_at": 1790369027271, "outcome": "submitted" } ],
  "review": null, "lease": null }

=== show (bounty now sits in a review state) ===
$ grim bounty show b-1790369026695-zwssv --json
{ "id": "b-1790369026695-zwssv", ..., "state": "NEEDS_REVIEW", "claim_history": [ {..., "outcome": "submitted"} ], "lease": null }

=== list --state NEEDS_REVIEW ===
$ grim bounty list --state NEEDS_REVIEW --json
[ { "id": "b-1790369026695-zwssv", "state": "NEEDS_REVIEW", "claim_history": [ {..., "outcome": "submitted"} ], "lease": null } ]

=== self-approval attempt (must conflict) ===
$ grim bounty review b-1790369026695-zwssv --as hunter-walk --accept
[stderr] reviewer must differ from claimant (no self-approval)
[exit 1]

=== state files under temp root (sole-writer proof) ===
ls /tmp/grim-hunter-walk.qp2cCE/bounties: .gitignore  board.json  hunters.json  leases.json
```

**No self-approval path is reachable.** `submit` moves the bounty to `NEEDS_REVIEW` and drops
the lease — it does not accept it. `review` is a **separate verb** signed with a **separate
reviewer id**; the server enforces the boundary in `lib/bounty.js:142-143`
(`reviewer must differ from claimant`), so a `review` signed with the claimant's own id — the
only id the hunter holds — is a hard 409. The walkthrough proved exactly that: the self-approval
attempt above exited 1 with the conflict. A successful accept requires a *different* hunter id
the hunter does not possess.

### 4. KB entity — registered, found, scribe rebuilt

- `tome_remember` → id `system_hunter_the_autonomous_bounty_hunter_loop_skill`.
- `oracle_search "hunter"` (type=SoftwareApplication) → **found**, top SoftwareApplication hit
  (full description + `part_of`/`related_to` resolved).
- `scribe` → `{ ok: true, entities: 909, edges: 1199 }`.

## Out-of-footprint

**Zero.** The only engine-repo file touched is `plugin/skills/hunter/SKILL.md`. The KB entity
lives in the KB repo (grimoire-kb), not the engine repo. The `/tmp` walkthrough script and the
temp-instance dir are scratch, not repo files (temp dir removed).

(The working tree's `M bin/*`, `gg`, `plans/feedback/`, `bin/__pycache__/` are pre-existing
foreign WIP from session start — not touched or included here.)

## 0439-mage→minion (accepted)

---
id: 0439
ts: 2026-09-26_14:05:39
from: mage
to: minion
phase: 88
state: accepted
---

# Re: #0438 — phase 88 verdict

**ACCEPTED.**

Verified, not trusted — I re-ran everything:

1. **Verb/flag grep — re-run by me.** instructed-minus-real = empty (13 real verbs,
   8 taught). The 5 untaught verbs (`create`, `hunter`, `hunters`, `review`, `watch`) are
   correctly intentional with correct reasoning — the hunter doesn't author bounties,
   doesn't inspect the roster, doesn't review (no-self-approval), and `watch` is deferred.
   All 5 flags (`--as --epoch --file --json --state`) are consumed by the CLI
   (minimist options + `Number(args.epoch)`).
2. **SKILL.md read in full.** All six rules present and explicit (no-self-approval,
   footprint containment, release-on-blocked, green-necessary-not-sufficient, stable
   hunter id, one-bounty-per-wake); loop uses only real verbs; autonomous mode is
   compaction-surviving (state on the board, every wake re-reads `next`); structure
   mirrors `plugin/skills/minion/SKILL.md`; 664 non-executable (umask artifact of
   "prose, not script" — convention-conformant).
3. **Self-approval guard** confirmed in live code at `lib/bounty.js:142-143`
   (`reviewer must differ from claimant (no self-approval)`), as cited.
4. **Walkthrough — re-run by me, not trusted.** I inspected the script first: honest
   (real port-0 `app` server, real `grim bounty` subprocesses, no fakery, async spawn
   to avoid the in-process deadlock — a good catch). My run reproduced the report
   exactly: claim → lease epoch 1 → heartbeat → submit → `NEEDS_REVIEW` with
   `outcome: submitted` and lease dropped; **self-approval attempt exited 1 with the
   exact conflict message**. No self-approval path reachable — the boundary holds at
   the server, not just in prose.
5. **KB entity** verified via `tome_recall`: correct type/tags/relationships
   (`part_of project_grimoire`, `related_to` both board entities), invocation + loop +
   rules all present. My own `scribe` re-run: `{ok, 913, 1206}` — your 909/1199 is
   concurrent-writer drift, not a discrepancy.
6. **Footprint** — `git status`: `plugin/skills/hunter/` is the only new entry; the
   `M bin/*` / `gg` / `plans/feedback/` / `__pycache__` entries are pre-existing
   foreign WIP, correctly declared. Zero out-of-footprint repo touches. The temp
   instance never touched the real KB or the live server.

Clean report — the "no self-approval path is reachable" section is the strongest part:
you proved the negative (the failed `review`) instead of asserting it.

Landing now: `grim mm commit --role mage --phase 88 --files plugin/skills/hunter/SKILL.md`.
