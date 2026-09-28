'use strict'

/**
 * jev.js — TypeSafe / Jev System One judgment client
 *
 * Thin wrapper over TypeSafe's systemone judgment API. Loads the API key from
 * ~/.config/api-keys/keys.json (field `typesafe`), POSTs {state, model,
 * questions} to https://api.typesafe.ai/v1/systemone, and returns the parsed
 * judgment. No retries, no caching — designing the state/questions shape is a
 * per-call-site judgment call this module does not template away.
 */

const fs   = require('node:fs')
const os   = require('node:os')
const path = require('node:path')

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const KEYS_PATH = path.join(os.homedir(), '.config', 'api-keys', 'keys.json')

/**
 * Load the TypeSafe API key from a keys.json file.
 * @param {string} [keysPath=KEYS_PATH]
 * @returns {string}
 */
function loadKey(keysPath = KEYS_PATH) {
  let keys
  try {
    keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
  } catch (err) {
    throw new Error(`jev: could not read keys file at ${keysPath}: ${err.message}`)
  }
  const key = keys.typesafe
  if (!key) throw new Error(`jev: no 'typesafe' field in ${keysPath}`)
  return key
}

/**
 * Ask TypeSafe/Jev a set of typed judgment questions against some state.
 * @param {object} state — the situation/context, shaped however the question set needs
 * @param {object} questions — question-name -> {type, instructions, criteria} spec
 * @param {object} [opts]
 * @param {string} [opts.model='jev-latest']
 * @param {string} [opts.keysPath] — override for the keys.json path (tests)
 * @returns {Promise<object>} the parsed TypeSafe response ({answers, usage, ...})
 */
async function askJev(state, questions, opts = {}) {
  const { model = 'jev-latest', keysPath = KEYS_PATH } = opts
  const key = loadKey(keysPath)
  const res = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ state, model, questions }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`typesafe ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

module.exports = { askJev, loadKey, TYPESAFE_URL, KEYS_PATH }
