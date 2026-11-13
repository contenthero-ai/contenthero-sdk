import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotFoundError, ValidationError } from './errors.js'
import { HOMES, MODEL_KINDS, getMediumModel, isBoardModel, matchingToolSentence, operationInputs, planMediumCall, toolForModel } from './medium.js'
import type { ModelInfo } from './types.js'

function model(modelId: string, contentType: string, kind: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { modelId, contentType, kind, ...extra } as ModelInfo
}

test('every registry kind has a home entry for every medium', () => {
  for (const kind of MODEL_KINDS) {
    assert.deepEqual(Object.keys(HOMES[kind]).sort(), ['audio', 'image', 'video'], kind)
  }
})

test('toolForModel names the tool of the model medium and kind', () => {
  assert.equal(toolForModel(model('a', 'image', 'generate')), 'generate_image')
  assert.equal(toolForModel(model('a', 'image', 'layer-separation')), 'generate_image')
  assert.equal(toolForModel(model('a', 'video', 'lip-sync')), 'generate_video')
  assert.equal(toolForModel(model('a', 'video', 'background-removal')), 'generate_video')
  assert.equal(toolForModel(model('a', 'audio', 'generate')), 'generate_audio')
  assert.equal(toolForModel(model('a', 'video', 'layer-separation')), null)
  assert.match(matchingToolSentence(model('a', 'video', 'upscale')), /generate_video/)
})

test('an audio model names the tool the registry says runs it, not its kind alone', () => {
  const caps = (outputType: string) => ({ capabilities: { outputType } }) as Partial<ModelInfo>
  assert.equal(toolForModel(model('iso', 'audio', 'voice', { editOperation: 'isolate' })), 'edit_audio')
  assert.equal(toolForModel(model('enh', 'audio', 'enhance', { editOperation: 'enhance' })), 'edit_audio')
  assert.equal(toolForModel(model('spl', 'audio', 'stem-separation', { editOperation: 'split' })), 'edit_audio')
  assert.equal(toolForModel(model('stt', 'audio', 'generate', caps('text'))), 'transcribe')
  assert.equal(toolForModel(model('tts', 'audio', 'generate', caps('audio'))), 'generate_audio')
  assert.match(matchingToolSentence(model('stt', 'audio', 'generate', caps('text'))), /Runs with transcribe \(transcription\)/)
  // No agent tool runs the voice changer or the voice creation flows, and discovery says so.
  assert.equal(toolForModel(model('vc', 'audio', 'voice', { editOperation: 'change_voice' })), null)
  assert.equal(toolForModel(model('vd', 'audio', 'voice', caps('voice'))), null)
  assert.match(matchingToolSentence(model('vc', 'audio', 'voice', { editOperation: 'change_voice' })), /No agent tool runs this model/)
})

test('a board model is told apart by its board types', () => {
  assert.equal(isBoardModel(model('b', 'image', 'generate', { boardTypes: [] } as never)), true)
  assert.equal(isBoardModel(model('b', 'image', 'generate')), false)
  assert.ok(operationInputs(model('b', 'image', 'generate', { boardTypes: [] } as never))!.includes('boardType'))
})

test('an upscale builds its request from the one reference source', () => {
  const plan = planMediumCall(model('up', 'image', 'upscale'), 'image', { modelId: 'up', referenceImages: ['u'], upscaleFactor: '2x' })
  assert.deepEqual(plan, {
    route: 'operation',
    request: { contentType: 'image', modelId: 'up', kind: 'upscale', upscaleFactor: '2x', references: { images: ['u'] } },
  })
})

test('a video upscale needs the source length', () => {
  assert.throws(
    () => planMediumCall(model('vu', 'video', 'upscale'), 'video', { modelId: 'vu', referenceVideos: ['u'], upscaleFactor: '2x' }),
    (e: unknown) => e instanceof ValidationError && /vu needs sourceDurationSeconds/.test(e.message),
  )
})

test('layer separation takes one source image and returns an operation', () => {
  const plan = planMediumCall(model('ls', 'image', 'layer-separation'), 'image', { modelId: 'ls', referenceImages: ['p'] })
  assert.equal(plan.route, 'operation')
  assert.throws(() => planMediumCall(model('ls', 'image', 'layer-separation'), 'image', { modelId: 'ls', referenceImages: ['p', 'q'] }), /exactly one source/)
})

test('a lip-sync model reads its speech from the reference audio or the script', () => {
  const plan = planMediumCall(model('lip', 'video', 'lip-sync'), 'video', {
    modelId: 'lip', referenceImages: ['face'], referenceAudio: ['voice'], audioDurationSeconds: 3,
  })
  assert.equal(plan.route, 'operation')
  if (plan.route === 'operation') {
    assert.equal(plan.request.kind, 'lip-sync')
    assert.deepEqual(plan.request.references, { images: ['face'], audio: ['voice'] })
    assert.equal(plan.request.durationSeconds, 3)
  }
})

test('a board model routes to the board request', () => {
  const plan = planMediumCall(model('bd', 'image', 'generate', { boardTypes: [] } as never), 'image', {
    modelId: 'bd', boardType: 'character' as never, prompt: 'x',
  })
  assert.equal(plan.route, 'board')
})

test('a plain generation routes to generate and refuses another operation field', () => {
  assert.deepEqual(planMediumCall(model('g', 'image', 'generate'), 'image', { modelId: 'g', prompt: 'x' }), { route: 'generate' })
  assert.throws(
    () => planMediumCall(model('g', 'image', 'generate'), 'image', { modelId: 'g', prompt: 'x', upscaleFactor: '2x' }),
    (e: unknown) => e instanceof ValidationError && /g is a model for image work/.test(e.message) && /upscaleFactor/.test(e.message),
  )
})

test('a field the operation does not take is refused with the model and what it takes', () => {
  assert.throws(
    () => planMediumCall(model('up', 'image', 'upscale'), 'image', { modelId: 'up', referenceImages: ['u'], upscaleFactor: '2x', aspectRatio: '1:1' }),
    (e: unknown) => e instanceof ValidationError && /up is a model for image work/.test(e.message) && /aspectRatio/.test(e.message) && /It takes:/.test(e.message),
  )
})

test('a model of another medium is refused and points to its tool', () => {
  assert.throws(
    () => planMediumCall(model('v', 'video', 'generate'), 'image', { modelId: 'v', prompt: 'x' }),
    (e: unknown) => e instanceof ValidationError && /Use generate_video/.test(e.message),
  )
})

test('an unknown model id is answered with the models the tool runs, and a good id reads no listing', async () => {
  const catalog = [model('img', 'image', 'generate'), model('ups', 'image', 'upscale'), model('vid', 'video', 'generate')]
  let listed = 0
  const reader = {
    getModel: async (id: string) => {
      const found = catalog.find((m) => m.modelId === id)
      if (!found) throw new NotFoundError('Not found', { status: 404 })
      return found
    },
    listModels: async (o?: { contentType?: string }) => {
      listed++
      return catalog.filter((m) => !o?.contentType || m.contentType === o.contentType)
    },
  }
  assert.equal((await getMediumModel(reader, 'img', 'image')).modelId, 'img')
  assert.equal(listed, 0)
  await assert.rejects(
    () => getMediumModel(reader, 'nope', 'image'),
    (e: unknown) => e instanceof NotFoundError && /Model 'nope' not found/.test(e.message) && /img, ups/.test(e.message) && !/vid/.test(e.message) && e.status === 404,
  )
  assert.equal(listed, 1)
})
