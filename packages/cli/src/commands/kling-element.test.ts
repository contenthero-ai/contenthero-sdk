import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/**
 * `contenthero kling-element` and `generate video --kling-element` (renamed 2026-10-04 from `element` and `--element`,
 * because the word also named the editor's Elements panel). The old spellings stay for one release window, HIDDEN:
 * they must still reach the wire exactly as the new ones do, and help must show only the new ones. Each case runs the
 * real command against a local server and asserts what it received.
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

for (const group of ['kling-element', 'element']) {
  test(`${group} <verb> reaches /api/v1/kling-elements`, async () => {
    for (const verb of VERBS) {
      const r = await run(group, ...verb.args)
      assert.equal(`${r.method} ${r.path}`, `${verb.method} ${verb.path}`, `${group} ${verb.args[0]}`)
      if (verb.body) assert.deepEqual(r.body, verb.body)
    }
  })
}

test('generate video --kling-element sends klingElements by klingElementId', async () => {
  const r = await run('generate', 'video', '@hero walks in', '-m', 'kling-3.0', '--start-frame', 'https://cdn/s.png',
    '--kling-element', 'Kling001', '--kling-element', 'Kling002', '--cost')
  const references = r.body?.references as Record<string, unknown>
  assert.deepEqual(references.klingElements, [{ klingElementId: 'Kling001' }, { klingElementId: 'Kling002' }])
  assert.equal(references.elements, undefined)
})

test('the hidden --element still works, and --kling-element wins over it', async () => {
  const old = await run('generate', 'video', 'p', '-m', 'kling-3.0', '--start-frame', 'https://cdn/s.png', '--element', 'Kling001', '--cost')
  assert.deepEqual((old.body?.references as Record<string, unknown>).klingElements, [{ klingElementId: 'Kling001' }])
  const both = await run('generate', 'video', 'p', '-m', 'kling-3.0', '--start-frame', 'https://cdn/s.png',
    '--kling-element', 'NewOne11', '--element', 'OldOne11', '--cost')
  assert.deepEqual((both.body?.references as Record<string, unknown>).klingElements, [{ klingElementId: 'NewOne11' }])
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
