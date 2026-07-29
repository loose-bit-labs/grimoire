# Phase 32 — grim-tavern go-live: cut flimsflams over to the researcher (staged, reversible)

**Authority:** hierophant, 2026-07-29. **Repo:** fLimfLaMs (grimoire untouched).
Track H (grim-tavern). **`requires: permission`** — this restarts a live user service;
the actual cutover is a user-gated step, not autonomous.

## Reality check (why this is a cutover, not a cherry-pick)

The researcher bot (`767a7f5`) extends **`CharacterDiscordBot.js` (1169 lines)** that
exists **only** on branch `config-reorg-2026-06-25`. That branch is a **78-file,
+7791/−2038 rewrite**: it deletes `FlimflamsDiscordBot.js` and `LaBotAmi.js`, relays the
`src/main/js` layout, and rewires NPC identity/history/avatars/interests to grim-npc. The
researcher cannot be separated from it. **Live `flimsflams.service` runs pre-reorg `main`
(up since 2026-06-20) and has never executed this branch.** So shipping the doorbell =
cutting the whole refactor into production. Treat it with that respect.

## What lands (in order; do not skip verification gates)

1. **Reconcile drift.** `main` may have advanced since 2026-06-25. Merge `origin/main`
   into `config-reorg-2026-06-25` (or rebase), resolve conflicts, commit. If `main` is
   unchanged since the branch point, note that and move on.
2. **Green the branch.** Run the full vitest suite on the branch (tests were *added* here —
   `CharacterDiscordBot.durable-history`, `GrimEmbeds`, `GrimWorldBridge`, `Handy.utils`).
   Paste the actual pass count. Red suite → stop, report, do not restart the service.
3. **Bot-parity inventory (the real risk).** Enumerate every bot the *live* process serves
   today (read the running `bots.json` / config the June-20 process loaded) and confirm the
   branch still serves each one — the branch **deleted** the old bot classes, so any live
   bot not ported to `CharacterDiscordBot` would go **dark** on cutover. List each live bot
   → its branch equivalent. Any gap is a blocker; report it, don't cut over.
4. **Register the researcher.** Ensure the researcher persona
   (`server/personalities/researcher.md` + `ResearcherDiscordBot.js`) is enabled in the
   branch's bot config so the running process actually instantiates it. Confirm the
   `ext/grimoire` symlink resolves and `node ext/grimoire/bin/grim.js research "x" --json`
   returns valid JSON from within the flimflam repo.
5. **Controlled restart (USER-GATED).** In a window where logs can be watched:
   `systemctl --user restart flimsflams` with the checkout on the reconciled branch. Tail
   the journal; confirm the process comes up and every inventoried bot reconnects.
6. **Verify the doorbell end-to-end.** DM the researcher a real URL → it acks → calls
   `grim research --json` via `ext/grimoire` → a KB entity is filed (check with
   `grim oracle search`), and a feature-request-type drop shows in `grim features`. DM a
   bare term and a project note too (the three drop classes).

## Rollback (must be documented and tested-in-principle)

Known-good is pre-reorg `main`. Rollback = `git checkout main && systemctl --user restart
flimsflams` → returns to the June-20 behavior. State this explicitly in the report; the
user must be able to revert in one line if a bot misbehaves after cutover.

## Out of scope / do NOT

- No new features. Not the grim-npc "tavern remembers you as a character" memory polish
  (separate future track). This phase only makes the **already-accepted** code *run*.
- Don't touch the grimoire repo. Don't push either repo — commit locally; the user pushes.
- Don't cut over on a red suite or an unresolved bot-parity gap.

## Success checks

- Branch suite green (pasted). Bot-parity table shows no live bot lost.
- After restart: all prior bots reconnect + respond; researcher DM round-trips a URL to a
  filed KB entity; `grim features` reflects a note drop.
- Rollback line documented. fLimfLaMs repo only; nothing pushed.
