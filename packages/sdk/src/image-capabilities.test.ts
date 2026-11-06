import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ContentHero } from './client.js'
import { describeInputRules } from './describe.js'
import type { ModelInfo } from './types.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/gpt-image-2-6.json', import.meta.url), 'utf8'))
const models: ModelInfo[] = fixture.models.map((m: object) => ({ displayName: 'Image', contentType: 'image', kind: 'generate', description: null, brandColor: null, iconKey: null, tags: [], ...m }))

test('discovery preserves the app capability declarations on list and get', async () => {
  const client = new ContentHero({ apiKey: 'k', fetch: async url => new Response(JSON.stringify(String(url).endsWith('/models') ? { models } : models[0])) })
  assert.deepEqual(await client.listModels(), models)
  assert.deepEqual(await client.getModel(models[0].modelId), models[0])
})

test('shared discovery wording includes every declared image control and rule', () => {
  for (const model of models) {
    const c = model.capabilities
    const text = describeInputRules(c).join('\n')
    for (const key of ['outputFormat', 'background'] as const) {
      for (const value of c[key]!.supported) assert.ok(text.includes(value))
      assert.ok(text.includes(`default ${c[key]!.default}`))
    }
    for (const s of c.settings ?? []) {
      assert.ok(text.includes(`setting ${s.key}`))
      assert.ok(text.includes(`default ${s.default}`))
      if (s.appliesWhen === 'gif') assert.ok(text.includes('(applies to GIF output)'))
      if (s.control === 'select') {
        for (const option of s.options) assert.ok(text.includes(`${option.value} (${option.label})`))
        if (s.allowCustom) assert.ok(text.includes('custom values: allowed'))
      }
      if (s.control === 'slider') assert.ok(text.includes(`range: ${s.min} to ${s.max}; step: ${s.step}`))
    }
    assert.ok(text.includes(`formats with reference images: ${c.imageOutput!.editFormats.join(', ')}`))
    assert.ok(text.includes(`formats with transparent background: ${c.imageOutput!.transparentFormats.join(', ')}`))
    const gif = c.imageOutput!.gif!
    assert.ok(text.includes(gif.frameCountKey))
    assert.ok(text.includes(gif.frameDurationKey))
    if (gif.sheet) {
      for (const p of gif.sheet.packings) assert.ok(text.includes(`${p.min} to ${p.max} frames: ${p.columns} x ${p.rows}`))
      for (const value of [gif.sheet.maxSide, gif.sheet.maxPixels, gif.sheet.maxAspect, gif.sheet.multiple]) assert.ok(text.includes(String(value)))
    }
    if (c.modelParams) assert.ok(text.includes(JSON.stringify(c.modelParams)))
  }
})
