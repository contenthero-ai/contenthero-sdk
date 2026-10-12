import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProgram } from '../program.js'
import { transcriptionHuman } from './transcribe.js'

test('a running post says how to follow it, free', () => {
  const out = transcriptionHuman({ status: 'running', contentId: 'c1', slide: 2, charge: { credits: 0, held: 6, state: 'pending', balanceAfter: null } })
  assert.match(out, /Still transcribing post c1, slide 2\. Run `contenthero transcribe --content-id c1 --slide 2` again to follow it, which is free\./)
  assert.match(out, /Estimated cost/)
})

test("a post's one video prints its transcript and where it is read word-timed; a silent one says so", () => {
  const out = transcriptionHuman({ status: 'completed', contentId: 'c1', transcript: 'one two', language: 'en', wordCount: 2, durationSeconds: 3 })
  assert.match(out, /Post.*post c1/)
  assert.match(out, /Transcript.*one two/)
  assert.match(out, /contenthero content get c1 --transcript segments/)
  const silent = transcriptionHuman({ status: 'completed', contentId: 'c1', slide: 0, transcript: '', wordCount: 0, durationSeconds: 3 })
  assert.match(silent, /No speech was heard\./)
  assert.doesNotMatch(silent, /content get/)
})

test('transcribe takes exactly one source, and --slide only for a post', async () => {
  for (const args of [
    [],
    ['https://cdn/a.mp3', '--content-id', 'c1'],
    ['https://cdn/a.mp3', '--slide', '0'],
    ['--content-id', 'c1', '--language', 'en'],
  ]) {
    const program = buildProgram().exitOverride()
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    await assert.rejects(program.parseAsync(['node', 'contenthero', 'transcribe', ...args, '--api-key', 'ch_live_x']), (err: { exitCode?: number }) => err.exitCode === 2, JSON.stringify(args))
  }
})
