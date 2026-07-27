'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { ComfyQueue } = require('../lib/comfy-client')

describe('ComfyQueue.buildPrompt()', () => {
  it('resolves standard ComfyUI links: [link_id, srcNode, srcSlot, dstNode, dstSlot, TYPE]', () => {
    const q = new ComfyQueue('unused:0')
    const workflow = {
      nodes: [
        { id: 1, type: 'A', inputs: [], widgets_values: [] },
        { id: 2, type: 'B', inputs: [{ name: 'in', type: 'X' }], widgets_values: [] },
      ],
      links: [[100, 1, 0, 2, 0, 'X']],
    }
    const prompt = q.buildPrompt(workflow)
    assert.deepStrictEqual(prompt['2'].inputs.in, ['1', 0])
  })

  it('resolves wantan hand-authored links: [srcNode, srcSlot, dstNode, dstSlot, TYPE, sub] (no leading id)', () => {
    const q = new ComfyQueue('unused:0')
    const workflow = {
      nodes: [
        { id: 9, type: 'VAEDecode', inputs: [], widgets_values: [] },
        { id: 10, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE' }], widgets_values: [] },
      ],
      links: [[9, 0, 10, 0, 'IMAGE', 0]],
    }
    const prompt = q.buildPrompt(workflow)
    assert.deepStrictEqual(prompt['10'].inputs.images, ['9', 0])
  })
})
