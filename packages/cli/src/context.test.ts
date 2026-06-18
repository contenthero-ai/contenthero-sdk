import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { resolveContext, type Context } from './context.js'
import { writeCredential } from './config.js'

/** Parse global flags + a probe subcommand and capture the resolved context. */
function ctxFor(flags: string[]): Context {
  const program = new Command()
  program
    .exitOverride()
    .option('--json')
    .option('--human')
    .option('--api-key <key>')
    .option('--base-url <url>')
  let captured: Context | undefined
  program.command('probe').action((_opts, command: Command) => {
    captured = resolveContext(command)
  })
  program.parse(['node', 'test', ...flags, 'probe'])
  if (!captured) throw new Error('probe did not run')
  return captured
}

test('the --api-key flag wins over env and file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  process.env.CONTENTHERO_API_KEY = 'envkey'
  try {
    writeCredential({ apiKey: 'filekey' })
    const ctx = ctxFor(['--api-key', 'flagkey'])
    assert.equal(ctx.keySource, 'flag')
    assert.equal(ctx.apiKey, 'flagkey')
  } finally {
    delete process.env.CONTENTHERO_API_KEY
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})

test('env wins over the stored file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  process.env.CONTENTHERO_API_KEY = 'envkey'
  try {
    writeCredential({ apiKey: 'filekey' })
    const ctx = ctxFor([])
    assert.equal(ctx.keySource, 'env')
    assert.equal(ctx.apiKey, 'envkey')
  } finally {
    delete process.env.CONTENTHERO_API_KEY
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})

test('the stored file is used when no flag or env is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  delete process.env.CONTENTHERO_API_KEY
  try {
    writeCredential({ apiKey: 'filekey' })
    const ctx = ctxFor([])
    assert.equal(ctx.keySource, 'file')
    assert.equal(ctx.apiKey, 'filekey')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})

test('no key anywhere resolves to source "none"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  delete process.env.CONTENTHERO_API_KEY
  try {
    const ctx = ctxFor([])
    assert.equal(ctx.keySource, 'none')
    assert.equal(ctx.apiKey, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})

test('--human turns off json; default is json', () => {
  assert.equal(ctxFor([]).json, true)
  assert.equal(ctxFor(['--human']).json, false)
  assert.equal(ctxFor(['--human', '--json']).json, true)
})

test('base URL resolves from the --base-url flag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-cli-'))
  process.env.CONTENTHERO_CONFIG_DIR = dir
  delete process.env.CONTENTHERO_API_KEY
  delete process.env.CONTENTHERO_BASE_URL
  try {
    const ctx = ctxFor(['--base-url', 'https://preview.example'])
    assert.equal(ctx.baseUrl, 'https://preview.example')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CONTENTHERO_CONFIG_DIR
  }
})
