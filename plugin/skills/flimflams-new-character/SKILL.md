---
name: flimflams-new-character
description: Spin up a new channel-resident Discord character bot using the CharacterDiscordBot base class in fLimfLaMs. Use when you want a personality-driven Discord bot with LLM pipeline, A1111 image gen, and vision — driven entirely by a JSON config file, no code changes needed.
version: 1.0.0
allowed-tools: [Bash, Read, Write, Edit]
---

# /flimflams-new-character — THE SUMMONER

You instantiate new character bots. Code is a wrapper. Personality is config. Three files and a service.

## Arguments

`<character-name>` — slug for the new bot (e.g. `wizard`, `janitor`, `herald`)

Optional:
- `--channel <id>` — Discord channel ID where the character lives
- `--config <path>` — override config file path (default: `~/.{character-name}.json`)

## What you're building

A thin entry-point class (`{Character}DiscordBot.js`) that extends `CharacterDiscordBot` and points at a JSON config file. The base class in `src/main/js/lib/discord/bots/CharacterDiscordBot.js` handles everything:

- LLM pipeline (remix / lore / bio mode detection via single JSON-returning call)
- A1111 image generation with negative prompt guard
- Vision model for image attachments (sharp converts WebP/non-JPEG before sending)
- Per-user epithets persisted to `~/.{classname}-epithets.json`
- Reaction-triggered remix (configurable emoji, default 📋)
- Remix chains (reply to bot embed → remixes bot's own output)
- Idle proclamation timer (checks every 60s, fires if idle > interval)

## Steps

### 1. Create the entry point

Write `src/main/js/bots/discord/`**`{Character}DiscordBot.js`** — exactly 16 lines:

```js
#!/usr/bin/env node

const root = `${process.cwd()}/src/main/js`
const CharacterDiscordBot = require(`${root}/lib/discord/bots/CharacterDiscordBot`)

class {Character}DiscordBot extends CharacterDiscordBot {
    constructor() {
        super({
            default: {
                configuration_file: `${process.env.HOME}/.{character-name}.json`,
            },
        })
    }
}

new {Character}DiscordBot().main()
```

Replace `{Character}` with PascalCase class name, `{character-name}` with the kebab-case slug.

### 2. Create the config file at `~/.{character-name}.json`

Required fields:
```json
{
  "token": "<Discord bot token>",
  "clientId": "<application ID>",
  "channel_id": "<Discord channel snowflake>",
  "model": "gemma4:26b",
  "char_short": "<12-20 token appearance description for t2i prompts>",
  "char_full": "<full appearance description for system prompt context>",
  "lore_places": "\"<place name>\" or \"<server name>\"",
  "style_tag": "anime style, clean linework, vibrant lighting, expressive face",
  "bio_style_tag": "chibi style, oversized head, tiny body, exaggerated expression, pastel palette",
  "fallback_text": "<safe fallback reply for harmful input>",
  "negative_prompt": "ugly, deformed, blurry, extra limbs, poorly drawn, text, watermark, nsfw, sexy, cheesecake, suggestive, revealing, crop top, low cut, cleavage, idol, diva, realistic, photorealistic, bad anatomy, malformed hands, simple background",
  "footer": "🏛️ <Server Name> • <Channel Name>"
}
```

Optional fields (all have defaults in `CharacterDiscordBot`):
```json
{
  "vision_model": "llava",
  "reaction_emoji": "📋",
  "proclamation_interval": 180,
  "history_window": 3,
  "a1111_model": "qwenImageFp8E4m3fn_v10.safetensors",
  "steps": 25,
  "cfg_scale": 9,
  "width": 768,
  "height": 512,
  "sampler": "DPM++ 2M",
  "titles": { "remix": "✨ Remix", "lore": "📜 Lore", "bio": "🎀 Bio" },
  "colors": { "remix": 10053302, "lore": 13150545, "bio": 16745889 },
  "epithets_file": "/absolute/path/to/epithets.json",
  "proclamation_seeds": ["<seed prompt>", "<seed prompt>"],
  "vision_confused_reply": "*squints at the image, retreats in confusion*",
  "epithet_prompt": "<custom epithet system prompt>",

  "chum_webhook_url": "https://discord.com/api/webhooks/ID/TOKEN",
  "chum_avatar_channel": "<channel-id for avatar image posts — defaults to channel_id>",
  "maiden_weight": 0.3,
  "chum_floor_exchanges": 3,
  "chum_hot_threshold": 0.55,
  "chum_image_width": 384,
  "chum_image_height": 256,
  "chum_history_window": 2,
  "chum_words": ["archipelago", "theorem", "..."],
  "chums": "<array of chum objects — omit to use 7 built-in archetypes>"
}
```

### Chums system

`CharacterDiscordBot` ships with 7 built-in chum personas (Prudence, Vesper, Petra, Dot, Brix, Ada, Mora). They activate automatically if the channel has any activity. To override, set `"chums": [...]` in `bot.json`.

Each chum object:
```json
{
  "name": "Prudence",
  "avatar_url": null,
  "color": 9150915,
  "char_short": "studious girl, round glasses, neat twin braids, plaid skirt",
  "style_tag": "anime style, soft watercolor, warm lighting",
  "system_prompt": "You are Prudence, a perpetually stressed student...",
  "footer": "🏛️ Chamber • Prudence"
}
```

**State layout** (per chum, auto-created):
```
~/.config/flimflams/{bot-slug}/chums/{name}/
  interests.json     ← LLM-bootstrapped on first run; drifts via interests_update
  avatar_url.txt     ← Discord CDN URL (stable, no expiry params)
  avatar.png         ← local copy of avatar image
```

**Routing priority** (onMessageCreate):
1. Natural language roll call ("who's here?", "roll call") → all chums + Maiden respond in order
2. @name mention → that chum gets the floor for `chum_floor_exchanges` exchanges
3. Hot-button topic detected → highest-scoring chum takes the floor
4. Active chum holds floor → continues until exchanges expire
5. Maiden pipeline (remix/lore/bio)

**Slash command**: `/rollcall` — registers via `--deploy`, triggers all chums + Maiden to say "present" in character.

**Avatar generation**: on first `onReady` with missing avatars, generates 256×256 portraits via A1111 and posts them to `chum_avatar_channel`. CDN URLs saved to `avatar_url.txt` (query params stripped for stability). Subsequent restarts load from disk — no regeneration.

**Webhook identity**: set `chum_webhook_url` (one webhook serves all chums). Each post overrides `username` and `avatar_url` so chums appear as distinct identities in Discord. Replies from @mentions also go through the webhook (no Discord thread-reply — webhooks can't reply).

### 3. Deploy slash commands

```bash
cd ~/.flimflams
node src/main/js/bots/discord/{Character}DiscordBot.js --deploy
```

Note: the base class registers no slash commands by default — the character is message-driven. If deploy fails, check that the bot is added to the server with Message Content Intent enabled in the Discord Developer Portal.

### 4. Enable Message Content Intent

In Discord Developer Portal → Applications → `<clientId>` → Bot → Privileged Gateway Intents:
- Enable **Message Content Intent**

Without this, the bot will start but receive no message content (silent failure).

### 5. Add the bot to the server

Use the OAuth2 URL Generator: Applications → `<clientId>` → OAuth2 → URL Generator.
- Scope: `bot`, `applications.commands`
- Permissions: Send Messages, Embed Links, Add Reactions, Read Message History, Attach Files

### 6. Write the systemd service

Write `server/systemd/{character-name}.service` in the repo, then symlink it:

```bash
ln -s ~/.flimflams/server/systemd/{character-name}.service ~/.config/systemd/user/{character-name}.service
```

Service file contents:

```ini
[Unit]
Description={character-name} — <description>
After=network.target

[Service]
WorkingDirectory=%h/.flimflams
ExecStart=%h/.flimflams/bin/node src/main/js/bots/discord/{Character}DiscordBot.js --configuration_file %h/.config/flimflams/{character-name}/bot.json
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/data/logs/flimflams/{character-name}.log
StandardError=append:%h/data/logs/flimflams/{character-name}.log

[Install]
WantedBy=default.target
```

`%h` is the systemd specifier for the user's home directory — no hardcoded paths.

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable {character-name}.service
systemctl --user start {character-name}.service
systemctl --user status {character-name}.service
```

### 7. Verify

```bash
journalctl --user -u {character-name}.service -f
```

Look for the bot logging `{"level":30,"clash":"{Character}DiscordBot","msg":"..."}` — pino JSON output. If you see `Used disallowed intents`, go back to Step 4.

## Rules

- **Never hardcode endpoints in the bot file** — `CharacterDiscordBot` resolves `@(lbl/openai)`, `@(lbl/a1111)`, `@(lbl/ollama)` from `~/.config/lbl-config.json` via `Handy.angularia()`.
- **`char_short` should be ≤20 tokens** — it appears at the start of every t2i prompt and competes for attention budget with scene elements. Long character descriptions drown out scene-specific content.
- **`negative_prompt` must include** `nsfw, sexy, cheesecake, suggestive, revealing, crop top, low cut, cleavage` — especially for young or school-uniform-coded characters.
- **LLM must return JSON** `{"mode": "lore"|"bio"|"remix", "text": "...", "t2i_prompt": "..."}` — system prompt enforces this. If using Qwen3.x via llama-server, `chat_template_kwargs: { enable_thinking: false }` is already set in the base class; if swapping models verify this stays in the request body.
- **The entry point file is 16 lines** — all logic lives in `CharacterDiscordBot`. If you need to customize behavior, override specific methods rather than copying pipeline code.
- **The epithets file is named after the class** by default — `~/.{classname.toLowerCase()}-epithets.json`. It accumulates across restarts. Delete to reset all epithets.
- **Proclamation timer checks every 60s** but only fires if `Date.now() - lastActivity >= interval`. Setting `proclamation_interval: 0` effectively disables it.

## Portability

All service endpoints resolved at runtime from `~/.config/lbl-config.json` via `Handy.angularia()`:
- `@(lbl/openai)` → `endpoints[use.openai]` → LLM server (OpenAI-compatible)
- `@(lbl/a1111)` → `endpoints[use.a1111]` → AUTOMATIC1111 or compatible
- `@(lbl/ollama)` → `endpoints[use.ollama]` → Ollama (for llava vision)

The bot will still start if endpoints are unreachable — it falls back to `fallback_text` for LLM failures and skips the image if A1111 is down.

## Tone

The bot's personality comes entirely from the system prompt built by `buildSystemPrompt(cfg)` in `CharacterDiscordBot.js`. The system prompt is constructed from `char_short`, `char_full`, `lore_places`, `style_tag`, `bio_style_tag`, and `fallback_text`. To change personality, change the config — not the code.
