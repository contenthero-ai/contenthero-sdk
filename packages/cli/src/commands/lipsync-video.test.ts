import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { optionFromContract, ValidationError } from '@contenthero/sdk'
import { buildProgram } from '../program.js'

let server: Server
let baseUrl = ''
const seen: Array<Record<string, unknown>> = []
const models = ['singleImage', 'singleVideo'].map((input, i) => ({ modelId: `discovered-${i}`, displayName: `Source ${i}`, contentType: 'video', kind: 'lip-sync', tags: [], capabilities: { kind: 'lip-sync', inputTypes: [input] } }))
const refusals = {
  missing: "model 'video-model' requires a base video in references.videos",
  wrong: "model 'video-model' dubs a video and does not accept an image; pass a video URL in references.videos",
}
before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') {
      // A model asked for by id that the catalog does not list is a lip-sync model of that id, so each case can name its own.
      const id = decodeURIComponent((req.url ?? '').split('/').pop() ?? '')
      const lipSync = { modelId: id, displayName: id, contentType: 'video', kind: 'lip-sync', tags: [], capabilities: { kind: 'lip-sync' } }
      res.end(JSON.stringify(req.url === '/api/v1/models' ? { models } : models.find(m => m.modelId === id) ?? lipSync))
      return
    }
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push(body)
      const refusal = refusals[body.modelId as keyof typeof refusals]
      if (refusal) { res.statusCode = 400; res.end(JSON.stringify({ error: refusal })); return }
      res.end(JSON.stringify(body.getCost ? { creditsEstimate: 1 } : { outputId: 'lip', status: 'processing' }))
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

test('lip sync flags forward all fields for both visual sources and voice sources on both paths', async () => {
  for (const cost of [false, true]) {
    for (const [source, references] of [
      [['--ref', 'portrait'], { images: ['portrait'] }],
      [['--ref-video', 'source-video'], { videos: ['source-video'] }],
    ] as const) {
      for (const [voice, fields] of [
        [['--ref-audio', 'speech', '--audio-duration', '4.2'], { references: { ...references, audio: ['speech'] }, durationSeconds: 4.2 }],
        [['--script', 'Hello', '--voice-id', 'voice', '--voice-name', 'Speaker'], { references, text: 'Hello', voiceId: 'voice', voiceName: 'Speaker' }],
      ] as const) {
        await run('generate', 'video', 'Smile', '--model', 'declared-model', ...source, ...voice, '--resolution', '720p', cost ? '--cost' : '--no-wait')
        const { outputId, getCost, ...body } = seen.at(-1)!
        assert.equal(getCost, cost ? true : undefined)
        assert.deepEqual(body, { contentType: 'video', kind: 'lip-sync', modelId: 'declared-model', prompt: 'Smile', resolution: '720p', ...fields })
      }
    }
  }
})

test('existing minimal portrait request retains its body', async () => {
  await run('generate', 'video', '--model', 'portrait-model', '--ref', 'portrait', '--ref-audio', 'speech', '--no-wait')
  const { outputId, ...body } = seen.at(-1)!
  assert.deepEqual(body, { contentType: 'video', kind: 'lip-sync', modelId: 'portrait-model', references: { images: ['portrait'], audio: ['speech'] } })
})

test('missing and wrong visual sources reach the server and preserve its refusal', async () => {
  for (const cost of [false, true]) {
    for (const [model, source] of [['missing', []], ['wrong', ['--ref', 'portrait']]] as const) {
      await assert.rejects(run('generate', 'video', '--model', model, ...source, '--ref-audio', 'speech', cost ? '--cost' : '--no-wait'), (err: unknown) => {
        assert.ok(err instanceof ValidationError)
        assert.equal(err.message, refusals[model])
        return true
      })
      assert.deepEqual(seen.at(-1)!.references, { ...(model === 'wrong' ? { images: ['portrait'] } : {}), audio: ['speech'] })
    }
  }
})

test('repeatable video references and mixed sources are forwarded for server validation', async () => {
  await run('generate', 'video', '--model', 'declared-model', '--ref-video', 'first', '--ref-video', 'second', '--ref', 'portrait', '--ref-audio', 'speech', '--no-wait')
  assert.deepEqual(seen.at(-1)!.references, { images: ['portrait'], videos: ['first', 'second'], audio: ['speech'] })
})

test('generate video help reads the lip-sync parameter descriptions from the contract', () => {
  const command = buildProgram().commands.find(c => c.name() === 'generate')!.commands.find(c => c.name() === 'video')!
  for (const [flag, input] of Object.entries({ script: 'script', voiceId: 'voiceId', voiceName: 'voiceName', audioDuration: 'audioDurationSeconds' })) {
    const option = command.options.find(o => o.attributeName() === flag)!
    assert.equal(option.description, optionFromContract('generate_video', input).description)
  }
})

test('a lip-sync model refuses a field its kind does not take, naming the model', async () => {
  await assert.rejects(run('generate', 'video', '--model', 'declared-model', '--ref', 'portrait', '--ref-audio', 'speech', '--aspect', '16:9', '--no-wait'), (err: unknown) => {
    assert.ok(err instanceof ValidationError)
    assert.match(err.message, /declared-model/)
    assert.match(err.message, /aspectRatio/)
    return true
  })
})

test('lip sync discovery states each visual source in list and detail and preserves JSON', async () => {
  const list = await read('--human', 'model', 'list')
  for (const [i, expected] of ['visual source: imageUrl (portrait)', 'visual source: referenceVideos (video)'].entries()) {
    const model = models[i]
    for (const text of [list, await read('--human', 'model', 'get', model.modelId)]) assert.ok(text.includes(expected))
    assert.deepEqual(JSON.parse(await read('--json', 'model', 'get', model.modelId)).capabilities, model.capabilities)
  }
})
