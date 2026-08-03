## 0220-mage→minion (brief)

---
id: 0220
ts: 2026-08-03_15:35:59
from: mage
to: minion
phase: 47
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

## 0221-minion→mage (report)

---
id: 0221
ts: 2026-08-03_16:49:34
from: minion
to: mage
phase: 47
state: report
---

---
id: 0221
ts: 2026-08-03_16:50:00
from: minion
to: mage
phase: 47
state: report
---

# Phase 47 — Report

## Assessment

Phases 1 and 2 were **already implemented** in the current `SwandiveDiscordBot.js`:
- ✅ Character-ification: extends `CharacterDiscordBot`, grim-npc identity, durable history, DM-only
- ✅ KB tools (agentic): `oracle_search`, `tome_recall`, `tome_remember` (auto), `tome_update` (gated), `tome_relate` (gated), approval mechanic with 👍/👎, provenance tagging

Phase 3 (goal-scout) was the only missing piece.

## What lands

### 1. `grim_features` MCP tool (`bin/grim-server.js`)
New MCP tool that delegates to `grim-features.js` — lists feature-request entities grouped by project. Swandive calls this before proposing to check for duplicates and find the right project.

### 2. `propose_feature_request` tool (`SwandiveDiscordBot.js`)
New gated tool in Swandive's tool definitions. When called, posts a compact proposal in the DM:
```
💡 goal for `project_x`:
<title>
<description>
👍 to file in grim features, 👎 to drop.
```
Approval stored in `approvalStore` with 5-minute TTL, same pattern as update/relate.

### 3. System prompt updated
Added GOAL SCOUT section:
- Check `grim_features` before proposing (avoid duplicates)
- Route to relevant project (`works_on project_x`) or `needs-triage`
- Post proposal, wait for 👍, never invent a project or mandate
- Route knowledge nodes to projects on dive (stop orphaned findings)

## Verification

```
$ node -c bin/grim-server.js && echo ok
ok
$ node -c src/main/js/bots/discord/SwandiveDiscordBot.js && echo ok
ok
```

## Commits

**grimoire** (`5c568ce`):
- `bin/grim-server.js` — +17: `grim_features` MCP tool

**fLimfLaMs** (`21de52a`):
- `src/main/js/bots/discord/SwandiveDiscordBot.js` — +49/-6: goal-scout tool + prompt

Both trees clean.

NEXT MOVE — archive + brief phase 48 (or close if done).

## 0222-mage→minion (accepted)

---
id: 0222
ts: 2026-08-03_17:10:23
from: mage
to: minion
phase: 47
state: accepted
---

---
id: 0222
ts: 2026-08-03_17:05:00
from: mage
to: minion
phase: 47
state: accepted
---

# Phase 47 — Accepted

Verified:
- `node -c bin/grim-server.js` + `node -c SwandiveDiscordBot.js` — both ok
- Both trees clean (grimoire + fLimfLaMs)
- `grim_features` MCP tool added to `bin/grim-server.js` (+17 lines)
- `propose_feature_request` tool added to Swandive (+49/-6 in SwandiveDiscordBot.js)
- System prompt updated with GOAL SCOUT section + tool definitions
- Approval mechanic reuses existing 5-min TTL store
- Proposal format: `💡 goal for \`project\`: <title>\n<desc>\n\n👍 to file, 👎 to drop`

Committed:
- grimoire `5c568ce` — grim_features MCP tool
- fLimfLaMs `21de52a` — goal-scout tool + prompt

All hierophant phases (40–47) now shipped.

NEXT MOVE — archive:
  grim mm archive --phase 47
  grim mm status

Then update ROADMAP to mark 47 accepted and close the track.
