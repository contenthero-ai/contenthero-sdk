import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { GenerationTimeoutError, InsufficientCreditsError } from '@contenthero/sdk'
import { buildServer } from './server.js'
import { assertGroupsCoverTools, groupedToolNames } from './groups.js'

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
      { id: 'out-uuid-1', type: 'image', model: 'nano-banana-2', prompt: 'a cat', status: 'completed', createdAt: 't', variant: 0, url: 'https://cdn/1.png', generationSize: 2, isFavorited: false, kind: null, boardType: null, source: 'creations', fileName: null, durationSeconds: null },
      { id: 'out-uuid-1', type: 'image', model: 'nano-banana-2', prompt: 'a cat', status: 'completed', createdAt: 't', variant: 1, url: 'https://cdn/2.png', generationSize: 2, isFavorited: true, kind: null, boardType: null, source: 'creations', fileName: null, durationSeconds: null },
    ],
    getMedia: async (id) => ({
      id: 'out-uuid-1',
      type: 'image',
      model: 'nano-banana-2',
      prompt: 'a cat',
      status: 'completed',
      createdAt: 't',
      variant: id.includes('-2') ? 1 : 0,
      url: id.includes('-2') ? 'https://cdn/2.png' : 'https://cdn/1.png',
      generationSize: 2,
      isFavorited: id.includes('-2'),
      kind: null,
      boardType: null,
      source: 'creations',
      fileName: null,
      durationSeconds: null,
      script: null,
      aspectRatio: '1:1',
      resolution: '2K',
      duration: null,
      creditsUsed: 9,
      variations: [
        { variation: 1, url: 'https://cdn/1.png', status: 'completed', isFavorited: false, isArchived: false },
        { variation: 2, url: 'https://cdn/2.png', status: 'completed', isFavorited: true, isArchived: false },
      ],
      selectedVariation: id.includes('-2') ? 2 : null,
      thumbnailUrl: null,
    }),
    getMediaBatch: async (items) => ({
      items: items.map((it) => {
        if ('url' in it) {
          return { ok: true, input: it, url: it.url, imageUrl: it.url, type: 'image', model: null, prompt: null, mediaId: null, variation: null, otherVariations: [] }
        }
        const variation = it.variation ?? 2
        return {
          ok: true,
          input: it,
          url: `https://cdn/${variation}.png`,
          imageUrl: `https://cdn/${variation}.png`,
          type: 'image',
          model: 'nano-banana-2',
          prompt: 'a cat',
          mediaId: 'out-uuid-1',
          variation,
          otherVariations: variation === 2 ? [1] : [2],
        }
      }),
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
    listPlatforms: async () => [
      {
        platform: 'instagram',
        name: 'Instagram',
        formats: [
          { value: 'reel', label: 'Reel' },
          { value: 'post', label: 'Post' },
          { value: 'story', label: 'Story' },
        ],
        connected: true,
      },
      {
        platform: 'youtube',
        name: 'YouTube',
        formats: [
          { value: 'video', label: 'Long-form Video' },
          { value: 'short', label: 'YouTube Short' },
        ],
        connected: false,
      },
    ],
    getPlatform: async (platform, options = {}) => ({
      platform,
      name: 'Instagram',
      formats: options.format ? [options.format] : ['reel', 'post', 'story'],
      postingModes: ['automatic', 'notify_me'],
      enums: {},
      characterLimits: { caption: 2200 },
      fieldTemplatesByFormat: {
        post: { mediaItems: [], caption: '', postingMode: 'automatic', format: 'post' },
      },
    }),
    listCards: async () => ({
      cards: [
        { id: 'p1', title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: ['instagram'] },
      ],
      total: 1,
      hasMore: false,
    }),
    getCard: async (id) => ({
      id,
      title: 'Launch clip',
      description: 'a clip',
      platform: 'instagram',
      status: 'draft',
      stageId: 'st1',
      boardOrder: 0,
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
      posts: [{ id: 'd1', connectedAccountId: 'ca1', platform: 'instagram', format: 'reel', status: 'draft', scheduledAt: null, publishedAt: null, platformSettings: { caption: 'Launch!', mediaItems: [{ url: 'https://cdn/x.png' }] } }],
      tags: ['contenthero', 'feature'],
    }),
    createCard: async (input) => ({ id: 'p-new', title: input.title, description: input.description ?? null, platform: input.platform, status: input.status ?? 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    updateCard: async (id, input) => ({ id, title: input.title ?? 'Launch clip', description: null, platform: 'instagram', status: input.status ?? 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    listStages: async () => ({
      stages: [
        { id: 'st1', name: 'Ideation', slug: 'ideation', color: '#8B5CF6', sortOrder: 0 },
        { id: 'st2', name: 'Published', slug: 'published', color: '#10B981', sortOrder: 5 },
      ],
      space: { id: 'sp1', name: 'Product Development' },
    }),
    updatePostDestination: async (_cardId, destinationId, input) => ({ id: destinationId, connectedAccountId: input.connectedAccountId ?? 'ca1', platform: 'instagram', format: input.format ?? 'reel', status: input.status ?? 'draft', scheduledAt: null, publishedAt: null }),
    publishPost: async (cardId) => ({ cardId, results: [{ success: true, platform: 'instagram', destinationId: 'd1', url: 'https://instagram.com/p/x' }], publishedCount: 1, failedCount: 0 }),
    listAccounts: async (options) => {
      const all = [
        { id: 'ia1', platform: 'youtube', accountId: 'UC123', handle: 'mrbeast', name: 'MrBeast', avatarUrl: null, followerCount: 300_000_000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'inspiration' },
        { id: 'ba1', platform: 'instagram', accountId: '17841400000', handle: 'contenthero', name: 'ContentHero', avatarUrl: null, followerCount: 12000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'brand' },
      ]
      return options?.accountType ? all.filter((a) => a.accountType === options.accountType) : all
    },
    getAccount: async (id) => ({
      account: { id, platform: 'instagram', accountId: '17841400000', handle: 'contenthero', name: 'ContentHero', avatarUrl: null, followerCount: 12000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'brand' },
      contentCount: 50,
      totals: { views: 1_000_000, likes: 50_000, comments: 5_000 },
      averages: { views: 20_000, engagementRate: 0.055, outlierScore: 1.2 },
      topContent: [{ id: 'bc1', platform: 'instagram', contentType: 'reel', title: 'best reel', url: 'https://ig/bc1', thumbnailUrl: null, viewCount: 200_000, likeCount: 12_000, commentCount: 800, shareCount: 400, durationSeconds: 30, outlierScore: 2.1, engagementRate: 0.07, viewsPerFollower: 16, publishedAt: 't', sourceCreator: null, accountHandle: 'contenthero', isOwn: true }],
      recentContent: [],
    }),
    listContent: async () => ({
      outliers: [{ id: 'c1', platform: 'youtube', contentType: 'video', title: 'I gave away an island', url: 'https://yt/c1', thumbnailUrl: null, viewCount: 120_000_000, likeCount: 4_000_000, commentCount: 90_000, shareCount: null, durationSeconds: 600, outlierScore: 3.4, engagementRate: 0.05, viewsPerFollower: 0.4, publishedAt: 't', sourceCreator: 'MrBeast', accountHandle: 'mrbeast' }],
      total: 1,
      hasMore: false,
    }),
    getContent: async (id, options) => ({
      id, platform: 'youtube', contentType: 'video', title: 'I gave away an island', url: 'https://yt/c1', thumbnailUrl: null, viewCount: 120_000_000, likeCount: 4_000_000, commentCount: 90_000, shareCount: null, durationSeconds: 600, outlierScore: 3.4, engagementRate: 0.05, viewsPerFollower: 0.4, publishedAt: 't', sourceCreator: 'MrBeast', accountHandle: 'mrbeast',
      description: 'a video', hashtags: ['#mrbeast'], keywords: ['island'], mentions: [], audioInfo: null, followerCountSnapshot: 300_000_000,
      ...(options?.transcript && options.transcript !== 'none'
        ? { transcript: options.transcript === 'segments'
            ? { status: 'complete', language: 'en', segments: [{ startMs: 0, endMs: 2000, text: 'today I gave away an island', speaker: null }] }
            : { status: 'complete', language: 'en', text: 'today I gave away an island' } }
        : {}),
    }),
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
    listTags: async () => [
      { id: 't1', name: 'contenthero', isDefault: false, isSystem: false },
      { id: 't2', name: 'feature', isDefault: false, isSystem: false },
    ],
    createTag: async (name) => ({ id: 't-new', name: name.toLowerCase(), isDefault: false, isSystem: false }),
    updateTag: async (id, name) => ({ id, name: name.toLowerCase(), isDefault: false, isSystem: false }),
    deleteTag: async (id) => ({ id }),
    createMediaUpload: async (input) => ({ outputId: 'up1', uploadUrl: 'https://storage/sign/up1?token=abc', storagePath: `u/upload-up1.${input.fileName.split('.').pop()}`, expiresAt: '2026-07-01T00:00:00Z' }),
    completeMediaUpload: async (outputId) => ({ outputId, url: `https://cloud/${outputId}.png` }),
    importMedia: async (_input) => ({ outputId: 'im1', url: 'https://cloud/im1.png' }),
    favorite: async () => {},
    archive: async () => {},
    applyEditorOps: async (input) => ({ surface: input.projectId === 'canvas1' ? 'canvas' : 'editor', revision: 5, results: input.ops.map((o) => ({ op: o.op, opId: o.op_id ?? 'mock-op-id', ok: true })) }),
    listProjects: async () => [
      { id: 'p1', kind: 'editor', title: 'My Edit', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null },
    ],
    getProject: async (projectId, options) => ({ id: projectId, kind: 'editor', title: 'My Edit', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'editor', revision: 4, state: { tracks: [] }, assetReferences: [], brandKitId: null, exportedCardId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null, ...(options?.includeRenderUrl ? { renderUrl: 'https://x/preview.png' } : {}) }),
    getContext: async (input) => ({ context: { surface: 'canvas', focusedSlideId: 's1', selectedLayerIds: ['l1'], snapshotUrl: 'https://x/snap.webp' }, participant: { userId: 'u1', sessionId: 'sess', surface: 'canvas', projectId: input?.projectId ?? 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }, participants: [{ userId: 'u1', sessionId: 'sess', surface: 'canvas', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }] }),
    createProject: async (input) => ({ id: 'new1', kind: input.kind ?? 'editor', title: input.title ?? 'Untitled', orientation: input.orientation ?? '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: (input.kind === 'canvas' ? 'canvas' : 'editor'), revision: 0, state: {}, assetReferences: [], brandKitId: null, exportedCardId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null }),
    deleteProject: async () => {},
    importProject: async (input) => ({ id: 'imp1', kind: 'canvas', title: input.title ?? 'Imported deck', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'canvas', revision: 0, state: { slides: [] }, assetReferences: [], brandKitId: null, exportedCardId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null }),
    getLayerTypes: async () => ({ surface: 'canvas', description: 'canvas types', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, layerTypes: [{ type: 'text', description: 'text', props: [{ name: 'text', type: 'string' }], supports: ['transform'] }] }),
    getTimelineTypes: async () => ({ surface: 'editor', description: 'timeline types', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, clipTypes: [{ type: 'audio', description: 'audio', props: [{ name: 'audioUrl', type: 'string' }], supports: ['base'] }], trackTypes: [{ trackType: 'media', description: 'media', holds: ['video'] }] }),
    exportProjectAndWait: async (_projectId, input) => (input?.format && input.format !== 'mp4'
      ? { exportId: 'exp1', status: 'completed', outputUrl: 'https://x/out.zip', progress: 1 }
      : { exportId: 'exp1', status: 'completed', outputUrl: 'https://x/out.mp4', progress: 1 }),
    getExport: async (exportId) => ({ exportId, status: 'completed', outputUrl: 'https://x/out.mp4', progress: 1 }),
    getExportFormats: async () => ({ formats: [{ format: 'mp4', surfaces: ['editor', 'canvas'], async: true, description: 'video', options: ['resolution'] }, { format: 'pptx', surfaces: ['canvas'], async: false, description: 'powerpoint', options: [] }], resolutions: ['720p', '1080p'], qualities: ['recommended'] }),
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

/**
 * Every tool input is camelCase.
 *
 * ⚠️ THIS IS NOT STYLE. A model reads these names off the schema and writes them into a call, so a
 * surface that spells the same idea two ways makes the wrong spelling a plausible guess. Measured
 * 2026-09-04: `get_folder`, `update_folder` and `delete_folder` took `folder_id` / `folder_ids`, the
 * only snake_case in 85 tools, while `update_folder`'s OWN DESCRIPTION told the caller to "pass
 * folderIds". The description and the schema disagreed, so following the description silently did
 * nothing.
 *
 * Nothing caught it because no test calls those tools; the manifest test only checks that the tool
 * NAMES exist. This checks the shape of every input instead, so it covers tools nobody exercises.
 */
test('every tool input parameter is camelCase', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const offenders = []
  for (const tool of tools) {
    for (const param of Object.keys(tool.inputSchema?.properties ?? {})) {
      if (param.includes('_')) offenders.push(`${tool.name}.${param}`)
    }
  }
  assert.deepEqual(offenders, [], `snake_case tool inputs: ${offenders.join(', ')}`)
})

/**
 * An id parameter names the thing it identifies.
 *
 * A bare `id` is fine on a UNIVERSAL tool, where the caller supplies `assetType` to say what kind of id
 * it is: `favorite` and `archive` are exactly that, and renaming their `id` would be wrong. On a
 * single-resource tool it is a missed opportunity to be unambiguous, and it is how `delete_element`
 * ended up taking `id` while its five sibling deletes each took a named one.
 */
test('single-resource tools name their id parameter after the resource', async () => {
  const UNIVERSAL = new Set(['favorite', 'archive'])
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const offenders = tools
    .filter((t) => !UNIVERSAL.has(t.name))
    .filter((t) => Object.keys(t.inputSchema?.properties ?? {}).includes('id'))
    .map((t) => t.name)
  assert.deepEqual(offenders, [], `tools taking a bare \`id\`: ${offenders.join(', ')}`)
})

test('no tool advertises an array without an item schema', async () => {
  // ⚠️ THE BUG THIS EXISTS FOR. `z.array(z.unknown())` serialises to {"type":"array","items":{}}, which tells
  // a client NOTHING about what may go inside. The server accepted every shape when called directly, and
  // Claude Desktop rejected all of them before they left, because a validator cannot check a value against
  // an empty schema and a model cannot pattern an argument on one either.
  //
  // Measured 2026-08-23: 12 fields across 4 tools were advertised that way, and every one was a field added
  // during the tool consolidation. An untyped array is a defect on its own, regardless of which client
  // notices first, so this asserts the whole surface rather than the four tools that happened to break.
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const offenders = []
  for (const t of tools) {
    for (const [field, schema] of Object.entries(t.inputSchema.properties ?? {})) {
      if (schema.type === 'array' && (!schema.items || Object.keys(schema.items).length === 0)) {
        offenders.push(`${t.name}.${field}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `declare the item shape for: ${offenders.join(', ')}`)
})

test('advertises exactly the v1 tools, and every one of them is grouped', async () => {
  // This used to assert against 88 hand-maintained names right here. That list was a
  // tripwire (you could not add a tool without deliberately editing it), but it was the
  // THIRD copy of the same 88 names: the docs generator and the agent skill each kept
  // their own. Three copies, no mechanism to notice a disagreement.
  //
  // TOOL_GROUPS is now the single copy, and the tripwire moved onto it: adding a tool
  // still fails here until someone files it in a group, and that one edit now reaches the
  // documentation and the skill instead of only this assertion.
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const names = tools.map((t) => t.name).sort()

  assert.deepEqual(names, groupedToolNames().sort())

  // Names alone would pass if a tool were grouped twice and another not at all, since the
  // sorted sets could still match by coincidence of length. Check the directions directly.
  assertGroupsCoverTools(names)
})

test('no tool that spends credits is advertised as read-only', async () => {
  // readOnlyHint is what a host uses to decide it may call a tool WITHOUT asking the user.
  // A metered tool marked read-only can therefore be run in a loop, unattended, spending
  // real credits. transcribe shipped that way: metered per minute of audio, annotated READ.
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()

  const offenders = tools
    .filter((t) => t.annotations?.readOnlyHint)
    .filter((t) => /\bcredits? (it )?cost|metered|charges|spends/i.test(t.description ?? ''))
    .map((t) => t.name)

  assert.deepEqual(
    offenders,
    [],
    `these tools spend credits but claim readOnlyHint: ${offenders.join(', ')}`,
  )
})

/**
 * Metered tools the SERVER cannot price, so the MCP cannot offer a preflight.
 *
 * This is a list of server limitations, not a list of tools we decided to skip, and it
 * must stay that way or it becomes the place missing preflights go to hide. Every entry
 * names the route that would have to change to remove it.
 *
 * - transcribe: POST /api/v1/studio/transcribe accepts no getCost flag, and pricing it
 *   means reading the audio's duration before transcribing. The cost is knowable only
 *   afterwards, from creditsUsed on the result.
 */
const METERED_WITHOUT_PREFLIGHT = new Set(['transcribe'])

/**
 * The declaration a tool makes when calling it costs the caller credits.
 *
 * An EXPLICIT marker, deliberately, because the first version of this guard inferred
 * "metered" by grepping descriptions for "credits" or "metered" and immediately flagged
 * two correct tools: update_timeline and update_canvas each mention that ONE op inside
 * them (video background removal) is metered, which is operation-level, not tool-level. A
 * guard that flags correct code gets switched off, so the signal has to be something a
 * tool states about itself rather than something a regex infers about its prose.
 */
const SPEND_MARKER = 'SPENDS CREDITS'

test('spending is declared and priceable in both directions', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()

  const declares = (t) => (t.description ?? '').includes(SPEND_MARKER)
  const hasPreflight = (t) => Object.keys(t.inputSchema?.properties ?? {}).includes('getCost')

  // 1. Anything that declares a spend must be priceable first, so an agent can tell the
  //    user what it costs BEFORE committing their credits, or be a named server limit.
  const unpriceable = tools
    .filter(declares)
    .filter((t) => !hasPreflight(t))
    .map((t) => t.name)
    .filter((n) => !METERED_WITHOUT_PREFLIGHT.has(n))
  assert.deepEqual(unpriceable, [], `declares a spend, offers no preflight: ${unpriceable}`)

  // 2. And the reverse: a getCost preflight on a tool that never says it spends is a tool
  //    whose description hides the cost. All seven generation tools shipped that way, with
  //    the only mention of money living inside the getCost parameter's own text, which an
  //    agent reads only AFTER deciding to call the thing.
  const undeclared = tools
    .filter(hasPreflight)
    .filter((t) => !declares(t))
    .map((t) => t.name)
  assert.deepEqual(undeclared, [], `has a getCost preflight but never declares a spend: ${undeclared}`)

  // 3. The exception list must not outlive its reason. If a route learns to price itself
  //    and its tool gains getCost, this fails until the entry is deleted.
  const stale = [...METERED_WITHOUT_PREFLIGHT].filter((n) => {
    const t = tools.find((x) => x.name === n)
    return !t || hasPreflight(t)
  })
  assert.deepEqual(stale, [], `remove from METERED_WITHOUT_PREFLIGHT: ${stale.join(', ')}`)
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

/**
 * The defect class these two cover is NOT "avatarId is broken". It is "the server supported this all
 * along and no client exposed it".
 *
 * `/api/v1/studio/generate` has accepted `avatarId` since avatar looks landed, and the core tags the row
 * `kind: 'look'`. The SDK carried the field on the BOARD request only, and neither MCP tool advertised it,
 * so an agent could generate an image for a character and then had to hand it to a human to attach. A gap
 * like that is invisible from either side on its own: the server looks complete and the client looks
 * consistent. Asserting the field ARRIVES in the request is what makes it visible.
 */
test('generate_image forwards avatarId, so a generation can file itself as a look', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generateAndWait: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'completed', contentType: 'image', modelId: 'gpt-image-2',
          outputUrls: ['https://cdn/look.png'], error: null, createdAt: 't', completedAt: 't2',
        }
      },
    }),
  )
  await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'gpt-image-2', prompt: 'x', avatarId: 'av1' },
  })
  assert.equal(captured.avatarId, 'av1')
})

test('generate_board forwards avatarId', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generateBoardAndWait: async (req) => {
        captured = req
        return {
          outputId: 'b', status: 'completed', contentType: 'image', modelId: 'board',
          outputUrls: ['https://cdn/board.png'], error: null, createdAt: 't', completedAt: 't2',
        }
      },
    }),
  )
  await mcp.callTool({
    name: 'generate_board',
    arguments: { boardType: 'character', prompt: 'x', avatarId: 'av1' },
  })
  assert.equal(captured.avatarId, 'av1')
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

test('get_generation_status blocks by default and returns the final URLs', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_generation_status', arguments: { outputIds: ['gen1'] } })
  assert.match(res.content[0].text, /https:\/\/cdn\/v\.mp4/)
  assert.ok(!res.isError)
})

test('get_generation_status takes wait:false for an instant snapshot', async () => {
  let waited = false
  const mcp = await connect(
    fakeClient({
      waitForGeneration: async (id) => {
        waited = true
        return { outputId: id, status: 'completed', contentType: 'video', outputUrls: ['https://cdn/v.mp4'], error: null }
      },
    }),
  )
  await mcp.callTool({ name: 'get_generation_status', arguments: { outputIds: ['gen1'], wait: false } })
  // The direction that used to live in the tool NAME is an argument now, so this must not block.
  assert.equal(waited, false)
})

test('get_generation_status checks several outputIds in one call', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_generation_status', arguments: { outputIds: ['gen1', 'gen2'] } })
  assert.match(res.content[0].text, /2 generation\(s\)/)
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

/**
 * The avatar WRITE surface.
 *
 * ⚠️ THE THING WORTH GUARDING IS NOT THAT THE CALLS GO THROUGH. It is that `create_avatar` tells the
 * model the avatar is NOT READY. The row comes back at `status: 'processing'` with a null image and no
 * looks, so a result formatted like a finished avatar reads as "created, and empty". A model that
 * believes that goes on to file looks onto an avatar whose own first look is still in flight, or tells
 * the user their avatar is ready when nothing is visible yet.
 */
test('create_avatar says the avatar is NOT ready and names the poll call', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      createAvatar: async (req) => {
        captured = req
        return {
          avatar: {
            id: 'av-new', name: 'Mika', imageUrl: null, defaultVoiceId: null, isDefault: false,
            status: 'processing', description: null, age: '20s', gender: 'female', ethnicity: null,
            niche: [], createdAt: 't', looks: [],
          },
          status: 'processing',
          message: 'Avatar created; its first look is generating.',
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'create_avatar',
    arguments: { name: 'Mika', age: '20s', gender: 'female', description: 'a creator' },
  })
  assert.ok(!res.isError)
  assert.equal(captured.name, 'Mika')
  assert.equal(captured.age, '20s')
  const body = res.content[0].text
  assert.match(body, /NOT READY/, 'the wait must be stated, not implied by a null image')
  assert.match(body, /get_avatar/, 'the poll call must be named')
  assert.match(body, /av-new/, 'the new id must be present so the caller can poll it')
})

test('create_avatar getCost estimates without creating', async () => {
  let created = false
  const mcp = await connect(
    fakeClient({
      estimateAvatarCost: async () => 10,
      createAvatar: async () => {
        created = true
        throw new Error('must not create')
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'create_avatar',
    arguments: { name: 'Mika', age: '20s', gender: 'female', getCost: true },
  })
  assert.ok(!res.isError)
  assert.equal(created, false, 'getCost must not create anything')
  assert.match(res.content[0].text, /10 credits/)
})

test('update_avatar forwards look ops alongside fields', async () => {
  let capturedId, captured
  const mcp = await connect(
    fakeClient({
      updateAvatar: async (id, req) => {
        capturedId = id
        captured = req
        return {
          avatar: {
            id, name: 'Renamed', imageUrl: 'https://cdn/l.png', defaultVoiceId: null, isDefault: false,
            status: 'completed', description: null, age: null, gender: null, ethnicity: null,
            niche: [], createdAt: 't', looks: [],
          },
          applied: [{ op: 'add_look', lookIds: ['lk9'], skipped: 0 }],
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'update_avatar',
    arguments: {
      avatarId: 'av1',
      name: 'Renamed',
      ops: [{ op: 'add_look', imageUrls: ['https://cdn/x.png'] }],
    },
  })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'av1')
  assert.equal(captured.name, 'Renamed')
  assert.deepEqual(captured.ops, [{ op: 'add_look', imageUrls: ['https://cdn/x.png'] }])
  // `avatarId` addresses the resource; it must not also be sent as a field to update.
  assert.equal(captured.avatarId, undefined)
})

test('update_avatar rejects an unknown op at the schema boundary', async () => {
  const mcp = await connect(
    fakeClient({ updateAvatar: async () => assert.fail('must not reach the client') }),
  )
  const res = await mcp.callTool({
    name: 'update_avatar',
    arguments: { avatarId: 'av1', ops: [{ op: 'rename_look', lookId: 'lk1' }] },
  })
  assert.ok(res.isError, 'an op the server cannot apply must fail before it is sent')
})

test('delete_avatar says the looks survive, because "deleted" reads as terminal', async () => {
  let capturedId
  const mcp = await connect(
    fakeClient({
      deleteAvatar: async (id) => {
        capturedId = id
        return { deleted: true, avatarId: id }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'delete_avatar', arguments: { avatarId: 'av1' } })
  assert.ok(!res.isError)
  assert.equal(capturedId, 'av1')
  assert.match(res.content[0].text, /looks are retained/i)
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

test('list_media lists one row per variation with its slot, favorite, and url', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_media', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /out-uuid-1/)
  assert.match(res.content[0].text, /image/)
  // Two variations of one generation now render as two rows (v1/2 and v2/2), the favorited one tagged.
  assert.match(res.content[0].text, /v1\/2/)
  assert.match(res.content[0].text, /v2\/2/)
  assert.match(res.content[0].text, /\[favorite\]/)
  assert.match(res.content[0].text, /cdn\/2\.png/)
})

test('get_media resolves a batch and reports each item with its variation + url', async () => {
  let capturedItems
  const mcp = await connect(
    fakeClient({
      getMediaBatch: async (items) => {
        capturedItems = items
        return {
          items: [
            {
              ok: true,
              input: items[0],
              url: 'https://cdn/2.png',
              imageUrl: 'https://cdn/2.png',
              type: 'image',
              model: 'nano-banana-2',
              prompt: 'a cat',
              mediaId: 'out-uuid-1',
              variation: 2,
              otherVariations: [1],
            },
          ],
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'get_media',
    arguments: { items: [{ mediaId: 'abcd1234', variation: 2 }] },
  })
  assert.ok(!res.isError)
  assert.deepEqual(capturedItems, [{ mediaId: 'abcd1234', variation: 2 }])
  assert.match(res.content[0].text, /v2/)
  assert.match(res.content[0].text, /https:\/\/cdn\/2\.png/)
  assert.match(res.content[0].text, /other variations: 1/)
})

test('get_media returns an image block per video keyframe when a window is requested', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      getMediaBatch: async (items) => {
        captured = items
        return {
          items: [
            {
              ok: true,
              input: items[0],
              url: 'https://cdn/clip.mp4',
              imageUrl: null,
              type: 'video',
              model: null,
              prompt: null,
              mediaId: 'vid-1',
              variation: 1,
              otherVariations: [],
              keyframes: [
                { atSec: 0, dataUrl: 'data:image/jpeg;base64,AAAA' },
                { atSec: 5, dataUrl: 'data:image/jpeg;base64,BBBB' },
              ],
            },
          ],
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'vid-1', frames: 2, fromSec: 0, toSec: 5 }] } })
  assert.ok(!res.isError)
  assert.deepEqual(captured, [{ mediaId: 'vid-1', frames: 2, fromSec: 0, toSec: 5 }])
  const images = res.content.filter((c) => c.type === 'image')
  assert.equal(images.length, 2, 'expected one image block per keyframe')
  assert.deepEqual(images.map((i) => i.data), ['AAAA', 'BBBB'])
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

test('list_platforms surfaces platforms, formats, and the connected flag', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_platforms', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /instagram \(Instagram\) \[connected\]/)
  assert.match(res.content[0].text, /youtube \(YouTube\)/)
  // Points the agent to get_platform for the full shape.
  assert.match(res.content[0].text, /get_platform/)
})

test('get_platform passes platform + format through and renders the field shape', async () => {
  let captured: { platform?: string; format?: string } = {}
  const mcp = await connect(
    fakeClient({
      getPlatform: async (platform, options = {}) => {
        captured = { platform, format: options.format }
        return {
          platform,
          name: 'Instagram',
          formats: ['post'],
          postingModes: ['automatic', 'notify_me'],
          enums: {},
          characterLimits: { caption: 2200 },
          fieldTemplatesByFormat: {
            post: { mediaItems: [], caption: '', postingMode: 'automatic', format: 'post' },
          },
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'get_platform',
    arguments: { platform: 'instagram', format: 'post' },
  })
  assert.ok(!res.isError)
  assert.equal(captured.platform, 'instagram')
  assert.equal(captured.format, 'post')
  assert.match(res.content[0].text, /post: mediaItems, caption/)
  assert.match(res.content[0].text, /caption: 2200/)
  assert.match(res.content[0].text, /platformSettings/)
})

test('list_tags lists the account tags', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_tags', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /contenthero \(id t1\)/)
  assert.match(res.content[0].text, /feature \(id t2\)/)
})

test('create_tag lowercases and returns the tag', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      createTag: async (name) => {
        captured = name
        return { id: 't9', name: name.toLowerCase(), isDefault: false, isSystem: false }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'create_tag', arguments: { name: 'Reference Boards' } })
  assert.ok(!res.isError)
  assert.equal(captured, 'Reference Boards')
  assert.match(res.content[0].text, /Created: reference boards \(id t9\)/)
})

test('delete_tag destroys the tag and notes the cascade', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'delete_tag', arguments: { tagId: 't1' } })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /Tag deleted \(id t1\)/)
  assert.match(res.content[0].text, /removed from all posts/)
})

test('create_card forwards tags', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      createCard: async (input) => {
        captured = input
        return { id: 'p-new', title: input.title, description: null, platform: input.platform, status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'create_card',
    arguments: { title: 'X', platform: 'instagram', tags: ['contenthero', 'feature'] },
  })
  assert.deepEqual(captured.tags, ['contenthero', 'feature'])
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

/**
 * ⚠️ THIS USED TO ASSERT THE LINE CONTAINED `draft`. A card no longer has a status: the column carried no
 * information and almost every row read `draft` regardless of what the card actually was, so the line was
 * confirming the presence of a value that told the agent nothing. What it must carry now is identity,
 * where the card publishes, and its archive state when there is one.
 */
test('list_cards surfaces id and platform with pagination context', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_cards', arguments: {} })
  assert.match(res.content[0].text, /Launch clip \(id p1\)/)
  assert.match(res.content[0].text, /instagram/)
  // A live card must not be labelled archived, or the flag means nothing when it does appear.
  assert.ok(!/\[archived\]/.test(res.content[0].text))
  assert.ok(!res.isError)
})

test('list_cards flags an archived card and forwards the filter', async () => {
  let seen: Record<string, unknown> | undefined
  const client = fakeClient()
  client.listCards = async (opts: Record<string, unknown>) => {
    seen = opts
    return {
      cards: [
        {
          id: 'p9', title: 'Old idea', platform: 'instagram', stageId: 'st1', boardOrder: 0,
          contentType: null, coverUrl: null, isFavorite: false, folderId: null,
          archivedAt: '2026-09-12T00:00:00Z', isArchived: true,
          scheduledAt: null, publishedAt: null, publishUrl: null,
          createdAt: 't', updatedAt: 't', platforms: ['instagram'],
        },
      ],
      total: 1,
      hasMore: false,
    }
  }
  const mcp = await connect(client)
  const res = await mcp.callTool({ name: 'list_cards', arguments: { archived: true } })
  // The WIRING half: a flag the tool accepts but never forwards would leave the agent unable to see the
  // archive at all, which is exactly the regression this parameter was added to close.
  assert.equal((seen as { archived?: boolean }).archived, true)
  assert.match(res.content[0].text, /\[archived\]/)
  assert.ok(!res.isError)
})

/**
 * The SDK sending `space_id` is not enough: the MCP tool has to forward the arg.
 * This asserts the WIRING, not the rule. Both halves failed here originally, and a
 * response-shape test passes either way because the server just answers about a
 * different space.
 */
test('list_cards and list_stages forward spaceId to the client', async () => {
  const seen: { cards?: unknown; stages?: unknown } = {}
  const client = fakeClient()
  const base = client.listCards
  client.listCards = async (opts: unknown) => {
    seen.cards = opts
    return base(opts)
  }
  const baseStages = client.listStages
  client.listStages = async (opts: unknown) => {
    seen.stages = opts
    return baseStages(opts)
  }

  const mcp = await connect(client)
  await mcp.callTool({ name: 'list_cards', arguments: { spaceId: 'sp1' } })
  assert.equal((seen.cards as { spaceId?: string })?.spaceId, 'sp1')

  await mcp.callTool({ name: 'list_stages', arguments: { spaceId: 'sp1' } })
  assert.equal((seen.stages as { spaceId?: string })?.spaceId, 'sp1')
})

test('get_card returns the post with its posts and assets', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_card', arguments: { cardId: 'p1' } })
  assert.match(res.content[0].text, /posts \(1\)/)
  assert.match(res.content[0].text, /instagram \(id d1\)/)
  // The destination's platformSettings keys are surfaced (the publish payload).
  assert.match(res.content[0].text, /settings: caption, mediaItems/)
  assert.match(res.content[0].text, /tags: contenthero, feature/)
  assert.match(res.content[0].text, /assets \(1\)/)
})

test('create_card passes the title/platform/stage through and returns the new id', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      createCard: async (input) => {
        captured = input
        return { id: 'p-new', title: input.title, description: null, platform: input.platform, status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'create_card',
    arguments: { title: 'Launch clip', platform: 'instagram', stage: 'ideation' },
  })
  assert.equal(captured.title, 'Launch clip')
  assert.equal(captured.platform, 'instagram')
  assert.equal(captured.stage, 'ideation')
  assert.match(res.content[0].text, /Created: Launch clip \(id p-new\)/)
})

/**
 * 🚨 **THE ONE WRITE THAT PLACES A CARD COULD NOT CHOOSE WHERE.** `list_cards`, `list_stages`,
 * `create_stage` and `update_card` all took a space; `create_card` did not, so every card made through
 * the MCP, the SDK or the CLI landed silently on the account's DEFAULT board. The v1 route had accepted
 * `spaceId` the whole time, so this was three client layers omitting a parameter the server already
 * read. ⭐ `update_card` COULD move a card between spaces, which is what made the gap read as closed.
 */
test('create_card forwards the space, so a card lands on the board the caller named', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      createCard: async (input) => {
        captured = input
        return { id: 'p-new', title: input.title, description: null, platform: input.platform, status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'create_card',
    arguments: { title: 'Scoped', platform: 'general', spaceId: 'sp-other' },
  })
  assert.equal(captured.spaceId, 'sp-other')
})

test('create_card without a space sends none, so the server picks the default', async () => {
  // Sending undefined is NOT the same as sending the default's id: the server resolves it, and the
  // stage decides the space when a stage id is given. The client must not pre-empt either.
  let captured
  const mcp = await connect(
    fakeClient({
      createCard: async (input) => {
        captured = input
        return { id: 'p-new', title: input.title, description: null, platform: input.platform, status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({ name: 'create_card', arguments: { title: 'Unscoped', platform: 'general' } })
  assert.equal(captured.spaceId, undefined)
})

test('list_stages lists stages with id and slug for resolution', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_stages', arguments: {} })
  assert.match(res.content[0].text, /Ideation \(id st1, slug ideation\)/)
  assert.match(res.content[0].text, /Published \(id st2, slug published\)/)
})

/**
 * ⭐⭐⭐ A SCOPED ANSWER MUST NAME ITS SCOPE, and stages are per-space with a silent fallback to the
 * account's default. Asserted on BOTH branches because the empty one is the branch that misleads: a
 * wrong-scope empty list reads as "the thing you asked for does not exist", which is exactly the reading
 * that sent a whole investigation down the wrong path on 2026-09-14.
 */
test('list_stages names the space it is an answer about', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_stages', arguments: {} })
  assert.match(res.content[0].text, /in Product Development/)
})

test('list_stages names the space even when the space has NO stages', async () => {
  const client = fakeClient()
  client.listStages = async () => ({ stages: [], space: { id: 'sp1', name: 'Product Development' } })
  const mcp = await connect(client)
  const res = await mcp.callTool({ name: 'list_stages', arguments: {} })
  assert.equal(res.content[0].text, 'No stages found in Product Development.')
})

test('archive marks a card via the universal tool', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      archive: async (input) => {
        captured = input
      },
    }),
  )
  const res = await mcp.callTool({ name: 'archive', arguments: { assetType: 'card', id: 'p1' } })
  assert.deepEqual(captured, { assetType: 'card', id: 'p1', variationIndex: undefined, archived: true })
  assert.match(res.content[0].text, /Archived card p1/)
})

test('favorite marks a top-level asset and reports it', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      favorite: async (input) => {
        captured = input
      },
    }),
  )
  const res = await mcp.callTool({ name: 'favorite', arguments: { assetType: 'brand_kit', id: 'bk1' } })
  assert.deepEqual(captured, { assetType: 'brand_kit', id: 'bk1', variationIndex: undefined, favorited: true })
  assert.match(res.content[0].text, /Favorited brand_kit bk1/)
})

test('favorite routes a studio variation via variationIndex (no assetType)', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      favorite: async (input) => {
        captured = input
      },
    }),
  )
  const res = await mcp.callTool({ name: 'favorite', arguments: { id: 'out-uuid', variationIndex: 2 } })
  assert.deepEqual(captured, { assetType: undefined, id: 'out-uuid', variationIndex: 2, favorited: true })
  assert.match(res.content[0].text, /Favorited variation 2 of output out-uuid/)
})

test('favorite and archive clear with a boolean instead of an inverse tool', async () => {
  let fav, arch
  const mcp = await connect(
    fakeClient({
      favorite: async (input) => {
        fav = input
      },
      archive: async (input) => {
        arch = input
      },
    }),
  )
  // The two inverse tools were their positive twins with one value flipped, so a caller had to know which
  // NAME set which value. Now it is an argument.
  const r1 = await mcp.callTool({ name: 'favorite', arguments: { assetType: 'voice', id: 'v1', favorited: false } })
  assert.deepEqual(fav, { assetType: 'voice', id: 'v1', variationIndex: undefined, favorited: false })
  assert.match(r1.content[0].text, /Unfavorited voice v1/)

  const r2 = await mcp.callTool({ name: 'archive', arguments: { assetType: 'project', id: 'pr1', archived: false } })
  assert.deepEqual(arch, { assetType: 'project', id: 'pr1', variationIndex: undefined, archived: false })
  assert.match(r2.content[0].text, /Unarchived project pr1/)
})

test('list filters forward favorited/archived to the client', async () => {
  let mediaOpts, kitOpts, voiceOpts
  const mcp = await connect(
    fakeClient({
      listMedia: async (opts) => {
        mediaOpts = opts
        return []
      },
      listBrandKits: async (opts) => {
        kitOpts = opts
        return []
      },
      listVoices: async (opts) => {
        voiceOpts = opts
        return []
      },
    }),
  )
  await mcp.callTool({ name: 'list_media', arguments: { favorited: true } })
  assert.equal(mediaOpts.favorited, true)
  await mcp.callTool({ name: 'list_brand_kits', arguments: { archived: true } })
  assert.equal(kitOpts.archived, true)
  await mcp.callTool({ name: 'list_voices', arguments: { favorited: true } })
  assert.equal(voiceOpts.favorited, true)
})

test('update_card sets posts declaratively, keyed by platform', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = input
        return { id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'update_card',
    arguments: {
      cardId: 'p1',
      posts: [
        { platform: 'youtube', format: 'short', connectedAccountId: 'ca9', platformSpecificData: { title: 'My Short' } },
      ],
    },
  })
  assert.equal(captured.posts.length, 1)
  assert.equal(captured.posts[0].platform, 'youtube')
  assert.equal(captured.posts[0].connectedAccountId, 'ca9')
  // The free-form publish payload survives the boundary untouched.
  assert.deepEqual(captured.posts[0].platformSpecificData, { title: 'My Short' })
})

/**
 * The MOVE, which is the whole reason spaceId and cardIds exist on this tool.
 *
 * ⚠️ ONE CARD AND A SET TAKE DIFFERENT CLIENT METHODS, so the branch is real code rather than a spread.
 * These assert which one was called AND what it carried, because routing a set through the single-card
 * method would still "work" (it would move the first card and answer 200 for all of them).
 */
test('update_card moves ONE card to another space through updateCard', async () => {
  let captured
  let bulkCalled = false
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = { id, input }
        return { id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st9', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
      updateCards: async () => { bulkCalled = true; return [] },
    }),
  )
  await mcp.callTool({ name: 'update_card', arguments: { cardId: 'p1', spaceId: 'sp2' } })

  assert.equal(bulkCalled, false)
  assert.equal(captured.id, 'p1')
  assert.equal(captured.input.spaceId, 'sp2')
  // No stage named: absence is what tells the server to match the card's own stage by slug. A null here
  // would mean "no column", which is a different and real value.
  assert.equal('stage' in captured.input, false)
})

test('update_card moves a SET through updateCards, and reports the count', async () => {
  let captured
  let singleCalled = false
  const mcp = await connect(
    fakeClient({
      updateCard: async (id) => { singleCalled = true; return { id, title: 'x', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] } },
      updateCards: async (ids, input) => {
        captured = { ids, input }
        return ids.map((id) => ({ id, title: 'x', description: null, platform: 'instagram', status: 'draft', stageId: 'st9', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }))
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'update_card',
    arguments: { cardId: 'p1', cardIds: ['p1', 'p2', 'p3'], spaceId: 'sp2', stage: 'review' },
  })

  assert.equal(singleCalled, false)
  assert.deepEqual(captured.ids, ['p1', 'p2', 'p3'])
  assert.equal(captured.input.spaceId, 'sp2')
  assert.equal(captured.input.stage, 'review')
  // `cardIds` is the ADDRESSING, not a field to write, so it must not reach the patch.
  assert.equal('cardIds' in captured.input, false)
  assert.match(res.content[0].text, /Updated 3 cards/)
})

test('update_card reorders assets by sending the same ids in a new order', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = input
        return { id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'update_card',
    arguments: { cardId: 'p1', assets: [{ id: 'as2' }, { id: 'as1' }] },
  })
  // Reordering used to be its own tool that demanded "ALL of the post's asset ids in the desired order",
  // which is a declarative list with a tool wrapped around it. Position in the array IS the order.
  assert.deepEqual(captured.assets.map((a) => a.id), ['as2', 'as1'])
})

test('update_card attaches a new asset by output id alongside kept ones', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = input
        return { id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'update_card',
    arguments: { cardId: 'p1', assets: [{ id: 'as1' }, { outputId: 'out7-2' }] },
  })
  assert.equal(captured.assets[0].id, 'as1')
  // The VARIATION token survives intact: "-2" is which image of the batch.
  assert.equal(captured.assets[1].outputId, 'out7-2')
})

test('update_card schedules the post, which cascades to its posts', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = input
        return { id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: input.scheduledAt ?? null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'update_card',
    arguments: { cardId: 'p1', scheduledAt: '2026-07-01T00:00:00Z' },
  })
  assert.equal(captured.scheduledAt, '2026-07-01T00:00:00Z')
  assert.match(res.content[0].text, /Scheduled:/)
})

test('update_card clears posts with an empty array', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = input
        return { id, title: 'x', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  await mcp.callTool({ name: 'update_card', arguments: { cardId: 'p1', posts: [] } })
  // [] must reach the server as an empty list, not be dropped as falsy: that is the difference between
  // "detach everything" and "change nothing".
  assert.deepEqual(captured.posts, [])
})

test('publish_post reports one result per post', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'publish_post', arguments: { cardId: 'p1' } })
  assert.match(res.content[0].text, /Published 1\/1 post/)
  assert.match(res.content[0].text, /instagram: published/)
  assert.ok(!res.isError)
})

test('publish_post flags a total failure as an error result', async () => {
  const mcp = await connect(
    fakeClient({
      publishPost: async (cardId) => ({ cardId, results: [{ success: false, platform: 'instagram', destinationId: 'd1', error: 'token expired' }], publishedCount: 0, failedCount: 1 }),
    }),
  )
  const res = await mcp.callTool({ name: 'publish_post', arguments: { cardId: 'p1' } })
  assert.match(res.content[0].text, /token expired/)
  assert.ok(res.isError, 'a 0-published publish should be an error result')
})

// -- inspiration / research ---------------------------------------------------

test('list_accounts returns BOTH kinds, each labelled', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_accounts', arguments: {} })
  // The whole point of merging the two list tools: one call answers both questions, and a reader can still
  // tell the owner's own profile from a creator they watch.
  assert.match(res.content[0].text, /@mrbeast \(id ia1\) \[watching\]/)
  assert.match(res.content[0].text, /@contenthero \(id ba1\) \[yours\]/)
})

test('list_accounts narrows to one kind when asked', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_accounts', arguments: { accountType: 'brand' } })
  assert.match(res.content[0].text, /@contenthero/)
  assert.ok(!/@mrbeast/.test(res.content[0].text))
})

test('list_content ranks content by score with views', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_content', arguments: { outlierScoreMin: 2 } })
  assert.match(res.content[0].text, /\[3\.4x\] I gave away an island/)
  assert.match(res.content[0].text, /120\.0M views/)
})

test('list_content passes filters through to the client', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listContent: async (options) => {
        captured = options
        return { outliers: [], total: 0, hasMore: false }
      },
    }),
  )
  await mcp.callTool({
    name: 'list_content',
    arguments: { platform: 'youtube', sortBy: 'views', limit: 5, scope: 'brand', publicationDate: 'month' },
  })
  assert.equal(captured.platform, 'youtube')
  assert.equal(captured.sortBy, 'views')
  assert.equal(captured.limit, 5)
  // scope and the published window are the two things the API could not express at all before.
  assert.equal(captured.scope, 'brand')
  assert.equal(captured.publicationDate, 'month')
})

test('get_content omits the transcript unless it is asked for', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1' } })
  assert.ok(!/transcript/.test(res.content[0].text))
})

test('get_content returns the flat transcript at the text grain', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', transcript: 'text' } })
  assert.match(res.content[0].text, /transcript \[complete\]/)
  assert.match(res.content[0].text, /today I gave away an island/)
})

test('get_content returns timed slices at the segments grain', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', transcript: 'segments' } })
  // The timestamp is the point: it is what makes "the part about pricing" addressable.
  assert.match(res.content[0].text, /\[0\.0s\] today I gave away an island/)
})

test('get_content forwards a transcript window to the client', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      getContent: async (id, options) => {
        captured = { id, options }
        return { id, platform: 'youtube', contentType: 'video', title: 't', url: null, thumbnailUrl: null, viewCount: 0, likeCount: 0, commentCount: 0, shareCount: null, durationSeconds: null, outlierScore: null, engagementRate: null, viewsPerFollower: null, publishedAt: null, sourceCreator: null, accountHandle: null, description: null, hashtags: [], keywords: [], mentions: [], audioInfo: null, followerCountSnapshot: null }
      },
    }),
  )
  await mcp.callTool({
    name: 'get_content',
    arguments: { contentId: 'c1', transcript: 'segments', startMs: 5000, endMs: 15000, transcriptSearch: 'island' },
  })
  assert.equal(captured.options.startMs, 5000)
  assert.equal(captured.options.endMs, 15000)
  assert.equal(captured.options.transcriptSearch, 'island')
  // contentId is a positional argument, not part of the options bag.
  assert.equal(captured.options.contentId, undefined)
})

test('get_account reports totals and averages for either kind of account', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_account', arguments: { accountId: 'ba1' } })
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

test('archive confirms a brand kit via the universal tool', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      archive: async (input) => {
        captured = input
      },
    }),
  )
  const res = await mcp.callTool({ name: 'archive', arguments: { assetType: 'brand_kit', id: 'bk1' } })
  assert.deepEqual(captured, { assetType: 'brand_kit', id: 'bk1', variationIndex: undefined, archived: true })
  assert.match(res.content[0].text, /Archived brand_kit bk1/)
})

test('update_brand_kit forwards brandAccounts, including a url that adds a NEW account', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'ContentHero', businessName: null, nicheDefinition: null, isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'update_brand_kit',
    arguments: { brandKitId: 'bk1', brandAccounts: ['https://www.youtube.com/@taylanalpan'] },
  })
  // THE REGRESSION: brandAccounts was destructured out of args and never put back, so a patch naming only
  // accounts reached the client empty and the tool answered "nothing to change".
  assert.ok(!res.isError, `expected success, got: ${res.content[0].text}`)
  assert.deepEqual(captured.brandAccounts, ['https://www.youtube.com/@taylanalpan'])
})

test('update_brand_kit forwards inspirationAccounts too', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'x', businessName: null, nicheDefinition: null, isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'update_brand_kit',
    arguments: { brandKitId: 'bk1', inspirationAccounts: [{ platform: 'youtube', handleOrUrl: 'somecreator' }] },
  })
  assert.deepEqual(captured.inspirationAccounts, [{ platform: 'youtube', handleOrUrl: 'somecreator' }])
})

test('every declared field on update_brand_kit actually reaches the client', async () => {
  // A CLASS GUARD, not one more case. The bug was a field named in the schema, pulled out of `args` by the
  // handler, and never re-added, which `...rest` cannot catch. This walks the advertised schema and asserts
  // each optional field survives the handler, so the next field added this way fails here instead of in
  // production.
  const SAMPLES = {
    name: 'n', businessName: 'b', websiteUrl: 'https://x.test', primaryOffer: 'o', nicheDefinition: 'nd',
    visualStyle: 'vs', positioning: { a: 1 }, audience: { a: 1 }, voiceProfile: { a: 1 },
    contentStrategy: { a: 1 }, designPrinciples: ['p'], logos: [{ url: 'https://x/1.png' }],
    assets: [{ url: 'https://x/2.png' }], sections: [{ tab: 't', sectionName: 's' }],
    brandAccounts: ['https://youtube.com/@a'], inspirationAccounts: ['https://youtube.com/@b'],
  }
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'x', businessName: null, nicheDefinition: null, isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  const { tools } = await mcp.listTools()
  const declared = Object.keys(tools.find((t) => t.name === 'update_brand_kit').inputSchema.properties)
  // These are handled by the tool itself rather than passed through, by design.
  const NOT_FORWARDED = new Set(['brandKitId', 'orderedIds', 'extract', 'isDefault'])
  for (const field of declared) {
    if (NOT_FORWARDED.has(field)) continue
    assert.ok(field in SAMPLES, `add a sample value for update_brand_kit.${field} to this test`)
    captured = undefined
    await mcp.callTool({ name: 'update_brand_kit', arguments: { brandKitId: 'bk1', [field]: SAMPLES[field] } })
    assert.ok(captured, `update_brand_kit dropped "${field}": the patch reached the client empty`)
    assert.ok(field in captured, `update_brand_kit declared "${field}" but never forwarded it`)
  }
})

test('update_brand_kit sets sections declaratively, keyed by tab and name', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'ContentHero', businessName: null, nicheDefinition: null, isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  await mcp.callTool({
    name: 'update_brand_kit',
    arguments: {
      brandKitId: 'bk1',
      sections: [
        { tab: 'voice', sectionName: 'Tone', fields: [{ key: 'tone', value: 'warm' }] },
        { tab: 'overview', sectionName: 'Positioning' },
      ],
    },
  })
  // (tab, sectionName) is the key, and it is what an agent can name without looking up an id first:
  // getBrandKit returns sections with no id at all.
  assert.equal(captured.sections.length, 2)
  assert.equal(captured.sections[0].tab, 'voice')
  assert.equal(captured.sections[0].sectionName, 'Tone')
  assert.deepEqual(captured.sections[0].fields, [{ key: 'tone', value: 'warm' }])
})

test('archive a brand_kit_section by section id via the universal tool', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      archive: async (input) => {
        captured = input
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'archive',
    arguments: { assetType: 'brand_kit_section', id: 'sec9' },
  })
  assert.deepEqual(captured, { assetType: 'brand_kit_section', id: 'sec9', variationIndex: undefined, archived: true })
  assert.match(res.content[0].text, /Archived brand_kit_section sec9/)
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

test('list_content forwards brandKitId for brand-scoped reads', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listContent: async (options) => {
        captured = options
        return { outliers: [], total: 0, hasMore: false }
      },
    }),
  )
  await mcp.callTool({ name: 'list_content', arguments: { brandKitId: 'bk1' } })
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
  assert.match(res.content[0].text, /connectedAccountId on a post in update_card/)
})

test('list_projects lists projects with kind + title', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_projects', arguments: {} })
  const body = (res.content[0]).text
  assert.match(body, /p1/)
  assert.match(body, /\[editor\]/)
  assert.match(body, /My Edit/)
})

test('get_project reads the full detail + revision', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1' } })
  const body = (res.content[0]).text
  assert.match(body, /revision 4/)
  assert.match(body, /My Edit/)
})

test('get_context returns the context text + a focused-slide image block', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/webp' } })) as typeof fetch
  try {
    const mcp = await connect(fakeClient())
    const res = await mcp.callTool({ name: 'get_context', arguments: {} })
    assert.match((res.content[0]).text, /canvas surface/)
    const image = res.content.find((c) => c.type === 'image')
    assert.ok(image, 'expected an image content block')
    assert.equal(image.mimeType, 'image/webp')
    assert.ok(image.data.length > 0)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('get_context render returns the composed-output as an inline image block', async () => {
  const rendered = { surface: 'editor', frame: 34, dataUrl: 'data:image/webp;base64,AQIDBA==' }
  const mcp = await connect(
    fakeClient({
      getContext: async () => ({
        context: { surface: 'editor', playheadFrame: 34, rendered },
        participant: { userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' },
        participants: [{ userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }],
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_context', arguments: { render: true, frame: 34 } })
  const image = res.content.find((c) => c.type === 'image')
  assert.ok(image, 'expected an inline render image block')
  assert.equal(image.mimeType, 'image/webp')
  assert.equal(image.data, 'AQIDBA==')
  // the bulky base64 dataUrl must be stripped from the JSON text (it rides only as the image block)
  assert.doesNotMatch((res.content[0]).text, /AQIDBA==/)
})

test('get_context filmstrip render returns one image block per frame', async () => {
  const rendered = {
    mode: 'filmstrip',
    fromFrame: 0,
    toFrame: 60,
    frames: [
      { frame: 0, dataUrl: 'data:image/webp;base64,AAAA' },
      { frame: 30, dataUrl: 'data:image/webp;base64,BBBB' },
      { frame: 60, dataUrl: 'data:image/webp;base64,CCCC' },
    ],
  }
  const mcp = await connect(
    fakeClient({
      getContext: async () => ({
        context: { surface: 'editor', playheadFrame: 0, rendered },
        participant: { userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' },
        participants: [{ userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }],
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_context', arguments: { render: true, mode: 'filmstrip', fromFrame: 0, toFrame: 60 } })
  const images = res.content.filter((c) => c.type === 'image')
  assert.equal(images.length, 3, 'expected one image block per filmstrip frame')
  assert.deepEqual(images.map((i) => i.data), ['AAAA', 'BBBB', 'CCCC'])
  // frame timing is kept in the JSON; the base64 payloads are stripped from the text.
  assert.match((res.content[0]).text, /"frame": 30/)
  assert.doesNotMatch((res.content[0]).text, /AAAA/)
})

test('create_preview returns the renderId handle; get_preview returns the url when done', async () => {
  const mcp = await connect(
    fakeClient({
      createPreview: async (input) => ({ renderId: 'r1', bucketName: 'b1', fromFrame: 0, toFrame: 60, durationSeconds: 2, projectId: input.projectId }),
      getPreview: async () => ({ status: 'done', url: 'https://x/preview.mp4', estimatedCostUsd: 0.01 }),
    }),
  )
  const start = await mcp.callTool({ name: 'create_preview', arguments: { projectId: 'p1' } })
  assert.match((start.content[0]).text, /renderId="r1"/)
  assert.match((start.content[0]).text, /bucketName="b1"/)
  const poll = await mcp.callTool({ name: 'get_preview', arguments: { renderId: 'r1', bucketName: 'b1' } })
  assert.match((poll.content[0]).text, /https:\/\/x\/preview\.mp4/)
})

test('get_layer_types lists canvas layer types + props', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_layer_types', arguments: {} })
  const body = (res.content[0]).text
  assert.match(body, /Canvas layer types/)
  assert.match(body, /text/)
})

test('get_timeline_types lists clip + track types', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_timeline_types', arguments: {} })
  const body = (res.content[0]).text
  assert.match(body, /Track types/)
  assert.match(body, /media/)
})

test('get_project with includeRenderUrl surfaces the preview URL', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1', includeRenderUrl: true } })
  assert.match((res.content[0]).text, /Preview: https:\/\/x\/preview\.png/)
})

test('create_project returns the new id + revision', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'create_project', arguments: { kind: 'canvas', title: 'Deck' } })
  assert.ok(!res.isError)
  const body = (res.content[0]).text
  assert.match(body, /Created canvas project new1/)
  assert.match(body, /update_canvas/)
})

test('import_project (pptx) creates a canvas project from a file URL', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'import_project', arguments: { sourceType: 'pptx', fileUrl: 'https://x/deck.pptx' } })
  assert.ok(!res.isError)
  assert.match((res.content[0]).text, /Created canvas project imp1/)
})

test('import_project (pptx) without fileUrl is an error', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'import_project', arguments: { sourceType: 'pptx' } })
  assert.ok(res.isError)
})

test('export_project returns the download URL when it finishes in time', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'export_project', arguments: { projectId: 'p1', format: 'mp4' } })
  assert.ok(!res.isError)
  assert.match((res.content[0]).text, /completed/)
  assert.match((res.content[0]).text, /out\.mp4/)
})

test('get_export polls an export job', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_export', arguments: { exportId: 'exp1' } })
  assert.match((res.content[0]).text, /exp1/)
})

test('get_export_formats lists formats per surface', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_export_formats', arguments: {} })
  const body = (res.content[0]).text
  assert.match(body, /mp4/)
  assert.match(body, /pptx/)
})

test('delete_project requires confirm:true and reports the permanent delete', async () => {
  const mcp = await connect(fakeClient())
  // Missing confirm -> schema rejects before the handler runs.
  const missing = await mcp.callTool({ name: 'delete_project', arguments: { projectId: 'p1' } })
  assert.ok(missing.isError)
  const ok = await mcp.callTool({ name: 'delete_project', arguments: { projectId: 'p1', confirm: true } })
  assert.ok(!ok.isError)
  assert.match((ok.content[0]).text, /Permanently deleted project p1/)
})

test('update_timeline applies ops and reports the new revision', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'update_timeline',
    arguments: { projectId: 'p1', ops: [{ op: 'delete_clip', clipIds: ['a'] }], userIntent: 'cut' },
  })
  assert.ok(!res.isError)
  assert.match((res.content[0]).text, /Applied 1\/1 op\(s\)\. New revision: 5\./)
})

test('update_canvas routes canvas ops through the same endpoint', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'update_canvas',
    arguments: { projectId: 'canvas1', ops: [{ op: 'create_slide' }], userIntent: 'add slide' },
  })
  assert.match((res.content[0]).text, /Applied 1\/1 op\(s\)/)
})

test('list_media forwards the uploads source', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listMedia: async (opts) => {
        captured = opts
        return []
      },
    }),
  )
  await mcp.callTool({ name: 'list_media', arguments: { source: 'uploads' } })
  assert.equal(captured.source, 'uploads')
})

test('list_media surfaces an upload file name, duration, and url inline', async () => {
  const mcp = await connect(
    fakeClient({
      listMedia: async () => [
        {
          id: 'up-uuid-1',
          type: 'video',
          model: null,
          prompt: null,
          status: 'completed',
          createdAt: 't',
          variant: 0,
          url: 'https://cdn/editor-media-1.mp4',
          generationSize: 1,
          isFavorited: false,
          kind: 'upload',
          boardType: null,
          source: 'uploads',
          fileName: 'C0001.MP4',
          durationSeconds: 1792,
        },
      ],
    }),
  )
  const res = await mcp.callTool({ name: 'list_media', arguments: { source: 'uploads' } })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /C0001\.MP4/)
  assert.match(res.content[0].text, /1792s/)
  assert.match(res.content[0].text, /editor-media-1\.mp4/)
})

/**
 * 🚨🚨 AN UNDECLARED PARAMETER IS REFUSED, ON EVERY TOOL.
 *
 * Zod object schemas STRIP unknown keys by default, so before `registerTools` wrapped registration in
 * `.strict()`, all 85 tools accepted any parameter they did not declare, discarded it, and ran on whatever
 * survived. The caller got a success.
 *
 * MEASURED 2026-09-08 against production: `update_card` does not declare `ops`. A call passing `ops` had it
 * stripped, leaving only `cardId`, and answered "Updated: 01.3 Design Your Character" having written nothing.
 * A follow-up passing the nonsense op `__probe__` did the same. An agent running a batch of partial edits
 * collects a full set of success messages and zero writes, which is worse than an error because nothing
 * anywhere says the work did not happen.
 *
 * ⭐ THE PROPERTY WORTH PROTECTING IS "A SUCCESS MEANS A WRITE." These tests exist so that stays true.
 */
test('an undeclared parameter is REFUSED rather than silently dropped', async () => {
  const calls = []
  const mcp = await connect(
    fakeClient({ updateCard: async (args) => { calls.push(args); return { id: 'c1', title: 'T', status: 'draft' } } }),
  )

  const res = await mcp.callTool({
    name: 'update_card',
    arguments: { cardId: 'c1', ops: [{ op: '__probe__' }] },
  })

  assert.equal(res.isError, true, 'an undeclared `ops` must be an error, not a success')
  // ⭐ The half that matters: the write never ran. A rejection that still hit the backend would be worse
  // than the silent drop, because the caller would be told no while something changed.
  assert.equal(calls.length, 0, 'the backend must not be called when validation failed')
})

test('a declared parameter still works, so strictness did not break the surface', async () => {
  const calls = []
  const mcp = await connect(
    // ⚠️ `updateCard(cardId, patch)` is POSITIONAL, so the patch is the SECOND argument.
    fakeClient({ updateCard: async (cardId, patch) => { calls.push({ cardId, patch }); return { id: 'c1', title: 'New', status: 'draft' } } }),
  )

  const res = await mcp.callTool({ name: 'update_card', arguments: { cardId: 'c1', title: 'New' } })

  assert.notEqual(res.isError, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cardId, 'c1')
  assert.equal(calls[0].patch.title, 'New')
})

test('⚠️ nested passthrough ops survive strictness, because a timeline op has no fixed shape', async () => {
  // `update_timeline` declares `ops: z.array(z.object({ op: z.string() }).passthrough())`. Strictness applies
  // to the TOP-LEVEL argument object only; flattening that distinction would break every timeline edit.
  const calls = []
  const mcp = await connect(
    // ⚠️ The tool calls `applyEditorOps`, not `updateTimeline`. Named for the operation, not the tool.
    fakeClient({
      applyEditorOps: async (args) => {
        calls.push(args)
        // Same RESULT SHAPE as the default fake. A shape the formatter cannot read throws inside the handler
        // and surfaces as a tool error, which would look exactly like strictness rejecting the call.
        return { surface: 'editor', revision: 5, results: args.ops.map((o) => ({ op: o.op, opId: 'mock', ok: true })) }
      },
    }),
  )

  const res = await mcp.callTool({
    name: 'update_timeline',
    // `userIntent` is a DECLARED required field on this tool; omitting it is a real validation error and has
    // nothing to do with strictness. Including it is what makes this a test of passthrough.
    arguments: {
      projectId: 'p1',
      userIntent: 'nudge a clip',
      ops: [{ op: 'update_clip', clipId: 'c1', anythingElse: { nested: true } }],
    },
  })

  assert.notEqual(res.isError, true, 'a varied op payload must still be accepted: ' + JSON.stringify(res.content))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ops[0].anythingElse.nested, true, 'the op payload must arrive intact')
})
