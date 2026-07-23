'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')

const GrimConfig = require('../bin/grim-config')

const REAL_CONFIG = path.join(__dirname, '..', 'config', 'lbl-config.json')
const BACKUP_PATH = REAL_CONFIG + '.bak'

function backupConfig() {
  if (fs.existsSync(REAL_CONFIG)) {
    fs.copyFileSync(REAL_CONFIG, BACKUP_PATH)
  }
}

function restoreConfig() {
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, REAL_CONFIG)
    fs.unlinkSync(BACKUP_PATH)
  }
}

function writeConfig(obj) {
  fs.writeFileSync(REAL_CONFIG, JSON.stringify(obj, null, 2) + '\n')
}

function captureLog(fn) {
  const captured = []
  const orig = console.log
  console.log = (...args) => captured.push(args.join(' '))
  try { fn() } finally { console.log = orig }
  return captured.join('\n')
}

describe('GrimConfig.gen()', () => {
  it('gen("hosts") output contains endpoint entries, sorted by service name', () => {
    backupConfig()
    try {
      writeConfig({
        endpoints: {
          zebra: 'http://10.0.0.3:9999',
          alpha: 'http://10.0.0.1:8080',
          beta:  'http://10.0.0.2:3000',
        },
        use: {},
      })
      const output = captureLog(() => new GrimConfig().gen('hosts'))
      const lines = output.trim().split('\n')
      assert.strictEqual(lines.length, 3)
      assert.ok(lines[0].includes('alpha.grim'))
      assert.ok(lines[1].includes('beta.grim'))
      assert.ok(lines[2].includes('zebra.grim'))
    } finally { restoreConfig() }
  })

  it('gen("probes") parses as valid JSON, covers all endpoints', () => {
    backupConfig()
    try {
      writeConfig({
        endpoints: {
          ner:   'http://aid:3773',
          a1111: 'http://aid:7860',
        },
        use: {},
      })
      const output = captureLog(() => new GrimConfig().gen('probes'))
      const probes = JSON.parse(output.trim())
      assert.strictEqual(probes.length, 2)
      assert.strictEqual(probes[0].name, 'a1111')
      assert.strictEqual(probes[0].url, 'http://aid:7860')
      assert.strictEqual(probes[1].name, 'ner')
      assert.strictEqual(probes[1].url, 'http://aid:3773')
    } finally { restoreConfig() }
  })

  it('gen("caddy") output has correct structure per endpoint', () => {
    backupConfig()
    try {
      writeConfig({
        endpoints: {
          svc: 'http://10.0.0.1:8080',
        },
        use: {},
      })
      const output = captureLog(() => new GrimConfig().gen('caddy'))
      assert.ok(output.includes('svc.grim {'))
      assert.ok(output.includes('reverse_proxy http://10.0.0.1:8080'))
      assert.ok(output.includes('}'))
    } finally { restoreConfig() }
  })

  it('unknown format exits with code 1', () => {
    backupConfig()
    try {
      writeConfig({
        endpoints: { a: 'http://x:1' },
        use: {},
      })
      let exited = false
      const origExit = process.exit
      process.exit = (code) => { exited = true; assert.strictEqual(code, 1) }
      try {
        new GrimConfig().gen('foobar')
      } finally {
        process.exit = origExit
      }
      assert.ok(exited, 'should have called process.exit(1)')
    } finally { restoreConfig() }
  })

  it('missing endpoints throws error', () => {
    backupConfig()
    try {
      writeConfig({ use: {} })
      assert.throws(() => new GrimConfig().gen('hosts'), /endpoints/)
    } finally { restoreConfig() }
  })

  it('hosts resolves hostnames to IPs when possible', () => {
    backupConfig()
    try {
      writeConfig({
        endpoints: {
          test: 'http://localhost:1234',
        },
        use: {},
      })
      const output = captureLog(() => new GrimConfig().gen('hosts'))
      assert.ok(output.includes('127.0.0.1') || output.includes('localhost'))
    } finally { restoreConfig() }
  })
})
