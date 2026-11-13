import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/**
 * `contenthero kling-element` and `generate video --kling-element` (renamed 2026-10-04 from `element` and `--element`,
 * because the word also named the editor's Elements panel). The old spellings are gone (a hard cutover): they are
 * refused, and help shows only the new ones. Each case runs the real command against a local server and asserts what
 * it received.
 */

type Seen = { method: string; path: string; body: Record<string, unknown> | null }
let server: Server
let baseUrl = ''
const seen: Seen[] = []
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  shortId: 'Kling001',
  appUrl: 'https://app.contenthero.ai/kling-element/Kling001',
  name: 'hero',
  category: 'character',
  description: 'the subject',
  inputUrls: ['https://media.contenthero.ai/a.jpg', 'https://media.contenthero.ai/b.jpg'],
  inputVideoUrl: null,
  previewUrl: 'https://media.contenthero.ai/a.jpg',
  createdAt: 't',
}

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      // The generate commands ask the registry what a model does before they submit; answer that read with a
      // plain generation model and keep it out of the recorded requests.
      if (req.method === 'GET' && /^\/api\/v1\/models\/[^/]+$/.test(url.pathname)) {
        const modelId = decodeURIComponent(url.pathname.split('/').pop() ?? '')
        const contentType = /^(kling|wan|seedance|veo)/.test(modelId) ? 'video' : 'image'
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ modelId, displayName: modelId, contentType, kind: 'generate', tags: [], capabilities: {} }))
        return
      }
      seen.push({ method: req.method ?? '', path: url.pathname, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ...ROW, klingElements: [ROW], deleted: true, creditsEstimate: 1 }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function run(...args: string[]): Promise<Seen> {
  seen.length = 0
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })
  assert.equal(seen.length, 1, `expected one request for: ${args.join(' ')}`)
  return seen[0]!
}

const VERBS: Array<{ args: string[]; method: string; path: string; body?: Record<string, unknown> }> = [
  { args: ['list'], method: 'GET', path: '/api/v1/kling-elements' },
  { args: ['get', 'Kling001'], method: 'GET', path: '/api/v1/kling-elements/Kling001' },
  {
    args: ['create', '--name', 'hero', '--description', 'the subject', '--image', 'a.jpg', '--image', 'b.jpg'],
    method: 'POST',
    path: '/api/v1/kling-elements',
    body: { name: 'hero', description: 'the subject', category: 'auto', images: ['a.jpg', 'b.jpg'] },
  },
  { args: ['update', 'Kling001', '--name', 'villain'], method: 'PATCH', path: '/api/v1/kling-elements/Kling001', body: { name: 'villain' } },
  { args: ['delete', 'Kling001'], method: 'DELETE', path: '/api/v1/kling-elements/Kling001' },
]

{
  const group = 'kling-element'
  test(`${group} <verb> reaches /api/v1/kling-elements`, async () => {
    for (const verb of VERBS) {
      const r = await run(group, ...verb.args)
      assert.equal(`${r.method} ${r.path}`, `${verb.method} ${verb.path}`, `${group} ${verb.args[0]}`)
      if (verb.body) assert.deepEqual(r.body, verb.body)
    }
  })
}

test('the retired element command group is refused', async () => {
  await assert.rejects(run('element', 'list'), /unknown command 'element'/)
})

test('generate video --kling-element sends klingElements by klingElementId', async () => {
  const r = await run('generate', 'video', '@hero walks in', '-m', 'kling-3.0', '--start-frame', 'https://cdn/s.png',
    '--kling-element', 'Kling001', '--kling-element', 'Kling002', '--cost')
  const references = r.body?.references as Record<string, unknown>
  assert.deepEqual(references.klingElements, [{ klingElementId: 'Kling001' }, { klingElementId: 'Kling002' }])
  assert.equal(references.elements, undefined)
})

test('the retired --element flag is refused', async () => {
  await assert.rejects(run('generate', 'video', 'p', '-m', 'kling-3.0', '--start-frame', 'https://cdn/s.png', '--element', 'Kling001', '--cost'), /unknown option '--element'/)
})

test('help shows kling-element and --kling-element, never the deprecated spellings', () => {
  const program = buildProgram()
  const help = program.helpInformation()
  assert.match(help, /^ {2}kling-element\b/m)
  assert.doesNotMatch(help, /^ {2}element\b/m)
  const video = program.commands.find((c) => c.name() === 'generate')!.commands.find((c) => c.name() === 'video')!
  const videoHelp = video.helpInformation()
  assert.match(videoHelp, /--kling-element <id>/)
  assert.doesNotMatch(videoHelp, /--element <id>/)
})

test('generate video --inline-kling-element sends an element defined in the call, with its video or its voice, after the saved ones', async () => {
  const r = await run('generate', 'video', '@dancer and @host', '-m', 'kling-4.0', '--cost',
    '--kling-element', 'Kling001',
    '--inline-kling-element', '{"name":"dancer","video":"https://cdn/dancer.mp4"}',
    '--inline-kling-element', '{"name":"host","images":["https://cdn/host.png"],"voice":"https://cdn/host.mp3"}')
  const references = r.body?.references as Record<string, unknown>
  assert.deepEqual(references.klingElements, [
    { klingElementId: 'Kling001' },
    { name: 'dancer', video: 'https://cdn/dancer.mp4' },
    { name: 'host', images: ['https://cdn/host.png'], voice: 'https://cdn/host.mp3' },
  ])
})

test('--inline-kling-element refuses what is not a JSON object', async () => {
  await assert.rejects(run('generate', 'video', 'p', '-m', 'kling-4.0', '--cost', '--inline-kling-element', '["x"]'), /Expected a JSON object/)
  await assert.rejects(run('generate', 'video', 'p', '-m', 'kling-4.0', '--cost', '--inline-kling-element', 'nope'), /Expected valid JSON/)
})

test('help for generate video shows --inline-kling-element', () => {
  const video = buildProgram().commands.find((c) => c.name() === 'generate')!.commands.find((c) => c.name() === 'video')!
  assert.match(video.helpInformation(), /--inline-kling-element <json>/)
})

test('generate video --keyframe, --voice and --keep-original-sound each reach the request body', async () => {
  const r = await run('generate', 'video', '@host talks', '-m', 'kling-4.0', '--cost',
    '--start-frame', 'https://cdn/s.png',
    '--keyframe', 'https://cdn/k1.png', '--keyframe', 'abc123-2',
    '--voice', 'host:https://cdn/host.mp3', '--voice', 'narrator:def456',
    '--keep-original-sound')
  const references = r.body?.references as Record<string, unknown>
  assert.deepEqual(references.keyframes, ['https://cdn/k1.png', 'abc123-2'])
  assert.deepEqual(references.voices, [{ name: 'host', audio: 'https://cdn/host.mp3' }, { name: 'narrator', audio: 'def456' }])
  assert.deepEqual(r.body?.parameters, { keepOriginalSound: true })
})

test('without the Kling 4.0 flags the request carries none of their fields', async () => {
  const r = await run('generate', 'video', 'p', '-m', 'kling-4.0', '--cost')
  assert.equal(r.body?.references, undefined)
  assert.equal(r.body?.parameters, undefined)
})

test('--voice needs a name, a colon and the audio', async () => {
  for (const bad of ['host', ':https://cdn/a.mp3', 'host:']) {
    await assert.rejects(run('generate', 'video', 'p', '-m', 'kling-4.0', '--cost', '--voice', bad), /Expected name:audio/)
  }
})
