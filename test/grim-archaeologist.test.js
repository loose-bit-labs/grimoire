'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const A = require('../bin/grim-archaeologist')

const mktmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grim-arch-'))

// Sparse large file — instant, near-zero disk usage; stat reports full size
function sparseFile(p, size) {
  const fd = fs.openSync(p, 'w')
  fs.ftruncateSync(fd, size)
  fs.closeSync(fd)
}

// ── OOM guards (phase 82) ────────────────────────────────────────────────────
// WHY these matter: 9/9 recent repo dives crashed with a V8 heap OOM because
// the walks read every file (weights, bundles, binaries) into memory. The
// guards must refuse to read, and must record the refusal — a silent skip
// would hide which repos are too big to dig.

describe('collectInterestingFiles OOM guards', () => {
  it('skips a 20MB .safetensors by size, still collects the .js (repro-guard)', () => {
    const root = mktmp()
    sparseFile(path.join(root, 'weights.safetensors'), 20 * 1024 * 1024)
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log("hi")\n')

    const { files, skipped } = A.collectInterestingFiles(root)

    assert.strictEqual(files.length, 1)
    assert.strictEqual(files[0].rel, 'app.js')
    assert.ok(files[0].content.includes('console.log'), 'the .js content must be retained')
    const skip = skipped.find(s => s.name === 'weights.safetensors')
    assert.ok(skip, 'big file must be recorded as skipped, not silent')
    assert.strictEqual(skip.reason, 'size')
    assert.strictEqual(skip.size, 20 * 1024 * 1024)
  })

  it('skips a code-extension file over MAX_FILE_BYTES (a big .js is the real crasher)', () => {
    const root = mktmp()
    sparseFile(path.join(root, 'bundle.js'), A.MAX_FILE_BYTES + 1)

    const { files, skipped } = A.collectInterestingFiles(root)

    assert.strictEqual(files.length, 0)
    assert.strictEqual(skipped.length, 1)
    assert.strictEqual(skipped[0].reason, 'size')
  })

  it('skips a small model file by extension', () => {
    const root = mktmp()
    fs.writeFileSync(path.join(root, 'model.gguf'), Buffer.alloc(64))
    fs.writeFileSync(path.join(root, 'main.py'), 'x = 1\n')

    const { files, skipped } = A.collectInterestingFiles(root)

    assert.strictEqual(files.length, 1)
    assert.strictEqual(files[0].rel, 'main.py')
    assert.strictEqual(skipped.find(s => s.name === 'model.gguf').reason, 'ext')
  })

  it('skips a text-extension file with null bytes in the first 4KB as binary', () => {
    const root = mktmp()
    const blob = Buffer.concat([Buffer.from([0x00, 0x01, 0x02, 0x03]), Buffer.alloc(100)])
    fs.writeFileSync(path.join(root, 'data.txt'), blob)
    fs.writeFileSync(path.join(root, 'notes.md'), 'hello world\n')

    const { files, skipped } = A.collectInterestingFiles(root)

    assert.strictEqual(files.length, 1)
    assert.strictEqual(files[0].rel, 'notes.md')
    assert.strictEqual(skipped.find(s => s.name === 'data.txt').reason, 'binary')
  })

  it('elides files past MAX_TOTAL_BYTES, keeps the retained total bounded, records the count', () => {
    const root = mktmp()
    // 25 files × 400KB of one-line text = 10MB total, each under the 512KB
    // per-file cap — the byte budget must cut collection off and count the rest
    const body = 'x'.repeat(400 * 1024)
    for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(root, `f${String(i).padStart(2, '0')}.js`), body)

    const { files, elided } = A.collectInterestingFiles(root)

    const retained = files.reduce((n, f) => n + Buffer.byteLength(f.content), 0)
    assert.ok(retained <= A.MAX_TOTAL_BYTES, `retained ${retained} bytes exceeds the cap`)
    assert.ok(elided > 0, 'some files must be elided past the cap')
    assert.strictEqual(files.length + elided, 25, 'every candidate is either retained or elided')
  })
})

describe('readGate', () => {
  it('returns null for a small text file', () => {
    const root = mktmp()
    const p = path.join(root, 'ok.js')
    fs.writeFileSync(p, 'const a = 1\n')
    assert.strictEqual(A.readGate(p), null)
  })

  it('reports size before ext for a large skip-extension file', () => {
    const root = mktmp()
    const p = path.join(root, 'big.safetensors')
    sparseFile(p, 2 * 1024 * 1024)
    const g = A.readGate(p)
    assert.strictEqual(g.reason, 'size')
    assert.strictEqual(g.size, 2 * 1024 * 1024)
  })

  it('flags a .min.js file by extension even though extname says .js', () => {
    const root = mktmp()
    const p = path.join(root, 'lib.min.js')
    fs.writeFileSync(p, 'var a=1;\n')
    assert.strictEqual(A.readGate(p).reason, 'ext')
  })
})
