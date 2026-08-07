#!/usr/bin/env node
'use strict'

/**
 * test/platform-gather.test.js — ARM fallbacks + power gather, graceful absence
 *
 * Verifies:
 * 1. linux.sh contains the expected fallback paths (source-level checks)
 * 2. aid (x86) registers cleanly with no regressions
 * 3. MEM_TOTAL_MB is exported
 * 4. _gather_power exports BATTERY_JSON/PRODUCT_NAME/IS_LAPTOP
 */

const { execSync } = require('node:child_process')
const fs = require('node:fs')
const { describe, it } = require('node:test')
const assert = require('node:assert')

const platformSh = fs.readFileSync('deploy/platform.d/linux.sh', 'utf8')
const registerSh = fs.readFileSync('deploy/grim-register-host.sh', 'utf8')

describe('platform gather: ARM fallbacks + power', () => {
  it('cpu gather falls back to device-tree model', () => {
    assert.ok(/device-tree\/model/.test(platformSh),
      '_gather_cpu should read /proc/device-tree/model as fallback')
    assert.ok(/tr -d '\\\\0'/.test(platformSh) || /tr -d '\\0'/.test(platformSh),
      '_gather_cpu should strip NUL bytes from device-tree model')
    assert.ok(/grep -m1.*Model.*cpuinfo/.test(platformSh),
      '_gather_cpu should fall back to cpuinfo ^Model line')
  })

  it('mobo gather falls back to device-tree when DMI absent', () => {
    assert.ok(/elif.*\/proc\/device-tree\/model/.test(platformSh),
      '_gather_mobo should have device-tree elif branch')
  })

  it('mem gather exports MEM_TOTAL_MB', () => {
    assert.ok(/MEM_TOTAL_MB=.*total_kb \/ 1024/.test(platformSh),
      '_gather_mem should compute MEM_TOTAL_MB')
    assert.ok(/export.*MEM_TOTAL_MB/.test(platformSh),
      '_gather_mem should export MEM_TOTAL_MB')
  })

  it('power gather exists and exports required vars', () => {
    assert.ok(/_gather_power\(\)/.test(platformSh),
      'linux.sh should define _gather_power')
    assert.ok(/BATTERY_JSON/.test(platformSh),
      '_gather_power should set BATTERY_JSON')
    assert.ok(/PRODUCT_NAME/.test(platformSh),
      '_gather_power should set PRODUCT_NAME')
    assert.ok(/IS_LAPTOP/.test(platformSh),
      '_gather_power should set IS_LAPTOP')
    assert.ok(/chassis_type/.test(platformSh),
      '_gather_power should read chassis_type')
    assert.ok(/8\|9\|10\|14/.test(platformSh),
      '_gather_power should recognize laptop chassis types')
  })

  it('register script includes new schema fields', () => {
    assert.ok(/total_mb/.test(registerSh),
      '_build_remember_payload should include total_mb')
    assert.ok(/battery/.test(registerSh),
      '_build_remember_payload should include battery')
    assert.ok(/\bproduct:/.test(registerSh),
      '_build_remember_payload should include product')
    assert.ok(/\bis_laptop:/.test(registerSh),
      '_build_remember_payload should include is_laptop')
  })

  it('register script shows MB for low-RAM hosts', () => {
    assert.ok(/MEM_TOTAL_GB < 1/.test(registerSh) || /MEM_TOTAL_GB.*<.*1/.test(registerSh),
      'description should show MB when GB < 1')
    assert.ok(/MEM_TOTAL_MB/.test(registerSh),
      'description should reference MEM_TOTAL_MB')
  })

  it('register script shows neutral GPU message', () => {
    assert.ok(/no discrete GPU/.test(registerSh),
      'GPU step should show "no discrete GPU" as info, not warning')
    assert.ok(!/none detected.*warn/.test(registerSh),
      'GPU step should not warn on "none detected"')
  })

  it('register script keys motherboard on name-or-vendor', () => {
    assert.ok(/MOBO_VENDOR.*MOBO_NAME/.test(registerSh) || /MOBO_NAME.*MOBO_VENDOR/.test(registerSh),
      'Motherboard step should check both vendor and name')
    assert.ok(/no board info/.test(registerSh),
      'Motherboard step should show "no board info" when empty')
    assert.ok(!/DMI unavailable/.test(registerSh),
      'Motherboard step should not say "DMI unavailable"')
  })

  it('register script conditionally shows Power step', () => {
    assert.ok(/BATTERY_JSON.*!=.*"null"/.test(registerSh) || /BATTERY_JSON != "null"/.test(registerSh),
      'Power step should be conditional on BATTERY_JSON')
  })

  it('aid (x86) gathers cleanly — regression check (dry-run, no server)', () => {
    // DRY_RUN=true skips the HTTP POST so the suite is hermetic (green with
    // grimoire.service stopped). The gather output is identical either way.
    const out = execSync('DRY_RUN=true bash deploy/grim-register-host.sh 2>&1', {
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.ok(out.includes('AMD Ryzen 5 5500'), 'CPU model should appear')
    assert.ok(out.includes('30GB'), 'RAM should appear in GB')
    assert.ok(!out.includes('\u26a0'), 'no warnings on x86 server')
    // Power step should be absent on a server without battery
    const lines = out.split('\n')
    const powerLine = lines.findIndex(l => l.includes('Power'))
    if (powerLine >= 0) {
      // If Power step is shown, it should have an ok line after it
      const nextLine = lines[powerLine + 1] || ''
      assert.ok(nextLine.includes('\u2714') || nextLine.includes('✔') || nextLine.includes('Battery'),
        'Power step should have output when shown')
    }
    // Dry-run should emit the entity payload
    assert.ok(out.includes('--- DRY RUN — entity payload ---'), 'dry-run should emit payload marker')
    assert.ok(out.includes('"@id":"host_'), 'payload should contain host entity')
  })

  it('aid (x86) full register round-trip — integration (skipped in default suite)', {skip: true}, () => {
    // Requires grimoire.service running. Run manually:
    //   node --test test/platform-gather.test.js --test-name-pattern="integration"
    const out = execSync('bash deploy/grim-register-host.sh 2>&1', {
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.ok(out.includes('Registered'), 'register should succeed')
  })

  it('_gather_power exports null battery on x86 server', () => {
    const out = execSync(`bash -c '
      source deploy/platform.d/linux.sh
      _gather_power
      echo "BATTERY_JSON=$BATTERY_JSON"
      echo "IS_LAPTOP=$IS_LAPTOP"
      echo "PRODUCT_NAME=$PRODUCT_NAME"
    ' 2>&1`, { encoding: 'utf8', timeout: 10000 })
    assert.ok(out.includes('BATTERY_JSON=null'), 'BATTERY_JSON should be null on server')
    assert.ok(out.includes('IS_LAPTOP=false'), 'IS_LAPTOP should be false on server')
  })

  it('_gather_mem exports MEM_TOTAL_MB', () => {
    const out = execSync(`bash -c '
      source deploy/platform.d/linux.sh
      _gather_mem
      echo "MEM_TOTAL_GB=$MEM_TOTAL_GB"
      echo "MEM_TOTAL_MB=$MEM_TOTAL_MB"
    ' 2>&1`, { encoding: 'utf8', timeout: 10000 })
    assert.ok(out.includes('MEM_TOTAL_GB='), 'MEM_TOTAL_GB should be set')
    assert.ok(out.includes('MEM_TOTAL_MB='), 'MEM_TOTAL_MB should be set')
    const gbMatch = out.match(/MEM_TOTAL_GB=(\d+)/)
    const mbMatch = out.match(/MEM_TOTAL_MB=(\d+)/)
    assert.ok(gbMatch && mbMatch, 'both values should be numeric')
    assert.ok(Number(mbMatch[1]) > Number(gbMatch[1]), 'MB should exceed GB')
  })
})
