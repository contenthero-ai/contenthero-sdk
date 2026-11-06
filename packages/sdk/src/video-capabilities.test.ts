import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ContentHero } from './client.js'
import { describeInputRules } from './describe.js'

const { models } = JSON.parse(readFileSync(new URL('./fixtures/video-controls.json', import.meta.url), 'utf8'))

test('SDK discovery preserves video declarations and describes declared upgrade settings', async () => {
  const client = new ContentHero({ apiKey: 'k', fetch: async url => new Response(JSON.stringify(String(url).endsWith('/models') ? { models } : models.find(m => String(url).endsWith(m.modelId)))) })
  assert.deepEqual(await client.listModels(), models)
  for (const model of models) {
    assert.deepEqual(await client.getModel(model.modelId), model)
    const text = describeInputRules(model.capabilities).join('\n')
    if (model.capabilities.draftUpgrade) {
      assert.match(text, /resolution when enabled: 480p/)
      assert.match(text, /draft upgrade: 1080p; available for 604800s/)
    } else assert.match(text, /inputs: singleVideo, singleAudio, voiceId/)
  }
})
