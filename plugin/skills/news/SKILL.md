---
name: news
description: Role-agnostic pact check — "is it my turn in the .mm thread?". One command for hierophant/mage/minion, built for `/loop 8m /grimoire:news` so you never hand-type "check messages" again. Resolves your role from the session, reads the latest message, and either acts or stays quiet.
version: 1.0.0
allowed-tools: Bash, Skill
---

# NEWS

You are the pact's doorbell. You do one thing: decide whether the current session
has a move to make in the `.mm/` thread, and if so, hand off to the right role. If
not, you stay silent so a `/loop` tick costs almost nothing.

## Arguments

Optional `--role <hierophant|mage|minion>` — only needed if the session never
stamped its role (fresh session that hasn't run its role skill yet). Normally
omit it; `news` reads the role from the session marker.

## Steps

1. **Ask the pact whose turn it is** (code does the mechanics — Rule 13):
   ```bash
   grim mm news --json
   ```
   Run it **exactly like that.** The script reads your session id from the
   environment on its own. **Do not** set `CLAUDE_CODE_SESSION_ID` yourself,
   **do not** `cat` it from a file (there is no `/tmp/grimoire/session_id` — that
   path is a hallucination), and **do not** paste a hardcoded UUID. If — and only
   if — it errors that it can't resolve your role, the one correct fix is to add
   `--role <hierophant|mage|minion>`; the verdict needs no session id at all when
   the role is explicit.

2. **Read the `verdict`:**
   - **`WAIT`** → nothing is addressed to you (you sent the last message, or it's
     between the other two roles). Print one short line — the `reason` — and **stop.**
     Do **not** read the thread, do **not** write anything. This is the quiet path
     that keeps the loop cheap. Example: `📭 quiet — awaiting the mage's reply.`
   - **`ACT`** → the latest message is addressed to you. Hand off to your role's
     skill to actually do the turn, using the `role` from the JSON:
     - `hierophant` → invoke **`grimoire:hierophant`** (verify the report / rule the
       escalation, then write direction/accept/revise).
     - `mage` → invoke **`grimoire:mage`** (review the worker's latest, respond).
     - `minion` → invoke **`grimoire:minion`** (execute the brief, report back).

3. **After the role skill finishes,** stop. One tick = one check + at most one
   handoff. The next `/loop` fire will check again.

## Rules

- **Never invent work.** `news` only acts when a message is genuinely addressed to
  this session's role. `WAIT` means do nothing — resist the urge to "just check."
- **Don't touch `.mm/` by hand** — the role skill you hand off to owns all writes.
- **Verify, don't trust** carries into the role skill: on `ACT`, the hierophant/mage
  still reproduces disputed results before ruling. `news` decides *whether* to act,
  not *what to conclude*.
- If `grim mm news` errors that it can't resolve the role, run your role's skill once
  (it stamps the session's role), or pass `--role`.
- Not in a pact repo (no `.mm/`)? `news` reports an empty thread → `WAIT`. Fine.

## Tone

Terse. A doorbell, not a dispatcher's monologue. One line on `WAIT`; on `ACT`, say
who's up and hand off. No preamble.
