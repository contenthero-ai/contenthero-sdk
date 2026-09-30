import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioResult, modelResult } from './format.js'

/**
 * Two speech-model surfaces, both found 2026-09-30 while moving text to speech to Eleven v4.
 *
 * 1. An audio result card named no model: `audioResult` passed nothing to the widget, so every speech, music
 *    and sound-effect card rendered blank where every image and video card shows its model.
 * 2. `get_model` is where an external agent learns how to write a model's prompt, and the registry's
 *    `promptGuide` (for a speech model: how to direct delivery inside the script) must reach it verbatim.
 */

const structured = (r: ReturnType<typeof audioResult>) => r.structuredContent as Record<string, unknown>

test('an audio card carries the model the server named', () => {
  const r = audioResult({
    outputId: 'a1',
    appUrl: 'https://app.contenthero.ai/media/a1',
    status: 'completed',
    outputUrls: ['https://a/1.mp3'],
    modelId: 'elevenlabs-tts',
    modelDisplayName: 'Text to Speech',
    modelBrandColor: '#1A1A2E',
    modelIconKey: 'elevenlabs',
  })
  const s = structured(r)
  assert.equal(s.modelId, 'elevenlabs-tts')
  assert.equal(s.modelName, 'Text to Speech')
  assert.equal(s.modelBrandColor, '#1A1A2E')
  assert.equal(s.modelIconKey, 'elevenlabs')
})

test('an audio card from a server that names no model renders no chip rather than the id', () => {
  const s = structured(audioResult({ outputId: 'a1', appUrl: 'x', status: 'completed', outputUrls: ['https://a/1.mp3'] }))
  assert.equal(s.modelName, null)
})

test('get_model prints the prompt guide verbatim', () => {
  const guide = 'Delivery is directed inside the text.'
  const r = modelResult({
    modelId: 'elevenlabs-tts',
    displayName: 'Text to Speech',
    brandColor: null,
    iconKey: null,
    description: null,
    contentType: 'audio',
    kind: 'generate',
    tags: [],
    capabilities: { kind: 'generate', outputType: 'audio', promptMode: 'required', promptGuide: guide },
  })
  const text = (r.content[0] as { text: string }).text
  assert.ok(text.includes(`writing the prompt: ${guide}`), text)
})

test('get_model prints no guide line for a model without one', () => {
  const r = modelResult({
    modelId: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    brandColor: null,
    iconKey: null,
    description: null,
    contentType: 'image',
    kind: 'generate',
    tags: [],
    capabilities: { kind: 'generate', outputType: 'image', promptMode: 'required' },
  })
  assert.ok(!(r.content[0] as { text: string }).text.includes('writing the prompt'))
})
