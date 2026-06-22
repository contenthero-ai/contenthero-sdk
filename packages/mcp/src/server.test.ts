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
    getModel: async (modelId) => ({
      modelId,
      displayName: 'Veo 3.1 Fast',
      description: 'fast text+image to video',
      contentType: 'video',
      kind: 'generate',
      tags: ['fast'],
      isDefault: true,
      capabilities: {
        kind: 'generate',
        outputType: 'video',
        promptMode: 'required',
        promptMaxChars: 1500,
        inputTypes: ['text', 'startFrame'],
        resolution: { supported: ['720p', '1080p'], default: '720p' },
        aspectRatio: { supported: ['16:9', '9:16'], default: '16:9' },
        duration: { mode: 'discrete', options: [4, 6, 8], default: 8 },
        audio: { supported: true, alwaysOn: true },
        maxImageRefs: 1,
        generations: { min: 1, max: 4, default: 1 },
        features: { recreate: true, edit: false },
      },
      promptReferences: {
        scheme: 'descriptive',
        honored: true,
        inputs: [{ for: 'image', token: null, max: 3 }],
        instruction: 'Describe each reference by its role or content in the prompt.',
      },
    }),
    listPosts: async () => ({
      posts: [
        { id: 'p1', title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', pipelineStageId: 'st1', pipelineOrder: 0, contentType: null, coverUrl: null, isFavorite: false, folderId: null, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: ['instagram'] },
      ],
      total: 1,
      hasMore: false,
    }),
    getPost: async (id) => ({
      id,
      title: 'Launch clip',
      description: 'a clip',
      platform: 'instagram',
      status: 'draft',
      pipelineStageId: 'st1',
      pipelineOrder: 0,
      contentType: null,
      coverUrl: null,
      isFavorite: false,
      folderId: null,
      scheduledAt: null,
      publishedAt: null,
      publishUrl: null,
      createdAt: 't',
      updatedAt: 't',
      platforms: ['instagram'],
      script: null,
      notes: null,
      metadata: null,
      assets: [{ id: 'as1', assetType: 'image', assetId: null, assetUrl: 'https://cdn/a.png', displayName: null, sortOrder: 0 }],
      destinations: [{ id: 'd1', connectedAccountId: 'ca1', platform: 'instagram', format: 'reel', status: 'draft', scheduledAt: null, publishedAt: null }],
    }),
    createPost: async (input) => ({ id: 'p-new', title: input.title, description: input.description ?? null, platform: input.platform, status: input.status ?? 'draft', pipelineStageId: 'st1', pipelineOrder: 0, contentType: null, coverUrl: null, isFavorite: false, folderId: null, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    updatePost: async (id, input) => ({ id, title: input.title ?? 'Launch clip', description: null, platform: 'instagram', status: input.status ?? 'draft', pipelineStageId: 'st1', pipelineOrder: 0, contentType: null, coverUrl: null, isFavorite: false, folderId: null, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    archivePost: async (id) => ({ id, title: 'Launch clip', description: null, platform: 'instagram', status: 'archived', pipelineStageId: 'st1', pipelineOrder: 0, contentType: null, coverUrl: null, isFavorite: false, folderId: null, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    listPipelineStages: async () => [
      { id: 'st1', name: 'Ideation', slug: 'ideation', color: '#8B5CF6', sortOrder: 0, isDefault: true },
      { id: 'st2', name: 'Published', slug: 'published', color: '#10B981', sortOrder: 5, isDefault: true },
    ],
    addPostDestination: async (_postId, input) => ({ id: 'd-new', connectedAccountId: input.connectedAccountId ?? null, platform: input.platform, format: input.format ?? 'post', status: 'draft', scheduledAt: null, publishedAt: null }),
    updatePostDestination: async (_postId, destinationId, input) => ({ id: destinationId, connectedAccountId: input.connectedAccountId ?? 'ca1', platform: 'instagram', format: input.format ?? 'reel', status: input.status ?? 'draft', scheduledAt: null, publishedAt: null }),
    addPostAsset: async (_postId, input) => ({ id: 'as-new', assetType: input.assetType, assetId: null, assetUrl: input.assetUrl, displayName: input.displayName ?? null, sortOrder: 1 }),
    schedulePost: async (id) => ({ id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', pipelineStageId: 'st1', pipelineOrder: 0, contentType: null, coverUrl: null, isFavorite: false, folderId: null, scheduledAt: '2026-07-01T00:00:00Z', publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    publishPost: async (postId) => ({ postId, results: [{ success: true, platform: 'instagram', destinationId: 'd1', url: 'https://instagram.com/p/x' }], publishedCount: 1, failedCount: 0 }),
    listInspirationAccounts: async () => [
      { id: 'ia1', platform: 'youtube', accountId: 'UC123', handle: 'mrbeast', name: 'MrBeast', avatarUrl: null, followerCount: 300_000_000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'inspiration' },
    ],
    getInspirationAccount: async (id) => ({
      account: { id, platform: 'youtube', accountId: 'UC123', handle: 'mrbeast', name: 'MrBeast', avatarUrl: null, followerCount: 300_000_000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'inspiration' },
      contentCount: 42,
      topContent: [{ id: 'c1', platform: 'youtube', contentType: 'video', title: 'I gave away an island', url: 'https://yt/c1', thumbnailUrl: null, viewCount: 120_000_000, likeCount: 4_000_000, commentCount: 90_000, shareCount: null, durationSeconds: 600, outlierScore: 3.4, engagementRate: 0.05, viewsPerFollower: 0.4, publishedAt: 't', sourceCreator: 'MrBeast', accountHandle: 'mrbeast' }],
    }),
    listOutliers: async () => ({
      outliers: [{ id: 'c1', platform: 'youtube', contentType: 'video', title: 'I gave away an island', url: 'https://yt/c1', thumbnailUrl: null, viewCount: 120_000_000, likeCount: 4_000_000, commentCount: 90_000, shareCount: null, durationSeconds: 600, outlierScore: 3.4, engagementRate: 0.05, viewsPerFollower: 0.4, publishedAt: 't', sourceCreator: 'MrBeast', accountHandle: 'mrbeast' }],
      total: 1,
      hasMore: false,
    }),
    getInspirationContent: async (id) => ({
      id, platform: 'youtube', contentType: 'video', title: 'I gave away an island', url: 'https://yt/c1', thumbnailUrl: null, viewCount: 120_000_000, likeCount: 4_000_000, commentCount: 90_000, shareCount: null, durationSeconds: 600, outlierScore: 3.4, engagementRate: 0.05, viewsPerFollower: 0.4, publishedAt: 't', sourceCreator: 'MrBeast', accountHandle: 'mrbeast',
      description: 'a video', transcript: 'today I gave away an island', hashtags: ['#mrbeast'], keywords: ['island'], mentions: [], audioInfo: null, followerCountSnapshot: 300_000_000,
    }),
    listBrandAccounts: async () => [
      { id: 'ba1', platform: 'instagram', accountId: '17841400000', handle: 'contenthero', name: 'ContentHero', avatarUrl: null, followerCount: 12000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'brand' },
    ],
    getBrandAccountPerformance: async (id) => ({
      account: { id, platform: 'instagram', accountId: '17841400000', handle: 'contenthero', name: 'ContentHero', avatarUrl: null, followerCount: 12000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'brand' },
      contentCount: 50,
      totals: { views: 1_000_000, likes: 50_000, comments: 5_000 },
      averages: { views: 20_000, engagementRate: 0.055, outlierScore: 1.2 },
      topContent: [{ id: 'bc1', platform: 'instagram', contentType: 'reel', title: 'best reel', url: 'https://ig/bc1', thumbnailUrl: null, viewCount: 200_000, likeCount: 12_000, commentCount: 800, shareCount: 400, durationSeconds: 30, outlierScore: 2.1, engagementRate: 0.07, viewsPerFollower: 16, publishedAt: 't', sourceCreator: null, accountHandle: 'contenthero' }],
      recentContent: [],
    }),
    updateBrandKit: async (id, input) => ({ id, name: input.name ?? 'ContentHero', businessName: 'Content Hero', nicheDefinition: 'AI content', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }),
    archiveBrandKit: async (id) => ({ id, name: 'ContentHero', businessName: 'Content Hero', nicheDefinition: 'AI content', isDefault: false, isActive: true, isFavorited: false, isArchived: true, createdAt: 't' }),
    addBrandKitSection: async (_id, input) => ({ id: 'sec-new', tab: input.tab, sectionName: input.sectionName, sortOrder: input.sortOrder ?? 99, fields: input.fields ?? [] }),
    updateBrandKitSection: async (_id, sectionId, input) => ({ id: sectionId, tab: 'voice', sectionName: input.sectionName ?? 'Brand Voice', sortOrder: input.sortOrder ?? 0, fields: input.fields ?? [] }),
    archiveBrandKitSection: async (_id, sectionId) => ({ id: sectionId, tab: 'voice', sectionName: 'Brand Voice', sortOrder: 0, fields: [] }),
    listBrandKnowledge: async () => ({
      items: [{ id: 'kn1', title: 'Launch playbook', sourceType: 'text', sourceUrl: null, createdAt: 't', updatedAt: 't' }],
      total: 1,
      hasMore: false,
    }),
    getBrandKnowledge: async (_id, knowledgeId) => ({ id: knowledgeId, title: 'Launch playbook', sourceType: 'text', sourceUrl: null, createdAt: 't', updatedAt: 't', content: 'Lead with the customer outcome.' }),
    searchBrandKnowledge: async (_id, query) => [{ knowledgeId: 'kn1', title: 'Launch playbook', content: `match for ${query}`, similarity: 0.82, sourceUrl: null, chunkIndex: 0 }],
    addBrandKnowledge: async (_id, input) => ({ id: 'kn-new', title: input.title ?? 'Untitled Resource', sourceType: input.sourceType, sourceUrl: input.url ?? null, createdAt: 't', updatedAt: 't' }),
    removeBrandKnowledge: async (_id, knowledgeId) => ({ id: knowledgeId }),
    listConnectedAccounts: async () => [
      { id: 'ca1', platform: 'instagram', accountId: '178414', accountName: 'ContentHero', accountHandle: 'contenthero', accountUrl: 'https://instagram.com/contenthero', connectionStatus: 'connected', connectionType: 'oauth', capabilities: { publish: true, analytics: true }, isDefault: true, lastSyncedAt: 't', lastValidatedAt: 't', createdAt: 't' },
    ],
    getConnectedAccount: async (id) => ({ id, platform: 'instagram', accountId: '178414', accountName: 'ContentHero', accountHandle: 'contenthero', accountUrl: 'https://instagram.com/contenthero', connectionStatus: 'connected', connectionType: 'oauth', capabilities: { publish: true, analytics: false }, isDefault: true, lastSyncedAt: 't', lastValidatedAt: 't', createdAt: 't' }),
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
    'add_brand_kit_section',
    'add_brand_knowledge',
    'add_post_asset',
    'add_post_destination',
    'archive_brand_kit',
    'archive_brand_kit_section',
    'archive_post',
    'create_post',
    'generate_audio',
    'generate_board',
    'generate_image',
    'generate_lip_sync',
    'generate_video',
    'get_avatar',
    'get_balance',
    'get_brand_account_performance',
    'get_brand_kit',
    'get_brand_knowledge',
    'get_connected_account',
    'get_generation_status',
    'get_inspiration_account',
    'get_inspiration_content',
    'get_media',
    'get_model',
    'get_post',
    'get_voice',
    'list_avatars',
    'list_brand_accounts',
    'list_brand_kits',
    'list_brand_knowledge',
    'list_connected_accounts',
    'list_inspiration_accounts',
    'list_media',
    'list_models',
    'list_outliers',
    'list_pipeline_stages',
    'list_posts',
    'list_voices',
    'publish_post',
    'remove_brand_knowledge',
    'schedule_post',
    'search_brand_knowledge',
    'transcribe',
    'update_brand_kit',
    'update_brand_kit_section',
    'update_post',
    'update_post_destination',
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

test('list_models surfaces ids, content type, and a capability summary', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_models', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /nano-banana-2/)
  assert.match(res.content[0].text, /veo-3\.1-fast/)
  // Compact summary fields rendered for the video model (audio, refs, etc.).
  assert.match(res.content[0].text, /\[video\]/)
  // Points the agent to get_model for grounding.
  assert.match(res.content[0].text, /get_model/)
})

test('list_models forwards the contentType filter', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listModels: async (opts) => {
        captured = opts
        return [cap('veo-3.1-fast', 'video', 'generate', 'video')]
      },
    }),
  )
  await mcp.callTool({ name: 'list_models', arguments: { contentType: 'video' } })
  assert.deepEqual(captured, { contentType: 'video' })
})

test('get_model passes the id through and renders the full request shape', async () => {
  let capturedId
  const mcp = await connect(
    fakeClient({
      getModel: async (modelId) => {
        capturedId = modelId
        return {
          modelId,
          displayName: 'Veo 3.1 Fast',
          description: 'fast text+image to video',
          contentType: 'video',
          kind: 'generate',
          tags: ['fast'],
          isDefault: true,
          capabilities: {
            kind: 'generate',
            outputType: 'video',
            promptMode: 'required',
            promptMaxChars: 1500,
            inputTypes: ['text', 'startFrame', 'imageRef', 'videoRef'],
            resolution: { supported: ['720p', '1080p'], default: '720p' },
            aspectRatio: { supported: ['16:9', '9:16'], default: '16:9' },
            duration: { mode: 'discrete', options: [4, 6, 8], default: 8 },
            audio: { supported: true, alwaysOn: true },
            maxImageRefs: 1,
            generations: { min: 1, max: 4, default: 1 },
            features: { recreate: true, edit: false },
          },
          promptReferences: {
            scheme: 'numbered_tag',
            honored: true,
            inputs: [
              { for: 'image', token: '@Image{n}', max: 9 },
              { for: 'video', token: '@Video{n}', max: 3 },
            ],
            instruction: 'Tag each reference in the prompt by order (@Image{n}, @Video{n}). This model binds the tags to the references.',
          },
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_model', arguments: { modelId: 'veo-3.1-fast' } })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'veo-3.1-fast')
  assert.match(res.content[0].text, /required \(max 1500 chars\)/)
  assert.match(res.content[0].text, /4s\|6s\|8s/)
  assert.match(res.content[0].text, /720p, 1080p/)
  assert.match(res.content[0].text, /audio: supported \(always on\)/)
  // Only enabled features are listed (recreate on, edit off).
  assert.match(res.content[0].text, /features: recreate/)
  // Reference-addressing guidance is rendered.
  assert.match(res.content[0].text, /Referencing \(numbered_tag, bound\)/)
  assert.match(res.content[0].text, /@Image\{n\} \(up to 9\)/)
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

// -- posts (content pipeline) -------------------------------------------------

test('list_posts surfaces id, status, and platform with pagination context', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_posts', arguments: {} })
  assert.match(res.content[0].text, /Launch clip \(id p1\)/)
  assert.match(res.content[0].text, /draft/)
  assert.ok(!res.isError)
})

test('get_post returns the post with its destinations and assets', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_post', arguments: { postId: 'p1' } })
  assert.match(res.content[0].text, /destinations \(1\)/)
  assert.match(res.content[0].text, /instagram \(id d1\)/)
  assert.match(res.content[0].text, /assets \(1\)/)
})

test('create_post passes the title/platform/stage through and returns the new id', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      createPost: async (input) => {
        captured = input
        return { id: 'p-new', title: input.title, description: null, platform: input.platform, status: 'draft', pipelineStageId: 'st1', pipelineOrder: 0, contentType: null, coverUrl: null, isFavorite: false, folderId: null, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'create_post',
    arguments: { title: 'Launch clip', platform: 'instagram', stage: 'ideation' },
  })
  assert.equal(captured.title, 'Launch clip')
  assert.equal(captured.platform, 'instagram')
  assert.equal(captured.stage, 'ideation')
  assert.match(res.content[0].text, /Created: Launch clip \(id p-new\)/)
})

test('list_pipeline_stages lists stages with id and slug for resolution', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_pipeline_stages', arguments: {} })
  assert.match(res.content[0].text, /Ideation \(id st1, slug ideation\)/)
  assert.match(res.content[0].text, /Published \(id st2, slug published\)/)
})

test('archive_post sets the status to archived', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'archive_post', arguments: { postId: 'p1' } })
  assert.match(res.content[0].text, /Archived: .* \| archived/)
})

test('add_post_destination passes platform + connected account through', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      addPostDestination: async (_postId, input) => {
        captured = input
        return { id: 'd-new', connectedAccountId: input.connectedAccountId ?? null, platform: input.platform, format: input.format ?? 'post', status: 'draft', scheduledAt: null, publishedAt: null }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'add_post_destination',
    arguments: { postId: 'p1', platform: 'youtube', format: 'short', connectedAccountId: 'ca9' },
  })
  assert.equal(captured.platform, 'youtube')
  assert.equal(captured.connectedAccountId, 'ca9')
  assert.match(res.content[0].text, /youtube \(id d-new\)/)
})

test('schedule_post sets the scheduled time', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'schedule_post',
    arguments: { postId: 'p1', scheduledAt: '2026-07-01T00:00:00Z' },
  })
  assert.match(res.content[0].text, /Scheduled:/)
})

test('publish_post reports per-destination results', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'publish_post', arguments: { postId: 'p1' } })
  assert.match(res.content[0].text, /Published 1\/1 destination/)
  assert.match(res.content[0].text, /instagram: published/)
  assert.ok(!res.isError)
})

test('publish_post flags a total failure as an error result', async () => {
  const mcp = await connect(
    fakeClient({
      publishPost: async (postId) => ({ postId, results: [{ success: false, platform: 'instagram', destinationId: 'd1', error: 'token expired' }], publishedCount: 0, failedCount: 1 }),
    }),
  )
  const res = await mcp.callTool({ name: 'publish_post', arguments: { postId: 'p1' } })
  assert.match(res.content[0].text, /token expired/)
  assert.ok(res.isError, 'a 0-published publish should be an error result')
})

// -- inspiration / research ---------------------------------------------------

test('list_inspiration_accounts surfaces handle, platform, and followers', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_inspiration_accounts', arguments: {} })
  assert.match(res.content[0].text, /@mrbeast \(id ia1\)/)
  assert.match(res.content[0].text, /300\.0M followers/)
})

test('list_outliers ranks content by score with views', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_outliers', arguments: { minOutlierScore: 2 } })
  assert.match(res.content[0].text, /\[3\.4x\] I gave away an island/)
  assert.match(res.content[0].text, /120\.0M views/)
})

test('list_outliers passes filters through to the client', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listOutliers: async (options) => {
        captured = options
        return { outliers: [], total: 0, hasMore: false }
      },
    }),
  )
  await mcp.callTool({ name: 'list_outliers', arguments: { platform: 'youtube', sortBy: 'views', limit: 5 } })
  assert.equal(captured.platform, 'youtube')
  assert.equal(captured.sortBy, 'views')
  assert.equal(captured.limit, 5)
})

test('get_inspiration_content includes the transcript', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_inspiration_content', arguments: { contentId: 'c1' } })
  assert.match(res.content[0].text, /transcript:/)
  assert.match(res.content[0].text, /today I gave away an island/)
})

test('list_brand_accounts lists the owner own accounts', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_brand_accounts', arguments: {} })
  assert.match(res.content[0].text, /@contenthero \(id ba1\)/)
})

test('get_brand_account_performance reports totals and averages', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_brand_account_performance', arguments: { accountId: 'ba1' } })
  assert.match(res.content[0].text, /content tracked: 50/)
  assert.match(res.content[0].text, /1\.0M views/)
  assert.match(res.content[0].text, /5\.5% engagement/)
})

// -- brand-kit writes ---------------------------------------------------------

test('update_brand_kit passes the changed fields through and returns the kit', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = { id, input }
        return { id, name: input.name ?? 'ContentHero', businessName: null, nicheDefinition: null, isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'update_brand_kit',
    arguments: { brandKitId: 'bk1', voiceProfile: { tone: 'bold' }, nicheDefinition: 'AI video' },
  })
  assert.equal(captured.id, 'bk1')
  assert.deepEqual(captured.input.voiceProfile, { tone: 'bold' })
  assert.equal(captured.input.nicheDefinition, 'AI video')
  assert.match(res.content[0].text, /Brand kit "ContentHero"/)
})

test('archive_brand_kit confirms the archive', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'archive_brand_kit', arguments: { brandKitId: 'bk1' } })
  assert.match(res.content[0].text, /Archived brand kit "ContentHero" \(id bk1\)/)
})

test('add_brand_kit_section creates a section with tab + name', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      addBrandKitSection: async (id, input) => {
        captured = { id, input }
        return { id: 'sec-new', tab: input.tab, sectionName: input.sectionName, sortOrder: 99, fields: input.fields ?? [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'add_brand_kit_section',
    arguments: { brandKitId: 'bk1', tab: 'voice', sectionName: 'Catchphrases', fields: [{ key: 'a', value: 'b' }] },
  })
  assert.equal(captured.input.tab, 'voice')
  assert.equal(captured.input.sectionName, 'Catchphrases')
  assert.match(res.content[0].text, /Added section: "Catchphrases" in tab "voice" \(id sec-new\)/)
  assert.match(res.content[0].text, /1 field/)
})

test('archive_brand_kit_section soft-deletes the section', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'archive_brand_kit_section',
    arguments: { brandKitId: 'bk1', sectionId: 'sec9' },
  })
  assert.match(res.content[0].text, /Archived section: .* \(id sec9\)/)
})

// -- brand knowledge ----------------------------------------------------------

test('search_brand_knowledge returns ranked matches', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'search_brand_knowledge',
    arguments: { brandKitId: 'bk1', query: 'launch tone' },
  })
  assert.match(res.content[0].text, /1 match/)
  assert.match(res.content[0].text, /Launch playbook/)
  assert.match(res.content[0].text, /score 0\.820/)
})

test('list_brand_knowledge lists items with ids', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_brand_knowledge', arguments: { brandKitId: 'bk1' } })
  assert.match(res.content[0].text, /1 knowledge item/)
  assert.match(res.content[0].text, /id kn1/)
})

test('get_brand_knowledge returns the stored body', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_brand_knowledge', arguments: { brandKitId: 'bk1', knowledgeId: 'kn1' } })
  assert.match(res.content[0].text, /Lead with the customer outcome/)
})

test('add_brand_knowledge ingests a text note', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      addBrandKnowledge: async (id, input) => {
        captured = { id, input }
        return { id: 'kn-new', title: input.title ?? 'Note', sourceType: input.sourceType, sourceUrl: null, createdAt: 't', updatedAt: 't' }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'add_brand_knowledge',
    arguments: { brandKitId: 'bk1', sourceType: 'text', text: 'Always credit the customer.', title: 'Tone rule' },
  })
  assert.equal(captured.input.sourceType, 'text')
  assert.equal(captured.input.text, 'Always credit the customer.')
  assert.match(res.content[0].text, /Added knowledge item: "Tone rule" \[text\] \(id kn-new\)/)
})

test('remove_brand_knowledge removes by id', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'remove_brand_knowledge', arguments: { brandKitId: 'bk1', knowledgeId: 'kn9' } })
  assert.match(res.content[0].text, /Removed knowledge item: .* \(id kn9\)/)
})

test('list_outliers forwards brandKitId for brand-scoped reads', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listOutliers: async (options) => {
        captured = options
        return { outliers: [], total: 0, hasMore: false }
      },
    }),
  )
  await mcp.callTool({ name: 'list_outliers', arguments: { brandKitId: 'bk1' } })
  assert.equal(captured.brandKitId, 'bk1')
})

// -- connected accounts -------------------------------------------------------

test('list_connected_accounts shows handle, platform, and default flag', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_connected_accounts', arguments: {} })
  assert.match(res.content[0].text, /@contenthero \(id ca1\)/)
  assert.match(res.content[0].text, /\[default\]/)
  assert.match(res.content[0].text, /connected/)
})

test('get_connected_account lists enabled capabilities', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_connected_account', arguments: { accountId: 'ca1' } })
  // capabilities with a truthy value are surfaced; analytics:false is omitted.
  assert.match(res.content[0].text, /capabilities: publish/)
  assert.ok(!/analytics/.test(res.content[0].text), 'falsy capabilities are not listed')
  assert.match(res.content[0].text, /connectedAccountId on add_post_destination/)
})
