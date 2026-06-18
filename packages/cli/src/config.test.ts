import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearCredential,
  credentialsPath,
  readConfig,
  readCredential,
  writeConfig,
  writeCredential,
} from './config.js'

test('credential round-trips and is written 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  try {
    assert.equal(readCredential(), undefined)
    writeCredential({ apiKey: 'ch_live_abc', createdAt: 'now' })
    assert.equal(readCredential()?.apiKey, 'ch_live_abc')
    assert.equal(statSync(credentialsPath()).mode & 0o777, 0o600)
    assert.equal(clearCredential(), true)
    assert.equal(clearCredential(), false)
    assert.equal(readCredential(), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})

test('config read tolerates a missing file and round-trips baseUrl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  try {
    assert.deepEqual(readConfig(), {})
    writeConfig({ baseUrl: 'https://preview.example' })
    assert.equal(readConfig().baseUrl, 'https://preview.example')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})
