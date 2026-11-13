import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'
import { optionFromContract } from '@contenthero/sdk'

const fixture = JSON.parse(readFileSync(new URL('../../../sdk/src/fixtures/video-controls.json', import.meta.url), 'utf8'))
const models = fixture.models.map((m: object) => ({ displayName: 'Video', contentType: 'video', kind: 'generate', tags: [], ...m }))
let server: Server
let baseUrl = ''
const seen: Array<Record<string, unknown>> = []

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') {
      res.end(JSON.stringify(req.url === '/api/v1/models' ? { models } : models.find(m => req.url?.endsWith(m.modelId)) ?? { modelId: 'video', displayName: 'Video', contentType: 'video', kind: 'generate', tags: [], capabilities: {} }))
      return
    }
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push(body)
      if (body.quality === 'refuse') {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'quality outside the declaration' }))
        return
      }
      res.end(JSON.stringify(body.getCost ? { creditsEstimate: 1 } : { outputId: 'image', status: 'processing' }))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function run(...args: string[]): Promise<void> {
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })
}

async function read(...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../index.ts', import.meta.url)), '--api-key', 'k', '--base-url', baseUrl, ...args])
  return stdout
}

test('video flags submit declared controls for generation and cost preview', async () => {
  for (const cost of [false, true]) {
    for (const [flags, fields] of [
      [['--draft'], { parameters: { draft: true } }],
      [['--upgrade-from-output-id', 'draft', '--upgrade-slot', '0', '--output-format', 'mov', '--return-last-frame'],
        { upgradeFromOutputId: 'draft', upgradeSlot: 0, parameters: { outputFormat: 'mov', returnLastFrame: true } }],
      [[], {}],
    ] as const) {
      await run('generate', 'video', '--model', 'video', ...flags, cost ? '--cost' : '--no-wait')
      const { outputId, getCost, ...body } = seen.at(-1)!
      assert.equal(getCost, cost ? true : undefined)
      assert.deepEqual(body, { contentType: 'video', kind: 'generate', modelId: 'video', ...fields })
    }
  }
})

test('existing video flags retain their request body', async () => {
  await run('generate', 'video', 'a bird', '--model', 'video', '--duration', '4', '--start-frame', 'image', '--no-wait')
  const { outputId, ...body } = seen.at(-1)!
  assert.deepEqual(body, { contentType: 'video', kind: 'generate', modelId: 'video', prompt: 'a bird', duration: 4, references: { startFrame: 'image' } })
})

test('video flags use canonical descriptions', () => {
  const video = buildProgram().commands.find(c => c.name() === 'generate')!.commands.find(c => c.name() === 'video')!
  for (const key of ['draft', 'upgradeFromOutputId', 'upgradeSlot', 'outputFormat', 'returnLastFrame']) {
    assert.equal(video.options.find(o => o.attributeName() === key)!.description, optionFromContract('generate_video', key).description)
  }
})

test('video discovery prints declarations on list and get and retains JSON', async () => {
  const list = await read('--human', 'model', 'list')
  for (const pattern of [/resolution when enabled: 480p/, /draft upgrade: 1080p/, /singleVideo/, /Voiceover/]) assert.match(list, pattern)
  for (const model of models) {
    const text = await read('--human', 'model', 'get', model.modelId)
    if (model.capabilities.draftUpgrade) assert.match(text, /draft upgrade: 1080p/)
    else { assert.match(text, /singleVideo/); assert.match(text, /Voiceover/) }
    assert.deepEqual(JSON.parse(await read('--json', 'model', 'get', model.modelId)).capabilities, model.capabilities)
  }
})
