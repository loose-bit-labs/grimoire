'use strict'

/**
 * a1111-client.js — AUTOMATIC1111 Stable Diffusion API client
 *
 * Wraps txt2img and interrogate. Gracefully degrades when the service is down.
 */

const fs    = require('node:fs').promises
const path  = require('node:path')
const axios = require('axios')

const { lblEndpoint } = require('./env')

const A1111_BASE    = process.env.GRIMOIRE_A1111_HOST || lblEndpoint('a1111') || 'http://aid:7860'
const A1111_TIMEOUT = 120_000  // image gen can be slow

async function _post(endpoint, body) {
  const res = await axios.post(`${A1111_BASE}${endpoint}`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: A1111_TIMEOUT,
  })
  return res.data
}

/**
 * Generate an image via txt2img.
 * @param {object} opts
 * @param {string}  opts.prompt
 * @param {string}  [opts.negative_prompt]
 * @param {number}  [opts.steps=28]
 * @param {number}  [opts.width=960]
 * @param {number}  [opts.height=540]
 * @param {number}  [opts.cfg_scale=7]
 * @param {string}  [opts.sampler_name='DPM++ 2M Karras']
 * @param {string}  [opts.outFile]  — write PNG here; if omitted returns Buffer
 * @returns {Promise<Buffer|string>} Buffer, or outFile path if outFile was set
 */
async function txt2img(opts) {
  const {
    prompt,
    negative_prompt = DEFAULT_NEGATIVE,
    steps           = 28,
    width           = 960,
    height          = 540,
    cfg_scale       = 7,
    sampler_name    = 'DPM++ 2M',
    outFile,
  } = opts

  const data = await _post('/sdapi/v1/txt2img', {
    prompt, negative_prompt, steps, width, height, cfg_scale, sampler_name,
  })

  const buf = Buffer.from(data.images[0], 'base64')
  if (outFile) {
    await fs.mkdir(path.dirname(outFile), { recursive: true })
    await fs.writeFile(outFile, buf)
    return outFile
  }
  return buf
}

/**
 * Interrogate an image — returns a CLIP caption string.
 * @param {string|Buffer} image  — file path or raw PNG buffer
 * @param {'clip'|'deepdanbooru'} [model='clip']
 * @returns {Promise<string>}
 */
async function interrogate(image, model = 'clip') {
  let b64
  if (Buffer.isBuffer(image)) {
    b64 = image.toString('base64')
  } else {
    const buf = await fs.readFile(image)
    b64 = buf.toString('base64')
  }
  const data = await _post('/sdapi/v1/interrogate', { image: b64, model })
  return data.caption || ''
}

/**
 * @returns {Promise<boolean>}
 */
async function a1111Available() {
  try {
    await axios.get(`${A1111_BASE}/sdapi/v1/memory`, { timeout: 4_000 })
    return true
  } catch {
    return false
  }
}

const DEFAULT_NEGATIVE = [
  'blurry, watermark, out of focus, cropped, missing limbs, extra limbs',
  'ugly, waifu, hentai, text, letters, words, signature, username',
  'low quality, jpeg artifacts, noise',
].join(', ')

module.exports = { txt2img, interrogate, a1111Available, A1111_BASE, DEFAULT_NEGATIVE }
