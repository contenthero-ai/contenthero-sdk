import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { GenerationTimeoutError, InsufficientCreditsError } from '@contenthero/sdk'
import { buildServer } from './server.js'

/** A discovery-catalog entry, in the /api/v1/models projection shape. */
function cap(modelId, contentType, kind, outputType) {
  return {
    modelId,
    displayName: modelId,
    description: null,
    contentType,
    kind,
    tags: [],
    capabilities: { kind, outputType, promptMode: 'optional' },
  }
}

/** A minimal fake of the SDK client; override any method per test. */
function fakeClient(overrides = {}) {
  return {
    getBalance: async () => ({ balance: 1234, tier: 'legend', autoTopupEnabled: true }),
    transcribe: async () => ({
      outputId: 'tr1',
      transcript: 'hello there',
      language: 'en',
      wordCount: 2,
      durationSeconds: 1.5,
    }),
    listAvatars: async () => [
      { id: 'av1', name: 'Taylan Test', imageUrl: 'https://cdn/face.png', defaultVoiceId: 'v1', isDefault: true, status: 'completed' },
    ],
    getAvatar: async (id) => ({
      id,
      name: 'Taylan Test',
      imageUrl: 'https://cdn/face.png',
      defaultVoiceId: 'v1',
      isDefault: true,
      status: 'completed',
      description: null,
      age: 'early_middle_age',
      gender: 'male',
      ethnicity: 'white',
      niche: ['Technology'],
      createdAt: 't',
      looks: [{ id: 'lk1', name: 'Default', imageUrl: 'https://cdn/look.png', lookType: 'default', isDefault: true }],
    }),
    listVoices: async () => [
      { voiceId: 'v1', name: "Taylan's Voice", provider: 'elevenlabs', isFavorited: true, previewUrl: 'https://cdn/p.mp3', lastUsedAt: 't' },
    ],
    getVoice: async (voiceId) => ({
      voiceId,
      name: "Taylan's Voice",
      provider: 'elevenlabs',
      isFavorited: true,
      previewUrl: 'https://cdn/p.mp3',
      lastUsedAt: 't',
      accent: 'en-american',
      language: 'en',
      gender: null,
      age: null,
      description: 'Shure SM7B',
      useCase: null,
    }),
    listMedia: async () => [
      { id: 'out-uuid-1', type: 'image', model: 'nano-banana-2', prompt: 'a cat', status: 'completed', createdAt: 't', variationCount: 2, urls: ['https://cdn/1.png', 'https://cdn/2.png'] },
    ],
    getMedia: async (id) => ({
      id: 'out-uuid-1',
      type: 'image',
      model: 'nano-banana-2',
      prompt: 'a cat',
      status: 'completed',
      createdAt: 't',
      variationCount: 2,
      urls: ['https://cdn/1.png', 'https://cdn/2.png'],
      script: null,
      aspectRatio: '1:1',
      resolution: '2K',
      duration: null,
      creditsUsed: 9,
      variations: [
        { variation: 1, url: 'https://cdn/1.png', status: 'completed', isFavorited: false },
        { variation: 2, url: 'https://cdn/2.png', status: 'completed', isFavorited: true },
      ],
      selectedVariation: id.includes('-2') ? 2 : null,
    }),
    listBrandKits: async () => [
      { id: 'bk1', name: 'ContentHero', businessName: 'Content Hero', nicheDefinition: 'AI content', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't' },
    ],
    getBrandKit: async (id) => ({
      id,
      name: 'ContentHero',
      businessName: 'Content Hero',
      nicheDefinition: 'AI content',
      isDefault: true,
      isActive: true,
      isFavorited: false,
      isArchived: false,
      createdAt: 't',
      websiteUrl: 'https://contenthero.ai',
      sourceType: 'manual',
      primaryOffer: 'AI content studio',
      positioning: { tagline: 'make content' },
      audience: null,
      voiceProfile: { tone: 'confident' },
      logos: [],
      brandColors: [{ hex: '#0B0B0F' }],
      typography: null,
      visualStyle: 'obsidian/gold',
      designPrinciples: ['bold'],
      socialAccounts: [],
      contentStrategy: null,
      assets: [],
      sections: [{ tab: 'voice', sectionName: 'Brand Voice', sortOrder: 0, fields: [{ key: 'tone', label: 'Tone', type: 'text', value: 'confident' }] }],
      brandAccounts: [{ platform: 'instagram', name: 'ContentHero', handle: 'contenthero', avatarUrl: null, followerCount: 100 }],
      inspirationAccounts: [],
      knowledge: [{ id: 'kn1', title: 'Origin', sourceType: 'note', sourceUrl: null, contentPreview: 'We started...' }],
    }),
    generate: async () => ({ outputId: 'aud1', status: 'completed', outputUrls: ['https://cdn/a.mp3'] }),
    generateAndWait: async () => ({
      outputId: 'gen1',
      status: 'completed',
      contentType: 'image',
      modelId: 'nano-banana-2',
      outputUrls: ['https://cdn/x.png'],
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    getGeneration: async () => ({
      outputId: 'gen1',
      status: 'completed',
      contentType: 'video',
      modelId: 'veo-3.1-fast',
      outputUrls: ['https://cdn/v.mp4'],
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    waitForGeneration: async () => ({
      outputId: 'gen1',
      status: 'completed',
      contentType: 'video',
      modelId: 'veo-3.1-fast',
      outputUrls: ['https://cdn/v.mp4'],
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    generateBoardAndWait: async () => ({
      outputId: 'board1',
      status: 'completed',
      contentType: 'image',
      modelId: 'gpt-image-2',
      outputUrls: ['https://cdn/board.png'],
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    estimateCost: async () => ({ getCost: true, creditsEstimate: 7, modelId: 'nano-banana-2', contentType: 'image' }),
    estimateBoardCost: async () => ({ getCost: true, creditsEstimate: 6, contentType: 'image' }),
    // Discovery catalog the dynamic enums are built from. Includes a sentinel
    // image model (only here, not in the static fallback) and entries that must
    // be filtered out: an upscaler (kind) and transcribe/voice (outputType/kind).
    listModels: async () => [
      cap('nano-banana-2', 'image', 'generate', 'image'),
      cap('gpt-image-2', 'image', 'generate', 'image'),
      cap('sentinel-image-model', 'image', 'generate', 'image'),
      cap('topaz-image-upscale', 'image', 'upscale', 'image'),
      cap('topaz-video-upscale', 'video', 'upscale', 'video'),
      cap('veo-3.1-fast', 'video', 'generate', 'video'),
      cap('infinitalk', 'video', 'lip-sync', 'video'),
      cap('elevenlabs-tts', 'audio', 'generate', 'audio'),
      cap('elevenlabs-music', 'audio', 'generate', 'audio'),
      cap('elevenlabs-sound-effects', 'audio', 'generate', 'audio'),
      cap('elevenlabs-transcribe', 'audio', 'generate', 'text'),
      cap('elevenlabs-voice-changer', 'audio', 'voice', 'audio'),
    ],
    ...overrides,
  }
}

async function connect(client) {
  const server = await buildServer({ getClient: () => client })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)])
  return mcp
}

test('advertises exactly the v1 tools', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'generate_audio',
    'generate_board',
    'generate_image',
    'generate_lip_sync',
    'generate_video',
    'get_avatar',
    'get_balance',
    'get_brand_kit',
    'get_generation_status',
    'get_media',
    'get_voice',
    'list_avatars',
    'list_brand_kits',
    'list_media',
    'list_voices',
    'transcribe',
    'upscale',
    'wait_for_generation',
  ])
})

test('get_balance formats balance, tier, and top-up state', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_balance', arguments: {} })
  const out = res.content[0].text
  assert.match(out, /1234 credits/)
  assert.match(out, /legend/)
  assert.match(out, /auto top-up: on/)
})

test('generate_image returns the image URLs on completion', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'nano-banana-2', prompt: 'a cat' },
  })
  assert.match(res.content[0].text, /https:\/\/cdn\/x\.png/)
  assert.ok(!res.isError)
})

test('generate_video surfaces a smart-wait timeout as a pollable pending result', async () => {
  const mcp = await connect(
    fakeClient({
      generateAndWait: async () => {
        throw new GenerationTimeoutError('pending-99')
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_video',
    arguments: { modelId: 'veo-3.1-fast', prompt: 'a city at dusk' },
  })
  assert.match(res.content[0].text, /pending-99/)
  assert.match(res.content[0].text, /get_generation_status/)
  assert.ok(!res.isError)
})

test('generate_board returns the board URL on completion', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_board',
    arguments: { boardType: 'character', prompt: 'a stoic ranger' },
  })
  assert.match(res.content[0].text, /https:\/\/cdn\/board\.png/)
  assert.ok(!res.isError)
})

test('generate_board surfaces a smart-wait timeout as a pollable pending result', async () => {
  const mcp = await connect(
    fakeClient({
      generateBoardAndWait: async () => {
        throw new GenerationTimeoutError('board-pending-7')
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_board',
    arguments: { boardType: 'creature', prompt: 'a six-headed hydra' },
  })
  assert.match(res.content[0].text, /board-pending-7/)
  assert.match(res.content[0].text, /get_generation_status/)
  assert.ok(!res.isError)
})

test('generate_board rejects an unknown boardType at the schema boundary', async () => {
  const mcp = await connect(
    fakeClient({
      generateBoardAndWait: async () => {
        throw new Error('handler should not be reached for an invalid boardType')
      },
    }),
  )
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'generate_board',
      arguments: { boardType: 'not-a-type', prompt: 'x' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'expected an invalid boardType to be blocked before the handler')
})

test('generate_image forwards mode via the parameters passthrough', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generateAndWait: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'completed', contentType: 'image', modelId: 'gpt-image-2',
          outputUrls: ['https://cdn/x.png'], error: null, createdAt: 't', completedAt: 't2',
        }
      },
    }),
  )
  // Forwarding is model-agnostic (the server validates mode per model); use a
  // catalog model so the enum boundary lets the handler run.
  await mcp.callTool({ name: 'generate_image', arguments: { modelId: 'gpt-image-2', prompt: 'x', mode: 'flex' } })
  assert.equal(captured.parameters?.mode, 'flex')
})

test('generate_video forwards wan multiShot and reference audio', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generateAndWait: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'completed', contentType: 'video', modelId: 'veo-3.1-fast',
          outputUrls: ['https://cdn/v.mp4'], error: null, createdAt: 't', completedAt: 't2',
        }
      },
    }),
  )
  // Forwarding is model-agnostic; veo-3.1-fast is in the fake catalog so the
  // handler runs (multiShot/referenceAudio are validated per model server-side).
  await mcp.callTool({
    name: 'generate_video',
    arguments: { modelId: 'veo-3.1-fast', prompt: 'x', multiShot: true, referenceAudio: ['https://cdn/a.mp3'] },
  })
  assert.equal(captured.parameters?.multiShot, true)
  assert.deepEqual(captured.references?.audio, ['https://cdn/a.mp3'])
})

test('list_media forwards the kind filter', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listMedia: async (opts) => {
        captured = opts
        return []
      },
    }),
  )
  await mcp.callTool({ name: 'list_media', arguments: { kind: 'board' } })
  assert.equal(captured.kind, 'board')
})

test('generate_audio returns the audio URL synchronously', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_audio',
    arguments: { modelId: 'elevenlabs-tts', text: 'hello', voiceId: 'v1' },
  })
  assert.match(res.content[0].text, /https:\/\/cdn\/a\.mp3/)
})

test('insufficient credits comes back as an isError result with detail', async () => {
  const mcp = await connect(
    fakeClient({
      generateAndWait: async () => {
        throw new InsufficientCreditsError('Insufficient credits', { balance: 2, required: 10 })
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'nano-banana-2', prompt: 'x' },
  })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /need 10/)
  assert.match(res.content[0].text, /have 2/)
})

test('rejects an unknown model at the schema boundary', async () => {
  // A video model on the image tool must never reach the client. Depending on
  // SDK version this surfaces as a rejected promise or an isError result; both
  // mean the enum guardrail held and the handler was not invoked.
  const mcp = await connect(
    fakeClient({
      generateAndWait: async () => {
        throw new Error('handler should not be reached for an invalid modelId')
      },
    }),
  )
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'generate_image',
      arguments: { modelId: 'veo-3.1-fast', prompt: 'x' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'expected an invalid modelId to be blocked before the handler')
})

test('get_generation_status reports completed URLs', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_generation_status', arguments: { outputId: 'gen1' } })
  assert.match(res.content[0].text, /https:\/\/cdn\/v\.mp4/)
})

test('wait_for_generation returns completed URLs (blocking, default)', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'wait_for_generation', arguments: { outputIds: ['gen1'] } })
  assert.match(res.content[0].text, /https:\/\/cdn\/v\.mp4/)
  assert.ok(!res.isError)
})

test('wait_for_generation snapshots without blocking when wait=false', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'wait_for_generation',
    arguments: { outputIds: ['gen1'], wait: false },
  })
  assert.match(res.content[0].text, /https:\/\/cdn\/v\.mp4/)
})

test('generate_image get_cost returns an estimate without generating', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'nano-banana-2', prompt: 'a cat', getCost: true },
  })
  assert.match(res.content[0].text, /7 credits/)
  assert.match(res.content[0].text, /nothing was charged/)
  assert.ok(!res.isError)
})

test('generate_board get_cost returns an estimate', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_board',
    arguments: { boardType: 'character', prompt: 'a stoic ranger', getCost: true },
  })
  assert.match(res.content[0].text, /6 credits/)
  assert.ok(!res.isError)
})

test('generate_image accepts a model that exists only in the discovery catalog (dynamic enum)', async () => {
  // sentinel-image-model is not in any static fallback list; it reaches the
  // handler only because the enum was built from listModels.
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'sentinel-image-model', prompt: 'x' },
  })
  assert.ok(!res.isError, 'a discovery-only model should be accepted')
})

test('generate_image rejects an upscale model (kind filter)', async () => {
  const mcp = await connect(fakeClient())
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'generate_image',
      arguments: { modelId: 'topaz-image-upscale', prompt: 'x' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'an upscale model must not be selectable on generate_image')
})

test('upscale accepts an upscale model and returns the result', async () => {
  // topaz-image-upscale is kind=upscale, so it is absent from generate_image but
  // present on the dedicated upscale tool, which routes the source by contentType.
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'upscale',
    arguments: { modelId: 'topaz-image-upscale', sourceUrl: 'https://cdn/in.png', factor: '2x' },
  })
  assert.ok(!res.isError, 'a valid upscale call should succeed')
  assert.match(res.content[0].text, /https:\/\/cdn\/x\.png/)
})

test('upscale rejects a non-upscale model (enum filter)', async () => {
  const mcp = await connect(fakeClient())
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'upscale',
      arguments: { modelId: 'nano-banana-2', sourceUrl: 'https://cdn/in.png', factor: '2x' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'a generate model must not be selectable on the upscale tool')
})

test('generate_lip_sync (script mode) builds a portrait + script request and returns the video', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generateAndWait: async (request) => {
        captured = request
        return {
          outputId: 'ls1',
          status: 'completed',
          contentType: 'video',
          modelId: 'infinitalk',
          outputUrls: ['https://cdn/talk.mp4'],
          error: null,
          createdAt: 't',
          completedAt: 't2',
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_lip_sync',
    arguments: {
      modelId: 'infinitalk',
      imageUrl: 'https://cdn/face.png',
      script: 'hello world',
      voiceId: 'v1',
      motionPrompt: 'subtle smile',
      resolution: '720p',
    },
  })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /https:\/\/cdn\/talk\.mp4/)
  // The portrait rides in references.images; the motion prompt in `prompt`.
  assert.deepEqual(captured.references.images, ['https://cdn/face.png'])
  assert.equal(captured.references.audio, undefined)
  assert.equal(captured.text, 'hello world')
  assert.equal(captured.voiceId, 'v1')
  assert.equal(captured.prompt, 'subtle smile')
  assert.equal(captured.resolution, '720p')
})

test('generate_lip_sync (audio mode) routes audioUrl into references.audio', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generateAndWait: async (request) => {
        captured = request
        return {
          outputId: 'ls2',
          status: 'completed',
          contentType: 'video',
          modelId: 'infinitalk',
          outputUrls: ['https://cdn/talk2.mp4'],
          error: null,
          createdAt: 't',
          completedAt: 't2',
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_lip_sync',
    arguments: {
      modelId: 'infinitalk',
      imageUrl: 'https://cdn/face.png',
      audioUrl: 'https://cdn/voice.mp3',
      audioDurationSeconds: 4.2,
    },
  })
  assert.ok(!res.isError)
  assert.deepEqual(captured.references.images, ['https://cdn/face.png'])
  assert.deepEqual(captured.references.audio, ['https://cdn/voice.mp3'])
  assert.equal(captured.text, undefined)
  assert.equal(captured.durationSeconds, 4.2)
})

test('generate_lip_sync accepts only lip-sync models (kind filter)', async () => {
  const mcp = await connect(fakeClient())
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'generate_lip_sync',
      arguments: { modelId: 'veo-3.1-fast', imageUrl: 'https://cdn/face.png', audioUrl: 'https://cdn/v.mp3' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'a generate video model must not be selectable on generate_lip_sync')
})

test('generate_video rejects a lip-sync model (kind filter)', async () => {
  const mcp = await connect(fakeClient())
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'generate_video',
      arguments: { modelId: 'infinitalk', prompt: 'x' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'a lip-sync model must not be selectable on generate_video')
})

test('list_avatars surfaces the id, base image, and default voice', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_avatars', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /Taylan Test/)
  assert.match(res.content[0].text, /av1/)
  assert.match(res.content[0].text, /https:\/\/cdn\/face\.png/)
  assert.match(res.content[0].text, /v1/)
})

test('get_avatar returns detail with looks and passes the id through', async () => {
  let capturedId
  const mcp = await connect(
    fakeClient({
      getAvatar: async (id) => {
        capturedId = id
        return {
          id,
          name: 'Taylan Test',
          imageUrl: 'https://cdn/face.png',
          defaultVoiceId: 'v1',
          isDefault: true,
          status: 'completed',
          description: null,
          age: null,
          gender: null,
          ethnicity: null,
          niche: [],
          createdAt: 't',
          looks: [{ id: 'lk1', name: 'Default', imageUrl: 'https://cdn/look.png', lookType: 'default', isDefault: true }],
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_avatar', arguments: { avatarId: 'av1' } })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'av1')
  assert.match(res.content[0].text, /https:\/\/cdn\/look\.png/)
})

test('list_voices marks favorites and exposes the voiceId + preview', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_voices', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /Taylan's Voice/)
  assert.match(res.content[0].text, /v1/)
  assert.match(res.content[0].text, /favorite/)
})

test('get_voice returns detail and passes the voiceId through', async () => {
  let capturedId
  const mcp = await connect(
    fakeClient({
      getVoice: async (voiceId) => {
        capturedId = voiceId
        return {
          voiceId,
          name: "Taylan's Voice",
          provider: 'elevenlabs',
          isFavorited: true,
          previewUrl: 'https://cdn/p.mp3',
          lastUsedAt: 't',
          accent: 'en-american',
          language: 'en',
          gender: null,
          age: null,
          description: 'Shure SM7B',
          useCase: null,
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_voice', arguments: { voiceId: 'v1' } })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'v1')
  assert.match(res.content[0].text, /en-american/)
})

test('list_media surfaces id, type, and variation count', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_media', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /out-uuid-1/)
  assert.match(res.content[0].text, /image/)
  assert.match(res.content[0].text, /2 variations/)
})

test('get_media passes the id token through and lists variations', async () => {
  let capturedId
  const mcp = await connect(
    fakeClient({
      getMedia: async (id) => {
        capturedId = id
        return {
          id: 'out-uuid-1',
          type: 'image',
          model: 'nano-banana-2',
          prompt: 'a cat',
          status: 'completed',
          createdAt: 't',
          variationCount: 2,
          urls: ['https://cdn/2.png'],
          script: null,
          aspectRatio: '1:1',
          resolution: '2K',
          duration: null,
          creditsUsed: 9,
          variations: [{ variation: 2, url: 'https://cdn/2.png', status: 'completed', isFavorited: true }],
          selectedVariation: 2,
        }
      },
    }),
  )
  // The variation-qualified token form must reach the server verbatim.
  const res = await mcp.callTool({ name: 'get_media', arguments: { id: 'abcd1234-2' } })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'abcd1234-2')
  assert.match(res.content[0].text, /variation 2/)
  assert.match(res.content[0].text, /https:\/\/cdn\/2\.png/)
})

test('list_brand_kits surfaces id, name, and default flag', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_brand_kits', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /ContentHero/)
  assert.match(res.content[0].text, /bk1/)
  assert.match(res.content[0].text, /default/)
})

test('get_brand_kit returns the whole kit as JSON and passes the id through', async () => {
  let capturedId
  const mcp = await connect(
    fakeClient({
      getBrandKit: async (id) => {
        capturedId = id
        return {
          id,
          name: 'ContentHero',
          businessName: null,
          nicheDefinition: null,
          isDefault: true,
          isActive: true,
          isFavorited: false,
          isArchived: false,
          createdAt: 't',
          websiteUrl: null,
          sourceType: null,
          primaryOffer: null,
          positioning: null,
          audience: null,
          voiceProfile: { tone: 'confident' },
          logos: [],
          brandColors: [],
          typography: null,
          visualStyle: null,
          designPrinciples: [],
          socialAccounts: [],
          contentStrategy: null,
          assets: [],
          sections: [],
          brandAccounts: [],
          inspirationAccounts: [],
          knowledge: [],
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_brand_kit', arguments: { brandKitId: 'bk1' } })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'bk1')
  // The full kit comes back as JSON, so nested brand context is intact.
  assert.match(res.content[0].text, /"voiceProfile"/)
  assert.match(res.content[0].text, /confident/)
})

test('transcribe returns the transcript text', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      transcribe: async (req) => {
        captured = req
        return { outputId: 'tr9', transcript: 'the quick brown fox', language: 'en', wordCount: 4, durationSeconds: 2.1 }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'transcribe',
    arguments: { audioUrl: 'https://cdn/clip.mp3', languageCode: 'en' },
  })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /the quick brown fox/)
  assert.match(res.content[0].text, /4 words/)
  assert.equal(captured.audioUrl, 'https://cdn/clip.mp3')
  assert.equal(captured.languageCode, 'en')
})

test('generate_audio rejects transcribe (outputType filter)', async () => {
  const mcp = await connect(fakeClient())
  let blocked = false
  try {
    const res = await mcp.callTool({
      name: 'generate_audio',
      arguments: { modelId: 'elevenlabs-transcribe', text: 'x' },
    })
    blocked = res.isError === true
  } catch {
    blocked = true
  }
  assert.ok(blocked, 'transcribe (text output) must not be selectable on generate_audio')
})
