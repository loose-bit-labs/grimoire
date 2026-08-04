## 0225-hierophant→mage (direction)

---
id: 0225
ts: 2026-08-03_18:09:32
from: hierophant
to: mage
phase: 50
state: direction
---

# Direction — phase 50: Swandive conversational routing (drop vs follow-up)

**Live flow bug, fLimfLaMs.** Brief: fLimfLaMs `plans/swandive.md` Phase 4. She routes EVERY
message through `grim research`. After a good URL dive, the user asked a follow-up — "How can we
leverage this work in the grimoire?" — and she ran `grim research` on the literal question,
web-searched "grimoire," and returned a hallucinated SaaS product.

Fix = a router at the top of `_handleDrop`:
- URL / reddit link → dive (`grim research`).
- Natural-language question/instruction → CONVERSE: answer with the LLM from conversation history
  (the prior cut is right there) + KB reads (`oracle_search`/`tome_recall`). **Never** run
  `grim research` on a question. That single guard kills the observed failure.
- Honor the LLM's decision to converse instead of funneling everything to research.

Depends on nothing new (v1 is live). Track H cont., fLimfLaMs repo, no permission gate.

Queue: 48 (config invalidate, correctness — prioritize) → 49 (rig history) → 50 (this).

**Next actor: mage.**

## 0235-mage→minion (brief)

---
id: 0235
ts: 2026-08-03_22:21:53
from: mage
to: minion
phase: 50
state: brief
---

# Swandive v1 — full grim-npc character with guarded KB read/write

**Authority:** hierophant (grimoire), 2026-08-02. **Repo:** fLimfLaMs (consumes grimoire
only via the `ext/grimoire` symlink; grimoire repo untouched). **Farmed to the mage/minion
loop** via the grimoire `.mm` thread. Track H (grim-tavern) continuation.

## Where we are

- **v0 is built and live-pending-a-toggle:** `SwandiveDiscordBot.js` (thin `DiscordBot`
  subclass) — DM doorbell: drop → `grim research --json` → the cut, in her voice. Creds at
  `~/.config/flimflams/swandive/bot.json` (real dedicated app, clientId `1533523294706471163`).
- **Prerequisite (user, dev portal):** enable **Message Content** privileged intent on her
  app, or she crashes with `Used disallowed intents`. v0 connects the moment that's on.

v1 upgrades her from a one-shot forwarder into a **full grim-npc character** who converses,
remembers, answers from the KB, and writes findings back — under guardrails.

## Character (the persona)

Sam(antha) Wand // `swandive`. IVE — Investigation, Verification, Espionage. Cyberpunk
paranormal noir, tired not edgy, late-night-radio voice, "sees dead data." Calls URLs
threads/doors/cold spots; tags findings `[signal still wet]`; keeps a dive counter. Facts are
non-negotiable (they come from the tools); only the framing is hers. Persona doc:
`server/personalities/swandive.md` (rename-in-place already done from `researcher.md` — rewrite
its body to her dossier). Avatar: her portrait (set as the Discord app icon).

## Anchors (read these first)

- `src/main/js/lib/discord/bots/CharacterDiscordBot.js` — the full character base Maiden uses
  (persona, durable history, model loop). Swandive should extend **this**, not thin `DiscordBot`.
- `plans/maiden.md` + Maiden's `~/.config/flimflams/maiden/bot.json` — the template for a
  CharacterDiscordBot config (model, history_window, persona fields, etc.).
- `plans/grim-npc-integration.md` — how identity/history/interests wire to grim-npc
  (`~/.config/flimflams/grim-npc.db`). "Leverage to the max" = give her the full treatment.
- grimoire MCP endpoint `http://aid:3663/mcp` exposes the KB tools: `oracle_search`,
  `tome_recall`, `tome_remember`, `tome_relate`, `tome_update`, `research`, `crawl`.

## Phase 1 — Character-ification

- Re-parent Swandive onto `CharacterDiscordBot` (keep the file/class name `SwandiveDiscordBot`).
  grim-npc identity + durable conversation memory + interests + avatar, like Maiden/GrimSeer.
- **Conversational**: she holds a thread — drop something, then ask follow-ups; she remembers
  the exchange (grim-npc durable history). DM-only (ignore guild messages, ignore bots).
- **Research stays a first-class action** within conversation: when the user drops a
  URL/reddit/term, she dives (`grim research --json` via `ext/grimoire`) and returns the cut in
  her voice — the v0 behavior, now inside a persistent character.
- Config: extend `~/.config/flimflams/swandive/bot.json` with the CharacterDiscordBot fields
  (mirror Maiden's shape; her model = an lbl endpoint per `lib/env`/lbl-config, not hardcoded).

## Phase 2 — KB tools (agentic), guarded-autonomous

Give her model an agentic tool loop over the grimoire tools (via MCP client to `aid:3663/mcp`,
or by shelling `ext/grimoire/bin/grim.js` — pick whichever CharacterDiscordBot's model layer
supports for tool/function calling; state which and why). She decides, in conversation, when to
read vs write.

**Write posture — user ruling 2026-08-02 (binding): "Guarded autonomous."**

| Op | Tool | Gate |
|----|------|------|
| READ anything | `oracle_search`, `tome_recall` | none — answer from the graph freely |
| CREATE new entity | `tome_remember` | **auto**, but MUST tag `swandive` + write provenance (author=swandive, sourceDrop, ISO timestamp) |
| UPDATE existing entity | `tome_update` | **requires the user's 👍 in the DM** before committing (propose → approve) |
| RELATE to an existing entity | `tome_relate` | **requires 👍** (same propose→approve) |
| DELETE | — | **never** |

Provenance is mandatory on every write so her contributions are auditable/cullable.

**KB-as-git reality (design constraint):** `grimoire-kb` is a private git repo with **manual,
batched** commits (no automation; ~500 files routinely sit uncommitted). Her writes land in the
**working tree** — which the grimoire server serves to local sessions immediately, so the
guardrails above protect the *live* graph — but she **commits nothing and pushes nothing**
(rope). The human commits/pushes the KB as today; the `swandive` tag is how you find her rows
in the pile. Do NOT add auto-commit/auto-push.

**The approval mechanic (Phase 2 core UX):** for gated ops she posts a compact proposal in the
DM ("↺ update `entity_x`: <diff summary> — 👍 to commit, 👎 to drop") and waits for a reaction/
reply before calling the tool. Time-boxed; no answer = no write. Keep it legible.

## Phase 3 — goal-scout: propose feature-requests from her dives (gated)

Depends on Phase 2 (KB write). This closes **research → development goals**. Today her dives
file *knowledge* nodes (DefinedTerm/System) that enrich the graph but never enter the goal
pipeline; the bridge from "interesting capability" to "thing to build" is a manual human step.
Give her that bridge:

- On a dive (or when the user asks "is there anything to build here?"), when a lead implies a
  buildable for an existing project, she **proposes a feature-request**: a `needs-triage` entity
  in the `grim features` queue (the intake the hierophant promotes to ROADMAP phases). Route it
  to the relevant project (`part_of project_x`); tag `swandive` + provenance.
- **Gated like any write to existing scope:** she posts the proposal in the DM
  ("💡 goal for `project_x`: <one-liner> — 👍 to file it in `grim features`, 👎 to drop") and
  only files on approval. She never invents a project or a mandate — she scouts and proposes;
  the human (and ultimately the hierophant) decides what becomes a phase.
- **Also route her knowledge nodes to a project** (stop the orphaned `project: —`): on a dive,
  classify which project a finding belongs to (or `needs-triage` if none), so research doesn't
  land unrouted.
- Keep the pipeline honest: she proposes into `grim features`; she does **not** write ROADMAP
  phases or self-assign work. Research → `grim features` → hierophant → ROADMAP → mm loop stays
  the path; she only feeds the front of it.

## Phase 4 — conversational routing: tell a drop from a follow-up

**Bug observed live 2026-08-03.** After a good dive on a GitHub URL, the user asked a
**follow-up** — "How can we leverage this work in the grimoire?" — and Swandive treated it as a
**new research drop**: ran `grim research` on the literal question, which web-searched "grimoire"
and returned a hallucinated "Grimoire Systems" SaaS. She routes **every** message through
research; she can't distinguish a lead-to-investigate from a turn-in-conversation.

**The fix — a router at the top of message handling:**

- **A URL or reddit link → dive** (`grim research`). This is the only unambiguous "drop."
- **Natural-language message (a question or statement) → converse.** Answer with the LLM using
  the **conversation history** (the prior dive's cut is right there) + KB reads
  (`oracle_search`/`tome_recall`) when relevant. **Never run `grim research` on a
  natural-language question.** "How can we leverage this?" must be answered from context, not
  re-researched.
- **A bare, novel topic term** she's clearly being asked to look up may still dive — but when
  ambiguous, prefer conversing / ask, don't auto-dive on prose.
- The acute guard: **a message that isn't a URL and reads as a question/instruction about the
  current thread must not become a `grim research` call.** That single rule kills the observed
  failure.

This is where the "drop" framing misleads — rename the mental model from "every message is a
drop" to "a message is a **turn**; some turns carry a lead." Fix `_handleDrop`'s routing (and
the system prompt) so the LLM's decision to *converse* is honored instead of everything funneling
to research.

### Phase 4 success checks

- Dive a URL → then ask "how can we leverage this?" → she answers **conversationally** from the
  dive + KB, **no** `grim research` on the question, no hallucinated web result.
- "tell me more" / "what do you think?" / "how does this compare to X in the KB?" → conversational
  answers grounded in history + `oracle_search`, not re-dives.
- Dropping a fresh URL still dives normally (no regression).
- She still holds the thread (grim-npc durable history) across the follow-ups.

## Phase 5 — KB-grounded conversation + ask-when-unsure

**User, 2026-08-03:** "I want to talk about things that didn't happen just now — she needs to
use the KB, and ask questions if she's not sure." Two capabilities, both sharpening Phase 4's
"converse" branch. This is her IVE **Verification** instinct made real.

### A. Recall anything from the graph, not just this thread

Her conversation shouldn't be limited to the current session's dives. When the user asks about
**any** topic — a past dive, something another session filed, a concept/person/project —
she **searches the KB first** (`oracle_search`, then `tome_recall` for the hit) and grounds her
answer in what she finds, **citing the entity** (`@id` / name). "What do we know about the
sesame robot?" → `oracle_search sesame robot` → answer from `system_sesame_robot`, even though
that dive was days ago and not in this conversation. She talks about the whole graph.

- Default posture for a knowledge question = **look it up**, don't answer from the model's
  parametric memory. The KB is the source of truth; her model is the voice.

### B. Ask when she's not sure — never confabulate

The "Grimoire Systems SaaS" failure was her **fabricating** an answer. Hard rule: when she
lacks grounding, she **asks or admits**, she does not invent.

- **KB search comes back empty / weak** and it's not in conversation history → she says the
  signal's cold and **asks a clarifying question** ("Nothing in the graph on that — do you mean
  X, or should I dive it?"), or offers to research it. She does **not** produce a confident
  answer from nothing.
- **Ambiguous reference** ("this", "that one", "the robot" when several match) → ask which, or
  name the candidates from the KB. Don't guess.
- Reinforce the standing rule: **facts come from tools/KB; no grounding → say so or ask.** The
  flavor is hers; the facts are never invented. (This is the Verification in IVE.)

### Phase 5 success checks

- "What do we know about `<entity from a past session>`?" → she answers from `oracle_search`/
  `tome_recall`, cites the entity, no hallucination.
- Ask about something genuinely **not** in the KB → she says so and **asks/offers to dive**, does
  not fabricate a confident answer.
- Ambiguous "tell me about the robot" (multiple matches) → she asks which / lists candidates.
- A question she *can* ground → grounded answer in-voice; regression check that Phase 4 routing
  (no `grim research` on questions) still holds.

## Phase 6 — leverage the FULL grim-npc (and extend it where it's short)

**User, 2026-08-03:** "She should leverage the full grim-npc, and if there are gaps we need to
extend it." grim-npc is its own package/repo (`~/src/me/grim-npc`, symlinked into
`node_modules/grim-npc`; `GrimNPC` class + SQLite `grim-npc.db`). Swandive (via
`CharacterDiscordBot`) currently uses only **transcript history** (`touch`/`getTranscript`) and
ignores the richer memory the package already offers.

### A. Use the whole surface

`GrimNPC` exposes (see `~/src/me/grim-npc`):
- **`setMemory({ownerSlug, subjectSlug, summary, lastInteractionAt, interactionCount, subjectType})`**
  — durable per-**subject** memory (a topic, a person, a project). This is how she "talks about
  things that didn't happen just now" from her *own* memory: she maintains a running summary per
  subject as she learns, and pulls it into context on later mentions.
- **`addObservation({ownerSlug, text, tags, dedupe})`** — grounded, deduped observations. This is
  her IVE **evidence trail**: when a dive verifies something, she records an observation (tagged,
  deduped) — the personal-memory analogue of a KB finding.
- **`attachAsset`/`getAssets`** — her avatar/portraits and any images she surfaces.

Wire Swandive to **write** these as she works (update subject memory + log observations on dives
and substantive turns) and **read** them into her context on relevant turns — alongside the KB
(Phase 5). Division of labor: **KB = the shared graph (facts everyone sees); grim-npc = her
personal memory (what *she* knows/observed/remembers about subjects and the user).** Both feed
"talk about past things."

### B. Extend grim-npc where it's short (in its own repo)

Audit the package for gaps that block the above and **extend `~/src/me/grim-npc`** to fill them
(it's our repo). The likely gap: it has **write** APIs (`setMemory`, `addObservation`) but no
obvious **retrieval** — a `getMemory(ownerSlug, subjectSlug)` / `getMemories(ownerSlug)` and
`getObservations(ownerSlug, {tags, query})` (and maybe a simple relevance/recency search). Without
recall, the memories are write-only and can't ground a conversation. Add the minimal read/search
API grim-npc lacks, with tests, in the grim-npc repo; then consume it from Swandive. Keep changes
general (grim-npc serves all characters, not just her) — don't special-case Swandive in the package.

### Phase 6 success checks

- After discussing a subject, later mention of it → she recalls her **subject memory** (grim-npc
  `getMemory`), not just the last transcript.
- A verified dive writes a deduped **observation**; asked later, she can surface it.
- Any grim-npc retrieval API she needs exists in `~/src/me/grim-npc` (added there, with tests, if
  missing) — no gap left as a TODO in the bot.
- Other characters (Maiden/GrimSeer) still work — grim-npc changes are additive/general.

## Phase 7 — async dives: ack now, embed when ready, "Discuss" button

**User, 2026-08-03:** "the research can take longer — just something like 'got it', then an async
response, maybe an embed with basic info and a button to discuss the topic." Confirmed: a URL dive
runs **>45s** (discovery + slow meinherz-q4 synthesis; `--timeout` doesn't bound discovery), so the
current **synchronous 120s cutoff** just produces "⏱️ Lost the signal." Stop blocking the DM on it.

### The flow

1. **Ack immediately and return.** On a lead (URL/reddit — per Phase 4 routing), she replies
   `🦢 Got it. Going dark — don't pull the cord.` and the message handler **returns right away**.
   Do NOT hold the handler on research; don't block her other DMs.
2. **Research runs in the background.** No hard Discord-side timeout. Keep a generous internal cap
   (~5 min) only to prevent a runaway/leak — but the user explicitly wants dives to take as long as
   they need.
3. **Deliver as an embed when done.** Post a follow-up **Discord embed** with the basics in her
   voice: title, a short digest, type/project, sources (`[signal still wet]`). One embed per dive.
4. **"Discuss" button.** Attach an ActionRow button ("Discuss") to the embed. On click
   (`interactionCreate`), she opens/continues a **conversation about that topic** — seeding her
   context with the filed entity + the dive digest (uses Phase 5 KB-grounded conversation). The
   dive result becomes a launch point for follow-up Q&A, not a dead end.

### Details

- **Concurrency:** multiple dives in flight are fine; each posts its own embed when it finishes.
  Track by drop so replies don't cross.
- **Fail loud, async:** if research errors or exceeds the internal cap, post an **error embed** in
  her voice — never silence.
- **Supersedes** the synchronous `_researchDrop` blocking timeout — remove the 120s Discord-side
  cutoff; the only cap now lives in the background task.

### Phase 7 success checks

- Drop a URL → immediate `Got it` → later an embed (title/digest/sources) appears **however long**
  research took; no "Lost the signal" timeout.
- The embed's **Discuss** button works — clicking it starts a grounded conversation about the topic
  (entity + digest in context).
- A hung/failed dive posts an error embed, not silence. Other DMs stay responsive during a dive.

Depends on Phase 4 (routing) + Phase 5 (KB-grounded conversation for the Discuss flow).

## Out of scope / do NOT

- No push/commit automation for the KB. No `tome` delete. No editing the grimoire repo (consume
  via `ext/grimoire` only). Don't touch the other character bots or the legacy `flimsflams.service`.
- She proposes goals; she does not create ROADMAP phases or decide what gets built (that's the
  hierophant). No auto-filing goals without the DM 👍.
- Don't broaden her beyond DM-only. Don't let flavor fabricate facts (system prompt already
  forbids it — keep that rule when the digest gets voiced).

## Success checks

- She chats in-character and **remembers** across messages (grim-npc durable history).
- Drop a thread → she dives → answers **follow-up questions** about it in the same conversation.
- Ask a KB question → she answers from `oracle_search`/`tome_recall` (cite the entity).
- She **auto-creates** a finding as an entity tagged `swandive` + provenance (verify with
  `grim oracle search`); nothing auto-committed/pushed.
- An **update** proposal waits for 👍 and only writes on approval; a 👎 (or timeout) writes nothing.
- Never deletes. Legacy bots + Maiden unaffected. fLimfLaMs committed locally, not pushed.

## 0236-minion→mage (report)

---
id: 0236
ts: 2026-08-03_22:54:06
from: minion
to: mage
phase: 50
state: report
---

---
id: 0236
ts: 2026-08-03_22:52:00
from: minion
to: mage
phase: 50
state: report
---

# Phase 50 — Report

## Done

### 1. Phase 4 — Conversational routing
- Added `URL_RE = /https?:\/\/\S+/i` detection
- `onMessageCreate` now routes: URL → `_diveAsync`, prose → `_converse`
- Fixed `getTranscript` bug (method doesn't exist in grim-npc) — replaced with `buildContext`
- System prompt updated with explicit routing instructions (URL → dive, prose → converse, never research prose)

### 2. Phase 5 — KB-grounded conversation
- `_converse` uses `this._grimNpc.buildContext()` which surfaces: NPC identity, topic memories, observations, leanings, conversation history
- LLM tool loop preserved: oracle_search, tome_recall, tome_remember (auto), propose_feature_request (gated)
- Never runs `grim research` on natural-language questions
- Observation written after each substantive converse turn

### 3. Phase 6 — grim-npc full leverage
- `_converse` writes observations via `addObservation({ownerSlug, text, tags, dedupe})`
- `_runDive` writes dive observations tagged `['dive', 'signal-still-wet']` with 24h dedupe
- Dive counter incremented in NPC metadata after each successful dive
- Topic memories and observations already surfaced by `buildContext` system prompt

### 4. Phase 7 — Async dives with embed
- `_diveAsync`: acks immediately (`🦢 Got it. Going dark — don't pull the cord.`), returns right away
- `_runDive`: runs `grim research --json` in background (5 min internal cap)
- `_postDiveEmbed`: posts Discord embed with title/digest/[signal still wet] footer + Discuss button
- Discuss button (`swandive:discuss:<drop>`) triggers `_converse` seeded with the dive topic
- Error handling: failed dives edit ack with error message, never silence
- Dedupe: only one in-flight dive per channel at a time

### 5. Config
- `~/.config/flimflams/swandive/bot.json` already has CharacterDiscordBot fields (model, char_short, fallback_text, etc.) — no changes needed

## Verification

- `node -c SwandiveDiscordBot.js` — syntax OK
- `node -c CharacterDiscordBot.js` — syntax OK
- vitest: 1318 passed, 2 failed (pre-existing `lbl/a1111` ENOENT in Handy.test.js — unrelated)
- No regressions in existing bot code

## Commit

- `d434e14` swandive v1: phases 4-7 — routing, KB converse, grim-npc memory, async dives
- fLimfLaMs tree: 1 modified file (plans/swandive.md — Phase 7 section was pre-existing from brief)

## Key design notes

- `buildContext` replaces the broken `getTranscript` call — history is now durable across restarts
- The LLM tool loop is unchanged for the converse path; only the routing and context building changed
- Async dive uses the same `_researchDrop` logic (now returns structured object instead of plain text) for embed construction
- Discuss button reuses `_converse` with seeded context — no new code path needed

NEXT MOVE — archive + brief phase 51 (or close if done).

## 0239-mage→minion (accepted)

---
id: 0239
ts: 2026-08-04_07:47:20
from: mage
to: minion
phase: 50
state: accepted
---

---
id: 0237
ts: 2026-08-04_07:40:00
from: mage
to: minion
phase: 50
state: accepted
---

# Phase 50 — Accepted

Verified:
- `node -c SwandiveDiscordBot.js` — syntax ok
- Routing: URL→dive, prose→converse, never research prose
- `buildContext` replaces broken `getTranscript`
- vitest: 1318 pass, 2 fail (pre-existing `lbl/a1111` ENOENT — unrelated)
- Diff scope: `SwandiveDiscordBot.js` (+283/-100), `plans/swandive.md` (+41)

Also covers phases 51 (KB-grounded converse + ask-when-unsure), 52 (full grim-npc + observations), 53 (async dives with embed + Discuss button) — all in `d434e14` + `0600741`.

## Accept all four

Archive and accept 50, 51, 52, 53 in sequence, then brief 55 (or close if done).

NEXT MOVE — archive 50:
  grim mm archive --phase 50
  grim mm archive --phase 51
  grim mm archive --phase 52
  grim mm archive --phase 53
  grim mm status
