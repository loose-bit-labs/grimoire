'use strict'

/**
 * translator.js — Protocol translation between OpenAI Chat Completions
 * and Jev TypeSafe Choice primitive.
 *
 * The bridge translates, never judges. Jev makes the risk assessment.
 */

const { jevModel, jevEndpoint, jevApiKey } = require('./config')

/**
 * Extract plain text from an OpenAI message content.
 *
 * content can be a string or an array of content parts.
 * We only care about text parts.
 */
function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('\n')
  }
  return ''
}

// ─── OpenAI → Jev ────────────────────────────────────────────────────────────

/**
 * Build a Jev { state, questions } from an OpenAI Chat Completions request.
 *
 * The system prompt (classifier rules) becomes state. The pending tool call
 * becomes the judgment target. We ask Jev's Choice primitive to classify
 * it as safe or risky.
 */
function buildJevRequest(openaiRequest) {
  const { messages } = openaiRequest

  // Extract classifier rules from system prompt
  const systemPrompt = extractText(messages.find(m => m.role === 'system')?.content || '')
    .trim()

  // Extract the pending tool call from the last user message
  const toolCallMessage = extractText(messages.find(m => m.role === 'user')?.content || '')

  // Try to extract tool name and params from the tool call format
  // Expected format: "Tool call: <ToolName> { ...params... }"
  const toolNameMatch = toolCallMessage.match(/^Tool call:\s+(\w+)/)
  const toolName = toolNameMatch ? toolNameMatch[1] : 'Bash'

  return {
    model: jevModel,
    state: {
      rules: systemPrompt,
      action: toolCallMessage,
      context: {
        tool: toolName,
      },
    },
    questions: {
      verdict: {
        type: 'choice',
        instructions: `Is this action safe for auto-approval? Compare it against the rules above.\n\n- HARD BLOCK entries override everything — always block.\n- SOFT BLOCK entries should be blocked unless the user's most recent explicit request authorized this exact action and scope.\n- ALLOW entries describe normally safe work but never override HARD BLOCK or user-specified SOFT BLOCK/HARD BLOCK entries.`,
        criteria: {
          safe: 'Falls within ALLOW rules: read-only operations, build/test in cwd, local file ops, git read, no network access, no system modification',
          risky: 'Falls within SOFT BLOCK or HARD BLOCK rules: destructive ops, self-modification, security weakening, external writes, data exfiltration, credential access, AUTO-mode bypass',
        },
      },
    },
  }
}

// ─── Jev → OpenAI ────────────────────────────────────────────────────────────

/**
 * Map Jev's Choice verdict → { shouldBlock: boolean }.
 *
 * Confidence semantics:
 * - 0.5 ≈ 50/50 split (no clear winner)
 * - 0.8 ≈ ~75%+ concentration on top option
 *
 * Fail-safe: everything unexpected → block.
 */
function mapVerdict(jevResponse) {
  const answers = jevResponse?.answers
  if (!answers || typeof answers !== 'object') {
    return { shouldBlock: true, reason: 'malformed Jev response: no answers' }
  }

  const verdict = answers.verdict
  if (!verdict || typeof verdict !== 'object') {
    return { shouldBlock: true, reason: 'malformed Jev response: no verdict' }
  }

  const { choice, confidence } = verdict

  if (typeof choice !== 'string') {
    return { shouldBlock: true, reason: `malformed verdict: choice is ${typeof choice}` }
  }

  if (typeof confidence !== 'number') {
    return { shouldBlock: true, reason: `malformed verdict: confidence is ${typeof confidence}` }
  }

  // Only allow when Jev clearly says safe AND we're confident enough
  if (choice === 'safe' && confidence >= 0.8) {
    return { shouldBlock: false }
  }

  return { shouldBlock: true, reason: `verdict=${choice}, confidence=${confidence.toFixed(2)}` }
}

/**
 * Format a Jev verdict into an OpenAI Chat Completions response.
 */
function formatOpenAIResponse(verdict, request) {
  const response = {
    id: `jev-bridge-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: request.model || 'jev-classifier',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({ shouldBlock: verdict.shouldBlock }),
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
    },
  }

  return response
}

// ─── Jev API call ────────────────────────────────────────────────────────────

/**
 * Call Jev TypeSafe API with request timeout.
 *
 * Returns the parsed JSON response, or throws on failure.
 */
async function callJev(jevRequest, signal) {
  const headers = {
    'Content-Type': 'application/json',
  }

  // Only set API key if configured
  if (jevApiKey) {
    headers['Authorization'] = `Bearer ${jevApiKey}`
  }

  const body = JSON.stringify(jevRequest)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000) // safety net

  const response = await fetch(jevEndpoint, {
    method: 'POST',
    headers,
    body,
    signal: signal || controller.signal,
  })

  clearTimeout(timeout)

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)')
    throw new Error(`Jev API ${response.status}: ${text}`)
  }

  return response.json()
}

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = {
  buildJevRequest,
  mapVerdict,
  formatOpenAIResponse,
  callJev,
}
