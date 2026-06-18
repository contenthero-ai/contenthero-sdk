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
    'generate',
    'upscale',
    'generation',
    'media',
    'post',
    'pipeline',
    'brand-kit',
    'avatar',
    'voice',
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
