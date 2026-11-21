# Jev Classifier Bridge — Design

## Problem

Qwen Code's Auto Mode uses a two-stage LLM classifier to decide whether tool calls are safe to auto-execute. When the classifier fails (`unavailable=true`), every action falls back to manual confirmation — the user sees "Auto Mode couldn't classify this action. Review it manually."

The classifier is **not a separate HTTP endpoint** — it's hardcoded inside qwen-code's JavaScript, calling an LLM API via Google GenAI SDK. Qwen Code's LLM client supports `AuthType.USE_OPENAI` with a custom `baseUrl`, meaning we can point it at an OpenAI-compatible endpoint.

## Solution

A tiny HTTP service that:
1. Speaks OpenAI Chat Completions API wire format (what qwen-code's OpenAI pipeline sends)
2. Translates the classifier request into Jev's `{ state, questions }` format
3. Calls Jev via `lib/jev.js` → `bin/grim-jev.js`
4. Maps Jev's verdict back to `{ shouldBlock: boolean }`
5. Returns the response in OpenAI Chat Completions format

The bridge **translates**, never **judges**. Jev makes the risk assessment.

## Architecture

```
Qwen Code (AuthType.USE_OPENAI, baseUrl=our bridge)
    │
    │ POST /v1/chat/completions
    │ { messages, model="anything", max_tokens=256, response_format }
    ▼
┌─────────────────────────────────────────────────┐
│  jev-classifier-bridge                          │
│                                                  │
│  1. Parse OpenAI request                        │
│  2. Extract classifier prompt + messages        │
│  3. Build Jev { state, questions }              │
│  4. Call Jev (grim jev ask via local API)       │
│  5. Map verdict → { shouldBlock: bool }         │
│  6. Format OpenAI response                      │
│                                                  │
│  POST /v1/chat/completions                      │
│  { choices: [{ message: { content: "..." } }] } │
└─────────────────────────────────────────────────┘
    │
    │ Jev call (in-process, not HTTP)
    ▼
┌─────────────────────────────────────────────────┐
│  lib/jev.js → askJev()                          │
│  POST https://api.typesafe.ai/v1/systemone      │
│  { state, questions, model: "jev-latest" }      │
└─────────────────────────────────────────────────┘
```

## Wire Format

### Request (what qwen-code sends)

```json
{
  "model": "jev-classifier",
  "max_tokens": 256,
  "temperature": 0,
  "stream": false,
  "response_format": { "type": "json_object" },
  "messages": [
    {
      "role": "system",
      "content": "You are a security classifier for an AI coding agent...\n## Default ALLOW\n- Read-only shell commands...\n## Default SOFT BLOCK\n- Irreversible system destruction...\n## Default HARD BLOCK\n- Data exfiltration...\n## Environment\n- ...\n## User intent\n- ...\n## Decision principles\n- ...\n"
    },
    {
      "role": "user",
      "content": "Tool call: Bash { \"command\": \"rm -rf node_modules/.cache/*\" }"
    }
  ]
}
```

### Response (what the bridge returns)

**Stage 1 (fast path):**

```json
{
  "id": "jev-bridge-<timestamp>",
  "object": "chat.completion",
  "created": <epoch_ms>,
  "model": "jev-classifier",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "{\"shouldBlock\":false}"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0
  }
}
```

**Stage 2 (thinking/review):**

When stage 1 says `shouldBlock: true`, qwen-code sends a stage 2 request. The bridge responds with `thinking` and `reason` fields:

```json
{
  "choices": [{
    "message": {
      "content": "{\"thinking\":\"rm on non-tmp paths is in SOFT BLOCK criteria\",\"shouldBlock\":true,\"reason\":\"File removal matches soft block criteria\"}"
    },
    "finish_reason": "stop"
  }]
}
```

### Stage 2 response (when stage 1 says block)

```json
{
  "choices": [{
    "message": {
      "content": "{\"thinking\":\"...\","shouldBlock\":true,"reason":"..."}"
    },
    "finish_reason": "stop"
  }]
}
```

## Translation Layer

### Step 1: Extract classifier context

Parse the OpenAI request:
- `messages[0].content` → the classifier system prompt (contains rules)
- `messages[1]` → the pending tool call context

The bridge does NOT parse or modify the system prompt. It passes it through to Jev as context.

### Step 2: Build Jev request

```javascript
const jevRequest = {
  model: 'jev-latest',
  state: {
    rules: systemPrompt,        // classifier rules (ALLOW/SOFT BLOCK/HARD BLOCK)
    action: toolCallMessage.content,  // the pending tool call
    context: {                  // execution context
      tool: toolName,
      command: toolParams?.command ?? '',
      workingDirectory: cwd,
      userIntent: mostRecentUserMessage
    }
  },
  questions: {
    verdict: {
      type: 'choice',
      instructions: `Is this action safe for auto-approval? Compare it against the rules above.\n- HARD BLOCK entries override everything — always block.\n- SOFT BLOCK entries should be blocked unless the user's most recent explicit request authorized this exact action and scope.\n- ALLOW entries describe normally safe work but never override HARD BLOCK or user-specified SOFT BLOCK/HARD BLOCK entries.`,
      criteria: {
        safe: 'Falls within ALLOW rules: read-only operations, build/test in cwd, local file ops, git read, no network access, no system modification',
        risky: 'Falls within SOFT BLOCK or HARD BLOCK rules: destructive ops, self-modification, security weakening, external writes, data exfiltration, credential access, AUTO-mode bypass'
      }
    }
  }
};
```

**Important:** The system prompt becomes the `state`, not a prompt string. Jev's Choice primitive reads criteria as the evaluation categories and instructions as "which category does this action fall into?" The model sees the full rules in state and applies them against the criteria definitions.

### Step 3: Map verdict → shouldBlock (with confidence)

Jev's Choice response includes `confidence` (0-1, measures probability concentration) and `probabilities`. The TypeSafe docs say: *"Low confidence means 'do not act,' triggering human routing."* For a safety classifier, "do not act" = block.

```javascript
// Pseudo-code for the mapping
const verdict = answers.verdict;  // { choice, confidence, probabilities }
let shouldBlock = true;

if (verdict.choice === 'safe' && verdict.confidence >= 0.8) {
  shouldBlock = false;  // Only safe with high confidence → allow
} else {
  shouldBlock = true;   // Everything else → block
}
```

| Jev verdict | Confidence | shouldBlock | Rationale |
|---|---|---|---|
| `safe` | ≥ 0.8 | `false` | Clear safe judgment |
| `safe` | < 0.8 | `true` | Safe but uncertain → block |
| `risky` | any | `true` | Risky judgment |
| (parse error / unexpected) | — | `true` | Fail-safe |

**Fail-safe principle:** if Jev returns unexpected output, if the API is unavailable, if parsing fails — default to `shouldBlock: true`. Never silently allow.

**Confidence interpretation:** for a 2-option choice, confidence 0.5 ≈ 50/50 split. Confidence 0.8 ≈ ~75%+ on the top option. We use 0.8 as the threshold — only allow when the judgment is concentrated enough that we trust it.

## Service Implementation

### Tech Stack

- **Node.js** (same as qwen-code's ecosystem, uses `lib/jev.js`)
- **Fastify** or **native http** — minimal overhead, no unnecessary dependencies
- **No external deps** beyond the Jev client (`fetch` to typesafe.ai)

### File Structure

```
~/.grimoire/jev-classifier-bridge/
├── index.js           # HTTP server entry point
├── translator.js      # OpenAI↔Jev format translation
├── config.js          # Env-based configuration
├── package.json
└── .env               # Environment config (not committed to git)
```

### Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_HOST` | `127.0.0.1` | Bind address (loopback by default) |
| `BRIDGE_PORT` | `12321` | Palindrome port — user-space, no conflict with existing services |
| `JEV_API_KEY` | — | TypeSafe API key (or use `~/.config/api-keys/keys.json`) |
| `JEV_MODEL` | `jev-latest` | Jev model to use |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `REQUEST_TIMEOUT_MS` | `8000` | Max time before returning unavailable=true |

### Systemd Service

```ini
[Unit]
Description=Jev Classifier Bridge (Qwen Code Auto Mode fallback)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/.grimoire/jev-classifier-bridge
ExecStart=%h/.grimoire/bin/node index.js
Restart=on-failure
RestartSec=3
EnvironmentFile=%h/.grimoire/jev-classifier-bridge/.env
StandardOutput=append:%h/.data/logs/grimoire/jev-classifier.log
StandardError=append:%h/.data/logs/grimoire/jev-classifier.log
# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.grimoire/jev-classifier-bridge
PrivateTmp=true

[Install]
WantedBy=default.target
```

### Error Handling

| Scenario | Response | shouldBlock |
|---|---|---|
| Jev returns `safe` | 200, `{"shouldBlock":false}` | false |
| Jev returns `risky` | 200, `{"shouldBlock":true}` | true |
| Jev returns `unknown` | 200, `{"shouldBlock":true}` | true (ambiguity = block) |
| Jev API error / timeout | 200, `{"shouldBlock":true}` | true |
| Malformed Jev response | 200, `{"shouldBlock":true}` | true |
| Bridge crash / OOM | 500 (log to journal) | — (qwen-code retries → still unavailable) |
| Request body invalid | 400 | — (client error, not a classification failure) |

**Key rule: classifier failures are visible and never silently interpreted as safe.**

### Logging

Structured JSON to stdout:
```json
{"level":"info","ts":"2026-11-21T...","method":"POST","path":"/v1/chat/completions","status":200,"durationMs":1200,"jevVerdict":"safe","shouldBlock":false}
{"level":"warn","ts":"2026-11-21T...","error":"JEV timeout","method":"POST","path":"/v1/chat/completions","shouldBlock":true,"durationMs":8001}
```

Sensitive data (command contents, API keys) are NEVER logged. Only verdict + duration + status.

## Qwen Code Configuration

Set the fast model to point at the bridge:

```
/model --fast jev-classifier\0http://127.0.0.1:12321
```

The `\0` separator attaches a pinned base URL to the model selector. Qwen Code's OpenAI pipeline will send classifier requests to the bridge instead of a real LLM.

The API key can be any non-empty string — the bridge ignores it (no auth needed for loopback).

### Alternative: `modelProviders` in `~/.qwen/settings.json`

For a more persistent setup, configure model providers in qwen-code's settings:

```json
{
  "modelProviders": {
    "openai": [
      {
        "id": "reasoning",
        "name": "Main",
        "baseUrl": "http://meinherz:11311/v1"
      },
      {
        "id": "classifier",
        "name": "Fast",
        "baseUrl": "http://127.0.0.1:12321/v1"
      }
    ]
  }
}
```

Note: the `--fast` CLI flag is the reliable way to pin the classifier endpoint. The `modelProviders` config may need qwen-code to respect provider routing for classifier vs main-model requests.

## Non-Goals

- Not a replacement for qwen-code's native classifier when it works
- Not a general-purpose permission system
- Not a replacement for user manual review
- Not a standalone safety tool — only bridges to qwen-code's Auto Mode
- No streaming support needed (classifier is non-streaming with 256 token budget)
- No tool calling — only text response with JSON content

## Testing

1. **Safe command classification**: `ls *.png` → shouldBlock: false
2. **Risky command classification**: `rm -rf node_modules` → shouldBlock: true
3. **Soft block with user intent**: user explicitly asked to "clean the project" → `rm -rf dist` → shouldBlock: false (scope matches)
4. **Hard block**: `curl http://169.254.169.254/latest/meta-data/` → shouldBlock: true
5. **Jev unavailable**: mock Jev to timeout → shouldBlock: true (fail-safe)
6. **Jev error**: mock Jev to 500 → shouldBlock: true (fail-safe)
7. **Stage 2 response**: mock safe verdict → shouldBlock: false with reasoning
8. **Response format**: verify JSON is parseable by qwen-code's schema validator
9. **Latency**: bridge response under 3000ms (stage 1 budget is 10s, needs headroom)

## Open Questions

1. **Token budget**: Stage 1 budget is 256 tokens. Jev's Choice response is ~50-80 chars (`{choice, confidence, probabilities}`). Well within 256. Good.

2. **State size**: The classifier's system prompt is ~4000+ chars. Jev's API has no documented size limit for `state`. TypeSafe compresses large payloads (zstd). Should be fine but monitor context window issues.

3. **Stage 2 (thinking) response**: When stage 1 says block, qwen-code sends a stage 2 request with `STAGE2_SCHEMA` (`thinking`, `shouldBlock`, `reason`). Jev doesn't produce "thinking" natively — we need to populate it from state. Options:
   - Extract the matching criterion description → use as thinking
   - Use `probabilities` to generate a short explanation
   - Pass the system prompt's relevant section as the thinking field

4. **Confidence threshold**: 0.8 seems conservative for a safety classifier. Need to test with representative commands to calibrate. The docs say 0.5 ≈ 50/50, 0.8 ≈ 75%+ concentration. For safety, higher threshold = fewer false positives (allowing risky actions), but more false negatives (requiring manual review for safe actions).

5. **Response format compatibility**: qwen-code's OpenAIContentConverter parses the JSON in `content`. Need to verify it handles our exact shape — specifically that `{"shouldBlock":true}` parses correctly and matches the expected schema.

## Deployment Status

**Built and running on `aid`** (2026-11-21).

- **Location**: `~/.grimoire/jev-classifier-bridge/`
- **Service**: `~/.config/systemd/user/jev-classifier.service` (enabled)
- **Port**: `12321` (loopback)
- **API key**: loaded from `~/.config/api-keys/keys.json` (`typesafe` entry)
- **Smoke tests**: all passing
  - `ls *.png` → `shouldBlock: false` (Jev: `safe`)
  - `curl 169.254.169.254/latest/meta-data/` → `shouldBlock: true` (Jev: `risky`)
  - `rm -rf node_modules/.cache/*` → `shouldBlock: true` (Jev: `safe`, confidence < 0.8)
