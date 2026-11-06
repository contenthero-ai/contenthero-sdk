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

const fixture = JSON.parse(readFileSync(new URL('../../../sdk/src/fixtures/gpt-image-2-6.json', import.meta.url), 'utf8'))
const models = fixture.models.map((m: object) => ({ displayName: 'Image', contentType: 'image', kind: 'generate', tags: [], ...m }))
let server: Server
let baseUrl = ''
const seen: Array<Record<string, unknown>> = []

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') {
      res.end(JSON.stringify(req.url === '/api/v1/models' ? { models } : models.find(m => req.url?.endsWith(m.modelId))))
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

test('image flags submit numeric or string counts from the declared control for generation and cost', async () => {
  for (const model of models) {
    const c = model.capabilities
    const setting = c.settings.find(s => s.key === c.imageOutput.gif.frameCountKey)
    const count = setting.default
    for (const cost of [false, true]) {
      await run('generate', 'image', 'a cat', '--model', model.modelId,
        '--quality', 'medium', '--output-format', 'gif', '--background', 'auto',
        '--frame-count', String(count), '--frame-duration-ms', '200', '--frame-size', '512x512', cost ? '--cost' : '--no-wait')
      const { outputId, getCost, ...body } = seen.at(-1)!
      assert.equal(getCost, cost ? true : undefined)
      assert.deepEqual(body, { contentType: 'image', kind: 'generate', modelId: model.modelId, prompt: 'a cat', quality: 'medium', outputFormat: 'gif', parameters: { background: 'auto' }, frameCount: count, frameDurationMs: 200, frameSize: '512x512' })
    }
  }
})

test('image requests omit every untouched control', async () => {
  await run('generate', 'image', 'a cat', '--model', models[0].modelId, '--no-wait')
  const { outputId, ...body } = seen.at(-1)!
  assert.deepEqual(body, { contentType: 'image', kind: 'generate', modelId: models[0].modelId, prompt: 'a cat' })
})

test('image flags use canonical parameter descriptions', () => {
  const image = buildProgram().commands.find(c => c.name() === 'generate')!.commands.find(c => c.name() === 'image')!
  for (const key of ['quality', 'outputFormat', 'background', 'frameCount', 'frameDurationMs', 'frameSize']) {
    const option = image.options.find(o => o.attributeName() === key)!
    assert.equal(option.description, optionFromContract('generate_image', key).description)
  }
})

test('image discovery prints capability details on list and get and retains JSON', async () => {
  const list = await read('--human', 'model', 'list')
  assert.match(list, /GIF sprite sheet/)
  for (const model of models) {
    const text = await read('--human', 'model', 'get', model.modelId)
    assert.match(text, /applies to GIF output/)
    assert.match(text, /formats with reference images/)
    if (model.capabilities.modelParams) assert.match(text, /model defaults/)
    const json = await read('--json', 'model', 'get', model.modelId)
    assert.deepEqual(JSON.parse(json).capabilities, model.capabilities)
  }
})

test('image CLI preserves server refusal text', async () => {
  await assert.rejects(run('generate', 'image', '--model', models[0].modelId, '--quality', 'refuse', '--no-wait'), /quality outside the declaration/)
})
