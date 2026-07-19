# Phase 8 — streamline the pact tooling: mechanics into `grim mm`, slim skills, cap the briefing

**Authority:** hierophant, 2026-07-19. **Repo:** grimoire only (the plugin lives at
`plugin/` in this repo; `~/data/claude-plugins/plugins/grimoire` is a symlink to it).

**Why:** the three pact skills re-explain the same state machine in prose three times
(Rule 13 violation — the models re-derive mechanics every invocation), the mage skill
hand-walks a shell archive procedure, and the `grim load` briefing payload has grown
to ~70K chars — it overflows the MCP tool-result limit. Mechanics move into code;
skills keep only judgment.

## 1. `grim mm status` (new subcommand, `bin/grim-mm.js`)

One line: message count, latest message (`#NNNN-role`, state, phase), and who owes the
next move (derive from the same rules `read` already uses). `--json` variant.

## 2. `grim mm archive --phase N` (new subcommand)

- Concatenate that phase's messages, in sequence order, each preceded by a
  `## NNNN-role (state)` header, to `plans/reviews/phase-N.md`.
- `git add` + commit it with message `mm: archive phase N review thread`.
- Refuse (exit 1, clear message) if the phase's latest state is not `accepted`,
  or if the output file already exists (no silent overwrite; `--force-overwrite` to replace).

## 3. Role-aware next-move footer on `grim mm read`

After the existing output, print a footer that makes the skills' prose redundant:

- Unread message shown → the exact reply command:
  `grim mm write --role <role> --session … --state <s> --file <reply.md>` with the
  legal states for that role/situation listed (mage answering report: `accepted|revise`;
  minion answering brief/revise: `report|question|blocked`; etc.).
- `WAITING` / `EMPTY` → keep as today, one line each.
- Mage reading a terminal `accepted` (PHASE COMPLETE) → print:
  `next: grim mm archive --phase N, then brief phase N+1 (--state brief) or declare done.`

Keep the footer ≤ 4 lines. `--json` output gets a `nextMove` field with the same facts.

## 4. Slim the three pact skills (`plugin/skills/{hierophant,mage,minion}/SKILL.md`)

- Each body ≤ ~30 lines: role identity (2–3 sentences), judgment rules
  (verify-don't-trust / scope discipline / when to escalate / mediate-by-exception),
  tone, and the single read command. Frontmatter (name/description/version/allowed-tools)
  stays; bump version to 0.3.0.
- Delete from all three: the repeated pact-architecture paragraphs, the state-machine
  walkthroughs, the `--force` semantics, flag syntax for `write`, and the mage's manual
  archive procedure — the `read` footer (item 3) now carries all of that at the moment
  it's needed. Keep exactly one line per skill: "read with `grim mm read`, reply with
  the command it prints; never touch `.mm/` files by hand."
- Do not change what the skills *decide* — only where mechanics live.

## 5. Cap the `grim load` briefing (`bin/grim-session.js`)

In the projection builder (the code around lines 200–250 that already trims sessions):

- `turningPoints`: keep top 3 (significance high first, then most recent).
- `recentEpisodes`: keep ≤ 5; truncate each summary to 400 chars with `…`.
- `recentSessions`: keep ≤ 3, already-trimmed shape.
- `techniques`: keep ≤ 8, name + first sentence of description only.
- Drop empty arrays/objects and empty-string fields from the output entirely.
- Budget check: `grim load --json | wc -c` ≤ 20000 against the live KB.

The HTTP route and MCP `session_load` go through the same builder — verify both shrink
(touch `bin/grim-server.js` only if it inlines its own projection; declare it if so).

## Out of scope / do NOT

- No changes to `grim mm read/write` semantics themselves (numbering, unread rules,
  refusal logic) beyond appending the footer.
- No changes to `plugin/skills/load/SKILL.md` — the payload was the problem, not the skill.
- No KB entity edits (the mage notes follow-up for the spell entities on acceptance).
- Don't touch the live `.mm/` thread; exercise archive/status/read against a throwaway
  thread dir in a temp path (`grim mm` takes its dir from cwd — run from a temp dir).

## Success checks (mage runs these)

- `grim mm status` against the live thread reports the true latest message and owner.
- In a temp thread: seed brief→report→accepted for phase 1; `archive --phase 1` writes
  the concatenated file and commits; rerun refuses; archive of an open phase refuses.
- `grim mm read` as mage over an unread report shows the `accepted|revise` footer;
  over a terminal accepted shows the archive+brief-next line; minion over a brief shows
  `report|question|blocked`.
- Each pact SKILL.md body ≤ 30 lines; no shell walkthroughs or state tables remain.
- `grim load --json | wc -c` ≤ 20000; MCP `session_load` returns without the
  oversized-result spill.
- Footprint: `bin/grim-mm.js`, `bin/grim-session.js`,
  `plugin/skills/{hierophant,mage,minion}/SKILL.md`
  (+ `bin/grim-server.js` only if declared). Nothing else.
