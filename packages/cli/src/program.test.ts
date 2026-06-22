import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProgram } from './program.js'

/** Names of the immediate subcommands of a named top-level group. */
function subcommands(group: string): string[] {
  const program = buildProgram()
  const cmd = program.commands.find((c) => c.name() === group)
  assert.ok(cmd, `group ${group} is registered`)
  return cmd!.commands.map((c) => c.name())
}

test('every top-level command group is registered', () => {
  const names = buildProgram().commands.map((c) => c.name())
  for (const expected of [
    'auth',
    'login',
    'logout',
    'config',
    'account',
    'model',
    'platform',
    'generate',
    'upscale',
    'transcribe',
    'generation',
    'media',
    'post',
    'tag',
    'pipeline',
    'brand-kit',
    'avatar',
    'voice',
    'inspiration',
    'brand-account',
    'connected-account',
    'schema',
  ]) {
    assert.ok(names.includes(expected), `missing top-level command: ${expected}`)
  }
})

test('generate exposes the five generation subcommands', () => {
  const subs = subcommands('generate')
  for (const n of ['image', 'video', 'audio', 'board', 'lip-sync']) {
    assert.ok(subs.includes(n), `generate is missing: ${n}`)
  }
})

test('post exposes its verbs and nested destination/asset groups', () => {
  const subs = subcommands('post')
  for (const n of ['list', 'get', 'create', 'update', 'archive', 'schedule', 'publish', 'destination', 'asset']) {
    assert.ok(subs.includes(n), `post is missing: ${n}`)
  }
})

test('brand-kit exposes its verbs and the section group', () => {
  const subs = subcommands('brand-kit')
  for (const n of ['list', 'get', 'update', 'archive', 'section']) {
    assert.ok(subs.includes(n), `brand-kit is missing: ${n}`)
  }
})

test('avatar and voice expose list + get', () => {
  assert.deepEqual(subcommands('avatar').sort(), ['get', 'list'])
  assert.deepEqual(subcommands('voice').sort(), ['get', 'list'])
})

test('model and platform expose list + get', () => {
  assert.deepEqual(subcommands('model').sort(), ['get', 'list'])
  assert.deepEqual(subcommands('platform').sort(), ['get', 'list'])
})

test('inspiration exposes accounts/account/outliers/content', () => {
  const subs = subcommands('inspiration')
  for (const n of ['accounts', 'account', 'outliers', 'content']) {
    assert.ok(subs.includes(n), `inspiration is missing: ${n}`)
  }
})

test('schema dumps a scoped command with its options, needing no key', async () => {
  const program = buildProgram()
  program.exitOverride()
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  ;(process.stdout as { write: unknown }).write = (s: string) => {
    chunks.push(String(s))
    return true
  }
  try {
    await program.parseAsync(['node', 'contenthero', 'schema', 'generate', 'image'])
  } finally {
    ;(process.stdout as { write: unknown }).write = orig
  }
  const dumped = JSON.parse(chunks.join('')) as {
    globalOptions: Array<{ flags: string }>
    commands: Array<{ command: string; options: Array<{ flags: string; required: boolean }> }>
  }
  assert.equal(dumped.commands.length, 1)
  assert.equal(dumped.commands[0]?.command, 'generate image')
  const model = dumped.commands[0]?.options.find((o) => o.flags.includes('--model'))
  assert.ok(model?.required, 'model option is marked required')
  assert.ok(dumped.globalOptions.some((o) => o.flags.includes('--api-key')))
})
