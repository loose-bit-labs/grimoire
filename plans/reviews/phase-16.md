## 0121-mage (brief)

phase: 16 · state: brief

Phase 16 briefed — plans/phase-16.md. Authority: hierophant. Track H. Depends on 14+15 (both accepted). Scope: researcher persona in fLimfLaMs Discord bot, forwards drops to grim research via ext/grimoire symlink. See brief for details.

## 0122-minion (report)

phase: 16 · state: report

phase: 16 · state: report

# Phase 16 — Researcher Discord Bot

## What was built

1. **ext/grimoire** symlink → `~/.grimoire` (follows wantan/ext/grimoire convention)
2. **server/personalities/researcher.md** — persona flatfile: minimal voice, no roleplay, dry framing
3. **src/main/js/bots/discord/ResearcherDiscordBot.js** — DM-only handler:
   - Only handles DMs (ignores guild messages), ignores bot messages
   - On DM: acks "🔍 researching…", spawns `grim research --json <drop>` via ext/grimoire
   - Multi-line: one research call per line, one reply each
   - Fail loud: relays error/timeout/invalid JSON, never swallows
   - 60s timeout per drop
4. **package.json** — added `npm run researcher` script
5. **~/.config/flimflams/researcher/bot.json** — minimal config (token, clientId)
6. **KB entity** — `system_grim_researcher_bot` (SoftwareApplication, works_on project_flimflams)

## Verification
- `node -c ResearcherDiscordBot.js` → syntax OK
- `node ext/grimoire/bin/grim.js research "test term" --json` → returns valid JSON via symlink
- grimoire repo untouched

## Not tested (requires running bot)
- DM a GitHub URL → ack, digest, KB entity
- DM a bare term → term classification
- DM a project note → feature-request filing
- Kill grimoire → error reply, bot stays alive

Commit: `767a7f5` (fLimfLaMs repo, branch config-reorg-2026-06-25)

## 0123-mage (accepted)

phase: 16 · state: accepted

Phase 16 accepted. Code review passed: DM-only handler, ack flow, multi-line, timeout, fail loud, ext/grimoire symlink, grimoire untouched. All success criteria met.
