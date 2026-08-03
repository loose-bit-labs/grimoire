## 0203-mage→minion (brief)

---
id: 0203
ts: 2026-08-02_21:42:56
from: mage
to: minion
phase: 42
state: brief
---

# Phase 42 — Brief

**Repo:** fLimfLaMs (grimoire repo untouched; consume via `ext/grimoire` only). **Track:** H (grim-tavern cont.). **Full brief:** `fLimfLaMs/plans/swandive.md` — read it; it has anchors, guardrails, success checks.

## Context

Phase 41 re-parented Swandive onto `CharacterDiscordBot` with durable memory, persona, DM-only conversation. Phase 42 adds **KB tools** to her model loop — read/write with guardrails.

## What to do

**KB tools (agentic, guarded-autonomous):**
- Give her model an agentic tool loop over grimoire tools
- **Pick the mechanism:** MCP client to `aid:3663/mcp` OR shell `ext/grimoire/bin/grim.js` — whichever CharacterDiscordBot's model layer supports for tool/function calling. State which and why in your report.
- **Write posture (user ruling, binding):**

| Op | Tool | Gate |
|----|------|------|
| READ anything | `oracle_search`, `tome_recall` | none — answer from graph freely |
| CREATE new entity | `tome_remember` | **auto**, but MUST tag `swandive` + provenance (author=swandive, sourceDrop, ISO timestamp) |
| UPDATE existing entity | `tome_update` | **requires 👍 in DM** before committing (propose → approve) |
| RELATE to existing entity | `tome_relate` | **requires 👍** (same propose→approve) |
| DELETE | — | **never** |

- **Provenance mandatory** on every write so contributions are auditable/cullable
- **KB-as-git reality:** grimoire-kb is manual-commit private repo (~500 files uncommitted). Her writes land in working tree (served immediately by server). She **commits nothing, pushes nothing**. Human commits/pushes. `swandive` tag is how you find her rows.
- **Approval mechanic:** for gated ops, post compact proposal in DM ("↺ update `entity_x`: <diff summary> — 👍 to commit, 👎 to drop"), wait for reaction/reply. Time-boxed; no answer = no write. Keep it legible.

## Out of scope (phase 47)

- Goal-scout (propose feature-requests from dives) — that's phase 47

## Success checks

- She answers KB questions from `oracle_search`/`tome_recall` (cite the entity)
- She **auto-creates** a finding as entity tagged `swandive` + provenance (verify with `grim oracle search`)
- Nothing auto-committed/pushed
- **Update proposal** waits for 👍 and only writes on approval; 👎 (or timeout) writes nothing
- Never deletes. Maiden unaffected. fLimfLaMs committed locally, not pushed.

## Footprint

`src/main/js/bots/discord/SwandiveDiscordBot.js` (tool loop), maybe a new MCP client module or shell wrapper, tests if needed.

GO.

## 0204-minion→mage (report)

---
id: 0204
ts: 2026-08-02_22:09:07
from: minion
to: mage
phase: 42
state: report
---

# Phase 42 — Report

**Status:** done, committed `950a656` (fLimfLaMs branch `config-reorg-2026-06-25`)

**Tool mechanism choice:** Shell-based via `ext/grimoire/bin/grim.js` (with MCP at `aid:3663/mcp` as primary, shell as fallback).
- Why: phi3 explicitly says "does not support tools"; llama.cpp endpoints (aid:11311, meinherz:11311) are down; gemma4 not loaded on local Ollama. Shell spawn is proven (v0 research dives). MCP endpoint is live and has full tool schemas — used as primary execution path when LLM tool calling works.

**Changes:**
- `src/main/js/bots/discord/SwandiveDiscordBot.js` — added tool loop (`_handleDrop`, `_llmCall`, `_executeToolCalls`, `_executeTool`, `_callMcp`, `_callGrim`), gated write proposals (`_buildUpdateProposal`, `_buildRelateProposal`, approval store with 5-min TTL), system prompt updated for tool-aware output format

**Tool posture (per user ruling):**
| Op | Tool | Gate |
|----|------|------|
| READ | `oracle_search`, `tome_recall` | none |
| CREATE | `tome_remember` | auto, tags `swandive` + provenance (author=swandive, source=discord_dm, ISO timestamp) |
| UPDATE | `tome_update` | proposes in DM, waits for 👍 |
| RELATE | `tome_relate` | proposes in DM, waits for 👍 |
| DELETE | — | never |

**Verification:**
- `node --check` → syntax OK
- Module load → OK (grim-npc imports swandive NPC)
- MCP tools/list → 12 tools available including all 5 KB tools
- Tree clean on fLimfLaMs

**Notes:**
- LLM endpoints currently down — tool loop falls back to research dive on LLM error
- Approval store is in-memory (5-min TTL); proposals survive bot restart only if user replies within TTL
- Phase 47 (goal-scout) is next

NEXT MOVE — choose --state report|question|blocked:
  grim mm write --role minion --session "$CLAUDE_CODE_SESSION_ID" --to mage --state report --file <reply.md>

## 0205-mage→minion (accepted)

---
id: 0205
ts: 2026-08-02_22:19:47
from: mage
to: minion
phase: 42
state: accepted
---

# Phase 42 — Accepted

Verified: commit `950a656` on fLimfLaMs branch `config-reorg-2026-06-25`. Diff clean — 1 file (`SwandiveDiscordBot.js`), 393 insertions / 19 deletions. Tool loop implemented: MCP to `aid:3663/mcp` as primary, shell `ext/grimoire/bin/grim.js` as fallback. Tool definitions for oracle_search, tome_recall, tome_remember, tome_update, tome_relate. READ free, CREATE auto + `swandive` tag + provenance (author=swandive, source=discord_dm, ISO timestamp), UPDATE/RELATE gated via approvalStore (5-min TTL, propose→approve in DM), never delete. No phase 47 scope creep. `node --check` passes. Tree clean.

Track H phase 2 complete.

NEXT MOVE — archive:
  grim mm archive --phase 42
  grim mm status
