import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/** `model get` prints a model's input counts, rules and modes through the SDK's shared words, as get_model does. */
let server: Server
let baseUrl = ''
const CAPS = {
  kind: 'generate', outputType: 'video', promptMode: 'required', inputTypes: ['startFrame'],
  inputModes: { exclusive: true, default: 'a', modes: [{ id: 'a', label: 'A', inputTypes: ['startFrame'] }] },
  maxKeyframes: 8, maxVoices: 3, maxVideoElements: 3,
  inputLimits: { videoInputsMax: 5, referenceVideoSec: { min: 2, max: 30 }, subjectVideo: { minSec: 3, maxSec: 8 } },
  settings: [{ key: 'keepOriginalSound', label: 'Keep original sound', control: 'toggle', default: false, appliesWhen: 'referenceVideo' }],
}

before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ modelId: 'm', displayName: 'M', contentType: 'video', kind: 'generate', tags: [], capabilities: CAPS, promptReferences: { scheme: 'named_tag', honored: true, instruction: 'x', inputs: [{ for: 'image', token: '@image_N', max: 10 }, { for: 'startFrame', token: '@first_frame', max: 1 }] } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

test('model get prints the input rules, the exclusive modes and the video limits', async () => {
  const lines: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((c: string | Uint8Array) => (lines.push(String(c)), true)) as typeof process.stdout.write
  try {
    await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--human', 'model', 'get', 'm'], { from: 'user' })
  } finally {
    process.stdout.write = orig
  }
  const out = lines.join('')
  assert.match(out, /keyframes: up to 8/)
  assert.match(out, /voices: up to 3/)
  assert.match(out, /video subjects: up to 3/)
  assert.match(out, /setting keepOriginalSound \(Keep original sound\): toggle, default false \(applies while a reference video is attached\)/)
  assert.match(out, /A request carries the inputs of one mode only; mixing modes is refused\./)
  assert.match(out, /reference videos: each 2 to 30s/)
  assert.match(out, /@image_N \(up to 10\), @first_frame/)
})
