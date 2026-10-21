import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * `media get` prints an audio item's recorded facts per variation, in the SDK's one wording, with the bitrate labeled
 * as derived. A variation with no facts prints no line; one with only some prints only those.
 * Break-verified: dropping the audio block from `media get` turns the first red.
 */

const run = promisify(execFile)
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')
let body: unknown = {}
let server: Server
let baseUrl = ''

before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

const v = { status: 'completed', isFavorited: false, isArchived: false }
const item = (variations: unknown[]) => ({ id: 'i1', shortId: 'Abc12345', appUrl: 'https://app.test/m/Abc12345', mediaId: 'Abc12345', type: 'audio', status: 'completed', variations })

async function mediaGet(): Promise<string> {
  const { stdout } = await run(process.execPath, ['--import', 'tsx', entry, '--human', '--api-key', 'k', '--base-url', baseUrl, 'media', 'get', 'Abc12345'], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  return stdout
}

test('an audio variation prints its facts, the bitrate labeled as derived', async () => {
  body = item([{ mediaId: 'Abc12345-1', url: 'u1', ...v, audio: { sizeBytes: 480000, mimeType: 'audio/mpeg', durationSeconds: 30, derivedBitrateKbps: 128 } }])
  const out = await mediaGet()
  assert.match(out, /Audio:\n {2}Abc12345-1: audio\/mpeg, 468\.8 KB, 30\.00s, 128 kbps mean \(derived from size and duration\)/)
})

test('a variation with some facts prints those only, and one with none prints no line', async () => {
  body = item([
    { mediaId: 'Abc12345-1', url: 'u1', ...v, audio: { sizeBytes: 1000, mimeType: 'audio/wav' } },
    { mediaId: 'Abc12345-2', url: 'u2', ...v },
  ])
  const out = await mediaGet()
  assert.match(out, /Abc12345-1: audio\/wav, 1000 B\n/)
  assert.doesNotMatch(out, /Abc12345-2:/)
  assert.doesNotMatch(out, /kbps/)
})

test('an item with no audio facts has no Audio block', async () => {
  body = item([{ mediaId: 'Abc12345-1', url: 'u1', ...v }])
  assert.doesNotMatch(await mediaGet(), /Audio:/)
})
