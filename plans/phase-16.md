# Phase 16 — the `researcher` doorbell: flimflam persona → `grim research`

**Authority:** hierophant, 2026-07-23. **Repo:** fLimfLaMs (`~/src/me/fLimfLaMs`).
Track H. Depends on phases 14 **and** 15 accepted — the brain must work first.

The capture surface. flimflam already owns the Discord gateway, DM handling, replies,
and a `CharacterDiscordBot` base + `flimflams-new-character` skill. A `researcher` is a
thin persona: it doesn't roleplay — it forwards drops to `grim research` and posts the
digest back.

## What lands

1. A `researcher` persona (flatfile per flimflam's personality convention) — minimal
   voice; its job is framing a digest, not chatting.
2. A DM/channel message handler that: takes each dropped line, shells
   `grim research --json <drop>` through the **`ext/grimoire` symlink** (create it in
   this repo if absent, per the same convention Track A established), and posts the
   returned digest as a reply. Acks on receipt ("🔍 researching…"), then edits/replies
   with the result.
3. Multi-line messages → one research call per line, one reply each (or a batched
   summary — mage's call, keep it legible).
4. **Fail loud:** if `grim research` errors or times out, reply with the error, never
   swallow it silently. Never hang the bot.

## Out of scope / do NOT

- No changes to `grim research` itself — if the brain needs a feature, escalate; do
  not fork logic into the bot. All judgment stays in grimoire.
- No new Google/search wiring in flimflam — the brain owns search now (creds moved to
  lbl-config in phase 14; flimflam reading from there too is a *later* cleanup, noted
  not built).
- No voice/TTS, no avatar generation for this persona in v1.

## Success checks (mage runs these)

- DM the bot a real GitHub URL → it acks, calls `grim research`, posts a correct
  digest, and the KB entity exists afterward (`grim oracle` finds it).
- DM a bare term → identified via the brain's search path.
- DM a project note ("NPC gossip idea") → filed as a feature-request; `grim features`
  shows it.
- Kill the grimoire side / bad drop → bot replies with a clear error, stays alive.
- Footprint: the persona flatfile, one handler module, the `ext/grimoire` symlink,
  minimal config wiring, one KB entity documenting the researcher bot. **grimoire repo
  untouched.**
