'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const A = require('../bin/grim-archaeologist')
const modelAsk = require('../bin/model-ask')
const council  = require('../lib/council')

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

// ── Semantic mode (phase 83) ────────────────────────────────────────────────
// WHY: a dive's default lens is now the semantic spine — one synthesis call,
// not a per-file catalog (token cost, and the same unbounded-read class
// phase 82 closed). The contract is only assertable with the model stubbed:
// exactly one ask, task 'linking', SEMANTIC_SYSTEM, spine-only prompt, and
// the same final.md shape downstream.

// Stub the model through the module object — the seam grim-archaeologist.js
// calls through (deliberately not destructured) so tests run offline.
function stubModel(respond) {
  const calls = []
  const saved = { ask: modelAsk.ask, compact: modelAsk.compact }
  modelAsk.ask = async (o) => { calls.push(o); return respond ? respond(o) : 'STUB' }
  modelAsk.compact = async () => {}
  return { calls, restore: () => { modelAsk.ask = saved.ask; modelAsk.compact = saved.compact } }
}

// archDir/pushArtifacts read env at call time — force tmpdir staging and no
// upload so these tests can never write into the KB or hit the server,
// even when run on the box where GRIMOIRE_ROOT/GRIMOIRE_HOST are set.
function withCleanEnv(fn) {
  const saved = { root: process.env.GRIMOIRE_ROOT, host: process.env.GRIMOIRE_HOST }
  process.env.GRIMOIRE_ROOT = ''
  process.env.GRIMOIRE_HOST = ''
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
}

// Spine (README + manifest + entry) plus five small "bulk" source files the
// catalog pipeline would prompt per-file — their contents must never reach
// a semantic prompt.
function fixtureRepo() {
  const root = mktmp()
  fs.writeFileSync(path.join(root, 'README.md'), '# demo-spine\nSpine README marker.\n')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo-spine', main: 'index.js' }, null, 2))
  fs.writeFileSync(path.join(root, 'index.js'), '// entry-marker\nmodule.exports = 1\n')
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `mod${i}.js`), `// bulk-marker-${i}\n`)
  return root
}

describe('runDig semantic mode (phase 83)', () => {
  it('reads only the spine, makes exactly one ask (linking + SEMANTIC_SYSTEM), writes the same final.md', async () => {
    const root = fixtureRepo()
    const name = path.basename(root)
    const stub = stubModel((o) => o.task === 'linking' ? 'SEMANTIC-SYNTH' : 'OTHER')
    try {
      const result = await withCleanEnv(async () => A.runDig(root, { mode: 'semantic' }))

      assert.strictEqual(stub.calls.length, 1, 'semantic mode is exactly one model call')
      const { prompt, task, system } = stub.calls[0]
      assert.strictEqual(task, 'linking')
      assert.strictEqual(system, A.SEMANTIC_SYSTEM)
      // Spine in: README, manifest, entry point. Per-file content out.
      assert.ok(prompt.includes('Spine README marker'), 'README is in the spine')
      assert.ok(prompt.includes('demo-spine'), 'manifest is in the spine')
      assert.ok(prompt.includes('entry-marker'), 'entry point is in the spine')
      assert.ok(!prompt.includes('bulk-marker-'), 'per-file contents must not reach the prompt')
      assert.ok(!prompt.includes('Analyze this file'), 'no buildFilePrompt text in the semantic prompt')
      // Same final.md shape — downstream is unchanged
      const final = fs.readFileSync(path.join(result.outDir, 'final.md'), 'utf8')
      assert.ok(final.startsWith(`# ${name} — Final Analysis`), `unexpected final.md header: ${final.slice(0, 60)}`)
      assert.ok(final.includes('SEMANTIC-SYNTH'))
    } finally { stub.restore() }
  })

  it('default (no mode) still runs the per-file catalog pipeline: overview + one ask per file + synthesis', async () => {
    const root = fixtureRepo()
    const name = path.basename(root)
    const expectedFiles = A.collectInterestingFiles(root).files.length
    assert.ok(expectedFiles >= 6, 'fixture should yield several catalog candidates')
    const stub = stubModel((o) =>
      o.task === 'dreaming' ? 'CATALOG-SYNTH'
      : o.task === 'extraction' ? 'CATALOG-OVERVIEW'
      : 'CATALOG-FILE')
    const savedCouncil = council.runCouncil
    council.runCouncil = async () => ({ error: 'stubbed-offline' })
    try {
      const result = await withCleanEnv(async () => A.runDig(root))

      const byTask = {}
      for (const c of stub.calls) byTask[c.task] = (byTask[c.task] || 0) + 1
      assert.strictEqual(byTask.extraction, 1, 'one overview call')
      assert.strictEqual(byTask.linking, expectedFiles, 'one ask per collected file')
      assert.strictEqual(byTask.dreaming, 1, 'one synthesis call')
      assert.strictEqual(fs.readdirSync(path.join(result.outDir, 'files')).length, expectedFiles, 'per-file analyses written')
      const final = fs.readFileSync(path.join(result.outDir, 'final.md'), 'utf8')
      assert.ok(final.startsWith(`# ${name} — Final Analysis`))
      assert.ok(final.includes('CATALOG-SYNTH'))
    } finally {
      council.runCouncil = savedCouncil
      stub.restore()
    }
  })
})

describe('spineRead — the phase-82 gate guards spine reads too', () => {
  it('returns text for a small file', () => {
    const p = path.join(mktmp(), 'ok.js')
    fs.writeFileSync(p, 'const a = 1\n')
    const r = A.spineRead(p)
    assert.strictEqual(r.reason, undefined)
    assert.ok(r.text.includes('const a = 1'))
  })

  it('refuses a 2MB .js by size — a refused spine entry is never read', () => {
    const p = path.join(mktmp(), 'huge.js')
    sparseFile(p, 2 * 1024 * 1024)
    const r = A.spineRead(p)
    assert.strictEqual(r.reason, 'size')
    assert.strictEqual(r.text, undefined)
  })

  it('refuses by extension and by null bytes', () => {
    const root = mktmp()
    const gguf = path.join(root, 'model.gguf')
    fs.writeFileSync(gguf, Buffer.alloc(64))
    assert.strictEqual(A.spineRead(gguf).reason, 'ext')
    const bin = path.join(root, 'blob.txt')
    fs.writeFileSync(bin, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32)]))
    assert.strictEqual(A.spineRead(bin).reason, 'binary')
  })
})

describe('collectSpine', () => {
  it('records gate-refused spine files instead of reading them', () => {
    const root = mktmp()
    fs.writeFileSync(path.join(root, 'README.md'), 'ok readme\n')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'index.js' }))
    sparseFile(path.join(root, 'index.js'), 2 * 1024 * 1024)

    const spine = A.collectSpine(root)

    assert.strictEqual(spine.readme.length, 1)
    assert.strictEqual(spine.entryPoints.length, 0, 'the oversized entry is never read')
    const skip = spine.skipped.find(s => s.rel === 'index.js')
    assert.ok(skip, 'the refusal is recorded, not silent')
    assert.strictEqual(skip.reason, 'size')
  })
})
