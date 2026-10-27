import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ContentHero, GenerationTimeoutError, InsufficientCreditsError, LIST_SORTS, MEDIA_LIST_SOURCES, MEDIA_STOCK_COLLECTIONS, MEDIA_STOCK_ORIENTATIONS, SORT_ORDERS, toolDescription, AGENT_CONTRACT, AGENT_CONTRACT_VERSION } from '@contenthero/sdk'
import { buildServer, attachmentsFor, MEDIA_HOST } from './server.js'
import { completedResult } from './format.js'
import { createHash } from 'node:crypto'
import { GENERATION_WIDGET_URI, WIDGET_RESOURCE_META } from './widget-resource.js'
import { GENERATION_WIDGET_HTML, PACKAGE_VERSION } from './widget/generation.js'
import { statusPollCall } from '../widget/src/persist.js'
import { assertGroupsCoverTools, groupedToolNames, TOOL_GROUPS } from './groups.js'

/** A generation's outputs from their urls, in slot order, named the way the server names them (7.44). */
function outs(urls: readonly string[], id = 'Gen12345') {
  return urls.map((url, i) => {
    const mediaId = urls.length > 1 ? `${id}-${i + 1}` : id
    return { mediaId, status: 'succeeded', url, appUrl: `https://app.contenthero.ai/media/${mediaId}` }
  })
}


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

/**
 * The fake registry. The MCP holds no model list of its own, so listModels and getModel both read this, as the
 * server reads the database: an upscaler, a lip-sync model and a text-output audio model sit beside the generators.
 */
const FAKE_CATALOG = [
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
]

/** One model as getModel answers it: the catalog's own kind and medium over a full set of model fields. */
function withCatalogEntry(model) {
  const entry = FAKE_CATALOG.find((m) => m.modelId === model.modelId)
  return entry
    ? { ...model, contentType: entry.contentType, kind: entry.kind, capabilities: { ...model.capabilities, kind: entry.kind, outputType: entry.capabilities.outputType } }
    : model
}

/** A minimal fake of the SDK client; override any method per test. */
/** A generation as the status route answers for it: `state` is its `status`, settled only once it has settled. */
function outputStatus(gen) {
  const state = gen.status
  return { kind: 'output', id: gen.outputId, state, reason: gen.error ?? null, appUrl: gen.appUrl ?? null, progress: null, detail: gen }
}

function fakeClient(overrides = {}) {
  return {
    getAccount: async () => ({
      balance: 1234,
      available: 1200,
      held: 34,
      spentThisMonth: 300,
      spendCap: { limit: 5000, remaining: 4700, resetsAt: '2026-11-01T00:00:00Z' },
      tier: 'legend',
      autoTopupEnabled: true,
    }),
    transcribe: async () => ({
      outputId: 'tr1',
      transcript: 'hello there',
      language: 'en',
      wordCount: 2,
      durationSeconds: 1.5,
    }),
    listAvatars: async () => ({
      avatars: [{ id: 'av1', name: 'Taylan Test', imageUrl: 'https://cdn/face.png', defaultVoiceId: 'v1', isDefault: true, status: 'completed' }],
      nextCursor: null,
    }),
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
    listVoices: async () => ({
      voices: [{ voiceId: 'v1', name: "Taylan's Voice", provider: 'elevenlabs', isFavorited: true, previewUrl: 'https://cdn/p.mp3', lastUsedAt: 't' }],
      nextCursor: null,
    }),
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
    listMedia: async () => ({
      media: [
        { id: 'out-uuid-1', kind: 'image', model: 'nano-banana-2', prompt: 'a cat', status: 'completed', createdAt: 't', mediaId: 'Out12345-1', url: 'https://cdn/1.png', generationSize: 2, isFavorited: false, origin: null, boardType: null, source: 'creations', fileName: null, durationSeconds: null },
        { id: 'out-uuid-1', kind: 'image', model: 'nano-banana-2', prompt: 'a cat', status: 'completed', createdAt: 't', mediaId: 'Out12345-2', url: 'https://cdn/2.png', generationSize: 2, isFavorited: true, origin: null, boardType: null, source: 'creations', fileName: null, durationSeconds: null },
      ],
      nextCursor: null,
    }),
    getMedia: async (id) => ({
      id: 'out-uuid-1',
      type: 'image',
      model: 'nano-banana-2',
      prompt: 'a cat',
      status: 'completed',
      createdAt: 't',
      mediaId: id.includes('-2') ? 'Out12345-2' : 'Out12345',
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
        { mediaId: 'Out12345-1', url: 'https://cdn/1.png', status: 'completed', isFavorited: false, isArchived: false },
        { mediaId: 'Out12345-2', url: 'https://cdn/2.png', status: 'completed', isFavorited: true, isArchived: false },
      ],
      thumbnailUrl: null,
    }),
    getMediaBatch: async (items) => ({
      items: items.map((it) => {
        if ('url' in it) {
          return { ok: true, input: it, url: it.url, imageUrl: it.url, type: 'image', model: null, prompt: null, mediaId: null, otherMediaIds: [] }
        }
        // A bare id resolves to the primary (output 2 here), named in full; a `-<n>` names its own output.
        const n = /-(\d)$/.exec(it.mediaId)?.[1] ?? '2'
        return {
          ok: true,
          input: it,
          url: `https://cdn/${n}.png`,
          imageUrl: `https://cdn/${n}.png`,
          type: 'image',
          model: 'nano-banana-2',
          prompt: 'a cat',
          mediaId: `Out12345-${n}`,
          otherMediaIds: n === '2' ? ['Out12345-1'] : ['Out12345-2'],
        }
      }),
    }),
    listBrandKits: async () => ({
      brandKits: [{ id: 'bk1', name: 'ContentHero', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't' }],
      nextCursor: null,
    }),
    getBrandKit: async (id) => ({
      id,
      name: 'ContentHero',
      isDefault: true,
      isActive: true,
      isFavorited: false,
      isArchived: false,
      createdAt: 't',
      websiteUrls: ['https://contenthero.ai'],
      sourceType: 'manual',
      logos: [],
      brandColors: [{ hex: '#0B0B0F' }],
      typography: null,
      socialAccounts: [],
      assets: [],
      sections: [{ id: 's1', key: 'voice_and_tone', role: 'voice_and_tone', tab: 'voice', sectionName: 'Voice & Tone', width: 'full', version: 1, body: 'Confident and direct.', updatedAt: 't' }],
      brandAccounts: [{ platform: 'instagram', name: 'ContentHero', handle: 'contenthero', avatarUrl: null, followerCount: 100 }],
      inspirationAccounts: [],
      knowledge: [{ id: 'kn1', title: 'Origin', sourceType: 'note', sourceUrl: null, contentPreview: 'We started...' }],
    }),
    /**
     * ⚠️ `generate` IS THE GENERATE_* PATH NOW as well as the audio one: image, video, upscale and lip
     * sync submit and return a pollable pending result rather than waiting. They read only `outputId`
     * from this, so the completed audio shape serves both without a second fake.
     */
    generate: async () => ({ outputId: 'gen1', status: 'settled', outputs: outs(['https://cdn/a.mp3']) }),
    /** Still the path for `generate_audio` and anything else that genuinely waits for its result. */
    generateAndWait: async () => ({
      outputId: 'gen1',
      status: 'settled',
      contentType: 'image',
      modelId: 'nano-banana-2',
      outputs: outs(['https://cdn/x.png']),
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    getGeneration: async () => ({
      outputId: 'gen1',
      status: 'settled',
      contentType: 'video',
      modelId: 'veo-3.1-fast',
      outputs: outs(['https://cdn/v.mp4']),
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    waitForGeneration: async () => ({
      outputId: 'gen1',
      status: 'settled',
      contentType: 'video',
      modelId: 'veo-3.1-fast',
      outputs: outs(['https://cdn/v.mp4']),
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    // The status route, over whichever generation reads this fake carries: an output's status wraps its generation.
    async getStatus(id) {
      return outputStatus(await this.getGeneration(id))
    },
    // A snapshot of several, over whichever getStatus this fake carries.
    async getStatuses(targets) {
      return Promise.all(targets.map((t) => (typeof t === 'string' ? this.getStatus(t) : this.getStatus(t.id, { kind: t.kind }))))
    },
    // The SDK's rule, over whichever waitForGeneration this fake carries: each id finished or as last read.
    async waitForStatus(targets, opts) {
      return Promise.all(
        targets.map(async (t) => {
          const id = typeof t === 'string' ? t : t.id
          try {
            return outputStatus(await this.waitForGeneration(id, opts))
          } catch (err) {
            if (err?.lastStatus) return outputStatus(err.lastStatus)
            if (err?.generation) return outputStatus(err.generation)
            return this.getStatus(id)
          }
        }),
      )
    },
    generateBoardAndWait: async () => ({
      outputId: 'board1',
      status: 'settled',
      contentType: 'image',
      modelId: 'gpt-image-2',
      outputs: outs(['https://cdn/board.png']),
      error: null,
      createdAt: 't',
      completedAt: 't2',
    }),
    estimateCost: async () => ({ getCost: true, creditsEstimate: 7, modelId: 'nano-banana-2', contentType: 'image' }),
    estimateBoardCost: async () => ({ getCost: true, creditsEstimate: 6, contentType: 'image' }),
    // The fake registry. listModels and getModel both read it, as the server does: the MCP holds no list of its
    // own, so a model's kind and medium come from here at call time.
    listModels: async () => FAKE_CATALOG,
    getModel: async (modelId) => withCatalogEntry({
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
      nextCursor: null,
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
      notes: null,
      revision: 3,
      metadata: null,
      assets: [{ id: 'as1', assetType: 'image', assetId: null, assetUrl: 'https://cdn/a.png', displayName: null }],
      posts: [{ id: 'd1', connectedAccountId: 'ca1', platform: 'instagram', format: 'reel', status: 'draft', scheduledAt: null, publishedAt: null, platformSettings: { caption: 'Launch!', mediaItems: [{ url: 'https://cdn/x.png' }] } }],
      tags: ['contenthero', 'feature'],
    }),
    createCard: async (input) => ({ id: 'p-new', title: input.title, description: input.description ?? null, platform: input.platform, status: input.status ?? 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    updateCard: async (id, input) => ({ id, title: input.title ?? 'Launch clip', description: null, platform: 'instagram', status: input.status ?? 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }),
    listStages: async () => ({
      stages: [
        { id: 'st1', name: 'Ideation', slug: 'ideation', color: '#8B5CF6' },
        { id: 'st2', name: 'Published', slug: 'published', color: '#10B981' },
      ],
      space: { id: 'sp1', name: 'Product Development' },
    }),
    updatePostDestination: async (_cardId, destinationId, input) => ({ id: destinationId, connectedAccountId: input.connectedAccountId ?? 'ca1', platform: 'instagram', format: input.format ?? 'reel', status: input.status ?? 'draft', scheduledAt: null, publishedAt: null }),
    publishPost: async (cardId) => ({ cardId, results: [{ success: true, platform: 'instagram', destinationId: 'd1', url: 'https://instagram.com/p/x' }], publishedCount: 1, failedCount: 0 }),
    listTrackedAccounts: async (options) => {
      const all = [
        { id: 'ia1', platform: 'youtube', accountId: 'UC123', handle: 'mrbeast', name: 'MrBeast', avatarUrl: null, followerCount: 300_000_000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'inspiration' },
        { id: 'ba1', platform: 'instagram', accountId: '17841400000', handle: 'contenthero', name: 'ContentHero', avatarUrl: null, followerCount: 12000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'brand' },
      ]
      return { trackedAccounts: options?.accountType ? all.filter((a) => a.accountType === options.accountType) : all, nextCursor: null }
    },
    addTrackedAccounts: async (input) => ({
      trackedAccounts: [{ id: 'ta9', platform: 'youtube', accountId: 'UC9', handle: 'mkbhd', name: 'MKBHD', avatarUrl: null, followerCount: 19_000_000, lastSyncedAt: null, syncStatus: 'pending', accountType: input.accountType ?? 'inspiration', outcome: 'added' }],
      refused: input.accounts.slice(1).map((a) => ({ platform: a.platform ?? 'instagram', handleOrUrl: a.handleOrUrl })),
      refusal: input.accounts.length > 1
        ? { code: 'plan_limit', error: 'Tracking more than 3 accounts is part of the Hero plan. Upgrade to unlock it.', feature: 'inspiration_accounts', current: 3, limit: 3, plan: 'hero', actions: [{ id: 'upgrade', label: 'Upgrade', url: 'https://app/billing' }] }
        : null,
    }),
    removeTrackedAccount: async (id) => ({ id }),
    getTrackedAccount: async (id) => ({
      account: { id, platform: 'instagram', accountId: '17841400000', handle: 'contenthero', name: 'ContentHero', avatarUrl: null, followerCount: 12000, lastSyncedAt: 't', syncStatus: 'synced', accountType: 'brand' },
      contentCount: 50,
      totals: { views: 1_000_000, likes: 50_000, comments: 5_000 },
      averages: { views: 20_000, engagementRate: 0.055, outlierScore: 1.2 },
      topContent: [{ id: 'bc1', platform: 'instagram', contentType: 'reel', title: 'best reel', url: 'https://ig/bc1', thumbnailUrl: null, viewCount: 200_000, likeCount: 12_000, commentCount: 800, shareCount: 400, durationSeconds: 30, outlierScore: 2.1, engagementRate: 0.07, viewsPerFollower: 16, publishedAt: 't', sourceCreator: null, accountHandle: 'contenthero' }],
      recentContent: [],
    }),
    listContent: async () => ({
      content: [{ id: 'c1', platform: 'youtube', contentType: 'video', title: 'I gave away an island', url: 'https://yt/c1', thumbnailUrl: null, viewCount: 120_000_000, likeCount: 4_000_000, commentCount: 90_000, shareCount: null, durationSeconds: 600, outlierScore: 3.4, engagementRate: 0.05, viewsPerFollower: 0.4, publishedAt: 't', sourceCreator: 'MrBeast', accountHandle: 'mrbeast' }],
      total: 1,
      nextCursor: null,
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
      nextCursor: null,
    }),
    getBrandKnowledge: async (_id, knowledgeId) => ({ id: knowledgeId, title: 'Launch playbook', sourceType: 'text', sourceUrl: null, createdAt: 't', updatedAt: 't', content: 'Lead with the customer outcome.' }),
    searchBrandKnowledge: async (_id, query) => [{ knowledgeId: 'kn1', title: 'Launch playbook', content: `match for ${query}`, similarity: 0.82, sourceUrl: null, chunkIndex: 0 }],
    addBrandKnowledge: async (_id, input) => ({ id: 'kn-new', title: input.title ?? 'Untitled Resource', sourceType: input.sourceType, sourceUrl: input.url ?? null, createdAt: 't', updatedAt: 't' }),
    removeBrandKnowledge: async (_id, knowledgeId) => ({ id: knowledgeId }),
    listConnectedAccounts: async () => ({
      connectedAccounts: [{ id: 'ca1', platform: 'instagram', accountId: '178414', accountName: 'ContentHero', accountHandle: 'contenthero', accountUrl: 'https://instagram.com/contenthero', connectionStatus: 'connected', connectionType: 'oauth', capabilities: { publish: true, analytics: true }, isDefault: true, lastSyncedAt: 't', lastValidatedAt: 't', createdAt: 't' }],
      nextCursor: null,
    }),
    getConnectedAccount: async (id) => ({ id, platform: 'instagram', accountId: '178414', accountName: 'ContentHero', accountHandle: 'contenthero', accountUrl: 'https://instagram.com/contenthero', connectionStatus: 'connected', connectionType: 'oauth', capabilities: { publish: true, analytics: false }, isDefault: true, lastSyncedAt: 't', lastValidatedAt: 't', createdAt: 't' }),
    listTags: async () => ({
      tags: [
        { id: 't1', name: 'contenthero', isDefault: false, isSystem: false },
        { id: 't2', name: 'feature', isDefault: false, isSystem: false },
      ],
      nextCursor: null,
    }),
    createTag: async (name) => ({ id: 't-new', name: name.toLowerCase(), isDefault: false, isSystem: false }),
    updateTag: async (id, name) => ({ id, name: name.toLowerCase(), isDefault: false, isSystem: false }),
    deleteTag: async (id) => ({ id }),
    import: async (_input) => ({ outputId: 'im1', url: 'https://cloud/im1.png' }),
    favorite: async () => {},
    updateMedia: async (id, patch) => ({ mediaId: id, name: patch.name ?? 'Old', description: patch.description ?? null }),
    archive: async () => {},
    applyEditorOps: async (input) => ({ surface: input.projectId === 'canvas1' ? 'canvas' : 'editor', revision: 5, results: input.ops.map((o) => ({ op: o.op, opId: o.opId ?? 'mock-op-id', ok: true })) }),
    listProjects: async () => ({
      projects: [
        { id: 'p1', type: 'editor', surface: 'editor', kind: 'editor', title: 'My Edit', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null },
      ],
      nextCursor: null,
    }),
    getProject: async (projectId, options) => ({ id: projectId, type: 'editor', kind: 'editor', title: 'My Edit', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'editor', revision: 4, state: { tracks: [] }, assetReferences: [], brandKitId: null, exportedCardId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null }),
    view: async (input) => ({ live: { context: { surface: 'canvas', focusedSlideId: 's1', selectedLayerIds: ['l1'], snapshotUrl: 'https://x/snap.webp' }, participant: { userId: 'u1', sessionId: 'sess', surface: 'canvas', projectId: input?.projectId ?? 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }, participants: [{ userId: 'u1', sessionId: 'sess', surface: 'canvas', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }] } }),
    createProject: async (input) => ({ id: 'new1', type: input.type ?? 'editor', kind: input.type ?? 'editor', title: input.title ?? 'Untitled', orientation: input.orientation ?? '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: input.type ?? 'editor', revision: 0, state: {}, assetReferences: [], brandKitId: null, exportedCardId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null }),
    deleteProject: async () => {},
    importProject: async (input) => ({ id: 'imp1', type: 'canvas', kind: 'canvas', title: input.title ?? 'Imported deck', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'canvas', revision: 0, state: { slides: [] }, assetReferences: [], brandKitId: null, exportedCardId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null }),
    getLayerTypes: async () => ({ projectType: 'canvas', surface: 'canvas', description: 'canvas types', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, layerTypes: [{ type: 'text', description: 'text', props: [{ name: 'text', type: 'string' }], supports: ['transform'] }] }),
    getCodeGuide: async () => ({ version: 'abc12345', markdown: "# Writing a clip's code\n\nA clip's code is a React component.\n", compositionLongestEdge: 960, maxCodeBytes: 524288, modules: [], noImportNeeded: [], notAvailable: [], clockCalls: [], brandProps: [], examples: [] }),
    getTimelineTypes: async () => ({ projectType: 'editor', surface: 'editor', description: 'timeline types', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, clipTypes: [{ type: 'audio', description: 'audio', props: [{ name: 'audioUrl', type: 'string' }], supports: ['base'] }], trackTypes: [{ trackType: 'media', description: 'media', holds: ['video'] }] }),
    exportProjectAndWait: async (_projectId, input) => (input?.format && input.format !== 'mp4'
      ? { exportId: 'exp1', status: 'completed', outputUrl: 'https://x/out.zip', progress: 1 }
      : { exportId: 'exp1', status: 'completed', outputUrl: 'https://x/out.mp4', progress: 1 }),
    getExport: async (exportId) => ({ exportId, status: 'completed', outputUrl: 'https://x/out.mp4', progress: 1 }),
    getExportFormats: async () => ({ formats: [{ format: 'mp4', projectTypes: ['editor', 'canvas'], surfaces: ['editor', 'canvas'], async: true, description: 'video', options: ['resolution'] }, { format: 'pptx', projectTypes: ['canvas'], surfaces: ['canvas'], async: false, description: 'powerpoint', options: [] }], resolutions: ['720p', '1080p'], qualities: ['recommended'] }),
    ...overrides,
  }
}


/**
 * Every url a result carries, from wherever it carries it.
 *
 * ⚠️ TESTS USED TO MATCH THE TEXT BLOCK DIRECTLY, which pinned the FORMAT rather than the guarantee. When
 * the urls moved into `resource_link` blocks (they were being printed twice, once in prose and once by the
 * host rendering the link), five tests went red without anything being wrong. The promise these assert is
 * "a caller can find the asset", and this is that promise stated independently of where it lives.
 */
function urlsIn(result) {
  const parts = []
  for (const c of result.content ?? []) {
    if (c.type === 'text') parts.push(c.text)
    if (c.type === 'resource_link') parts.push(c.uri)
  }
  return parts.join('\n')
}

async function connect(client) {
  // analyze_content waits up to 40s in production; a test needs only the shape of the wait.
  const server = await buildServer({ getClient: () => client, jobWait: { waitMs: 300, pollMs: 50 } })
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
 * ended up taking `id` while its five sibling deletes each took a named one. `download` is universal too: its id
 * names a media item of any kind or an export, as the server reads it.
 */
test('single-resource tools name their id parameter after the resource', async () => {
  const UNIVERSAL = new Set(['favorite', 'archive', 'share', 'download'])
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const offenders = tools
    .filter((t) => !UNIVERSAL.has(t.name))
    .filter((t) => Object.keys(t.inputSchema?.properties ?? {}).includes('id'))
    .map((t) => t.name)
  assert.deepEqual(offenders, [], `tools taking a bare \`id\`: ${offenders.join(', ')}`)
})

test('no tool advertises an array without an item schema', async () => {
  // ⚠️ THE BUG THIS EXISTS FOR. `z.array(z.unknown())` serializes to {"type":"array","items":{}}, which tells
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

/**
 * 🚨 **EVERY TOOL DECLARES WHETHER IT IS READ-ONLY. TWO OF 88 DECLARED NOTHING.**
 *
 * MCP clients bucket a surface by `readOnlyHint`. A tool with NEITHER hint is not "safe by default", it is
 * UNCLASSIFIED: Claude files it under "Other", and a host that treats unknown as permissive gets it wrong.
 * `transcribe` and `create_preview` both shipped that way, each carrying a careful comment explaining they
 * were NOT read-only. **The reasoning was written down and the annotation never was.**
 *
 * ⛔ **THE GUARD BELOW COULD NOT SEE THEM, AND THAT IS THE LESSON.** It filters
 * `tools.filter(t => t.annotations?.readOnlyHint)` and asks "is anything wrongly marked read-only". A tool
 * with no annotations object fails that filter and is never examined, so the check that existed to police
 * this exact field was blind to the only two tools that got it wrong. A guard built from the surviving
 * population cannot see the extinct one.
 */
test('🚨 every tool declares whether it is read-only', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()

  const unannotated = tools
    .filter((t) => typeof t.annotations?.readOnlyHint !== 'boolean')
    .map((t) => t.name)

  assert.deepEqual(
    unannotated,
    [],
    `these tools declare no readOnlyHint, so clients cannot classify them: ${unannotated.join(', ')}`,
  )
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
 * Metered tools the SERVER cannot price, in whole or for one of their sources, each with the input the server
 * cannot price. A tool here with no getCost cannot be priced at all; one with getCost prices every source but that
 * input.
 *
 * This is a list of server limitations, not a list of tools we decided to skip, and it
 * must stay that way or it becomes the place missing preflights go to hide. Every entry
 * names the route that would have to change to remove it.
 *
 * None today: transcribe (audioUrl) left on 2026-10-12, when the route learned to price an audio file by its length.
 */
const METERED_WITHOUT_PREFLIGHT = new Map<string, string>()

/**
 * The declaration a tool makes when calling it costs the caller credits.
 *
 * An EXPLICIT marker, deliberately, because the first version of this guard inferred
 * "metered" by grepping descriptions for "credits" or "metered" and immediately flagged
 * two correct tools: update_timeline and update_canvas each mention that ONE op inside
 * them (video background removal) is metered, which is operation-level, not tool-level. A
 * guard that flags correct code gets switched off, so the signal has to be something a
 * tool states about itself rather than something a regex infers about its prose. The phrase is matched in any
 * case: most tools shout it, and analyze_content's approved description (2026-09-28) says it in a sentence.
 */
const SPEND_MARKER = /\bspends credits\b/i

test('spending is declared and priceable in both directions', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()

  const declares = (t) => SPEND_MARKER.test(t.description ?? '')
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
  //    An entry stays only while its source exists and, when the tool has getCost, getCost still says that source
  //    cannot be priced.
  const stale = [...METERED_WITHOUT_PREFLIGHT].filter(([n, input]) => {
    const t = tools.find((x) => x.name === n)
    if (!t) return true
    const props = (t.inputSchema?.properties ?? {}) as Record<string, { description?: string }>
    if (!props[input]) return true
    return hasPreflight(t) && !/cannot be priced/.test(props.getCost?.description ?? '')
  }).map(([n]) => n)
  assert.deepEqual(stale, [], `remove from METERED_WITHOUT_PREFLIGHT: ${stale.join(', ')}`)
})

test('get_account formats balance, tier, and top-up state', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_account', arguments: {} })
  const out = res.content[0].text
  assert.equal(
    out,
    [
      'Balance: 1234 credits, 1200 available (34 credits reserved for work in progress).',
      'Spent this month: 300 credits.',
      'Monthly spend cap: 5000 credits, 4700 left this month (resets 2026-11-01).',
      'Tier: legend. Auto top-up: on.',
    ].join('\n'),
  )
})

test('update_account changes only the fields passed (null removes the cap) and answers with the account', async () => {
  const sent: unknown[] = []
  const base = fakeClient()
  const mcp = await connect(
    fakeClient({
      updateAccount: async (fields: { spendCap?: number | null }) => {
        sent.push(fields)
        const cap = fields.spendCap
        return { ...(await base.getAccount()), spendCap: cap == null ? null : { limit: cap, remaining: cap - 300, resetsAt: '2026-11-01T00:00:00Z' } }
      },
    }),
  )
  const set = await mcp.callTool({ name: 'update_account', arguments: { spendCap: 25000 } })
  assert.match(set.content[0].text, /^Monthly spend cap: 25000 credits, 24700 left this month \(resets 2026-11-01\)\.$/m)
  const removed = await mcp.callTool({ name: 'update_account', arguments: { spendCap: null } })
  assert.match(removed.content[0].text, /^Monthly spend cap: none\.$/m)
  assert.deepEqual(sent, [{ spendCap: 25000 }, { spendCap: null }])
  const refused = await mcp.callTool({ name: 'update_account', arguments: { spendCap: 0 } })
  assert.equal(refused.isError, true)
  assert.equal(sent.length, 2)
})

test('generate_image submits and hands back a pollable id, rather than waiting', async () => {
  /**
   * ⭐⭐⭐ THE CONTRACT CHANGED ON PURPOSE, AND THIS IS THE ASSERTION THAT SAYS SO.
   *
   * It used to wait inline for up to 50 seconds and return finished urls. A widget mounts when the TOOL
   * RESULT arrives, so any job finishing inside that window produced a card that was already full: the
   * skeletons and the fill-in were unreachable for every generation fast enough to matter. Submitting and
   * returning means the card exists while there is progress to show.
   */
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'nano-banana-2', prompt: 'a cat' },
  })
  assert.ok(!res.isError)
  // The id is what makes it resumable: the job is running and charged whether or not anyone polls.
  assert.match(res.content[0].text, /gen1/)
  assert.match(res.content[0].text, /get_status/)
  // And the payload the widget draws its placeholders from.
  assert.equal((res.structuredContent as { status?: string })?.status, 'processing')
})

test('generate_video surfaces a smart-wait timeout as a pollable pending result', async () => {
  const mcp = await connect(
    fakeClient({
      generate: async () => {
        throw new GenerationTimeoutError('pending-99')
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_video',
    arguments: { modelId: 'veo-3.1-fast', prompt: 'a city at dusk' },
  })
  assert.match(res.content[0].text, /pending-99/)
  assert.match(res.content[0].text, /get_status/)
  assert.ok(!res.isError)
})

test('generate_board returns the board URL on completion', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_board',
    arguments: { boardType: 'character', prompt: 'a stoic ranger' },
  })
  assert.match(urlsIn(res), /https:\/\/cdn\/board\.png/)
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
  assert.match(res.content[0].text, /get_status/)
  assert.ok(!res.isError)
})

test('generate_board passes any boardType to the server, whose list is the only one', async () => {
  let sent: unknown
  const mcp = await connect(
    fakeClient({
      generateBoardAndWait: async (req: { boardType: string }) => {
        sent = req.boardType
        throw Object.assign(new Error('Invalid or missing boardType. Expected one of: character, pose.'), { status: 400 })
      },
    }),
  )
  const res = await mcp.callTool({ name: 'generate_board', arguments: { boardType: 'not-a-type', prompt: 'x' } })
  assert.equal(sent, 'not-a-type')
  assert.equal(res.isError, true)
  assert.match((res.content as Array<{ text: string }>)[0].text, /Expected one of/)
})

/**
 * ⭐ THIS REPLACES A TEST THAT PINNED THE OLD BEHAVIOR ("generate_image forwards mode via the
 * parameters passthrough"). `mode` named a paid TIER the model id did not carry, so the id the
 * agent named was not the thing it was billed for. Each tier is now its own registry model, and a
 * test asserting the old forwarding would argue against the fix every time someone ran it.
 */
test('a retired tier mode never reaches the wire', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generate: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'settled', contentType: 'image', modelId: 'gpt-image-2',
          outputs: outs(['https://cdn/x.png']), error: null, createdAt: 't', completedAt: 't2',
        }
      },
    }),
  )
  const res = await mcp
    .callTool({ name: 'generate_image', arguments: { modelId: 'gpt-image-2', prompt: 'x', mode: 'flex' } })
    .catch((err) => ({ rejected: err }))

  /**
   * ⭐ THE SCHEMA REFUSES IT RATHER THAN DROPPING IT, which is better than either alternative and is
   * what this pins. The first draft of this test assumed the arg would be silently stripped and the
   * handler would still run; it failed because `generate` was never reached at all. An agent that
   * passes the retired tier param is TOLD, instead of quietly getting the base tier and its price.
   */
  assert.equal(captured, undefined, 'the generate call must not run with a retired tier param')
  const refused = 'rejected' in (res as Record<string, unknown>) || (res as { isError?: boolean }).isError === true
  assert.ok(refused, 'passing `mode` must surface an error, not pass silently')
})

test('the generate_image schema no longer advertises a mode parameter', async () => {
  // ⚠️ THE SCHEMA IS THE CONTRACT, AND DROPPING AN ARG SILENTLY IS NOT THE SAME AS NOT OFFERING IT.
  // Without this, `mode` could be re-added to the schema and the test above would still pass.
  const mcp = await connect(fakeClient({}))
  const { tools } = await mcp.listTools()
  const gen = tools.find((t) => t.name === 'generate_image')
  assert.ok(gen, 'generate_image must exist')
  assert.equal(gen.inputSchema?.properties?.mode, undefined)
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
      generate: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'settled', contentType: 'image', modelId: 'gpt-image-2',
          outputs: outs(['https://cdn/look.png']), error: null, createdAt: 't', completedAt: 't2',
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
          outputId: 'b', status: 'settled', contentType: 'image', modelId: 'board',
          outputs: outs(['https://cdn/board.png']), error: null, createdAt: 't', completedAt: 't2',
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

test('generate_video forwards keepInputLength, described in the approved words', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generate: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'settled', contentType: 'video', modelId: 'veo-3.1-fast',
          outputs: outs(['https://cdn/v.mp4']), error: null, createdAt: 't', completedAt: 't2',
        }
      },
    }),
  )
  const { tools } = await mcp.listTools()
  const field = tools.find((t) => t.name === 'generate_video').inputSchema.properties.keepInputLength
  assert.equal(
    field.description,
    "Video edit only, on models that offer it: keep the input video's full length instead of a set duration. Charged for that length.",
  )
  // Forwarding is model-agnostic; whether the model and mode offer it is decided server-side.
  await mcp.callTool({
    name: 'generate_video',
    arguments: { modelId: 'veo-3.1-fast', prompt: 'x', referenceVideos: ['https://cdn/s.mp4'], keepInputLength: true },
  })
  assert.equal(captured.keepInputLength, true)
  assert.equal(captured.duration, undefined)
})

test('generate_video forwards wan multiShot and reference audio', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generate: async (req) => {
        captured = req
        return {
          outputId: 'g', status: 'settled', contentType: 'video', modelId: 'veo-3.1-fast',
          outputs: outs(['https://cdn/v.mp4']), error: null, createdAt: 't', completedAt: 't2',
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

test('list_media forwards the origin filter', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listMedia: async (opts) => {
        captured = opts
        return { media: [], nextCursor: null }
      },
    }),
  )
  await mcp.callTool({ name: 'list_media', arguments: { origin: 'board' } })
  assert.equal(captured.origin, 'board')
})

test('generate_audio returns the audio URL synchronously', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'generate_audio',
    arguments: { modelId: 'elevenlabs-tts', text: 'hello', voiceId: 'v1' },
  })
  assert.match(urlsIn(res), /https:\/\/cdn\/a\.mp3/)
})

test('a limit refusal comes back as an isError result: the message as written, then the ranked ways out', async () => {
  const mcp = await connect(
    fakeClient({
      generate: async () => {
        throw new InsufficientCreditsError("You don't have enough credits for this one. It needs 10 credits, and you have 2 available.", {
          needed: 10,
          available: 2,
          actions: [
            { id: 'auto_top_up', label: 'Turn on auto top-up', url: 'https://app.contenthero.ai/billing#auto-topup' },
            { id: 'top_up', label: 'Top up credits', url: 'https://app.contenthero.ai/billing?open=top-up' },
          ],
        })
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'generate_image',
    arguments: { modelId: 'nano-banana-2', prompt: 'x' },
  })
  assert.equal(res.isError, true)
  assert.equal(
    res.content[0].text,
    [
      "You don't have enough credits for this one. It needs 10 credits, and you have 2 available.",
      'Ways to continue:',
      '- Turn on auto top-up: https://app.contenthero.ai/billing#auto-topup',
      '- Top up credits: https://app.contenthero.ai/billing?open=top-up',
    ].join('\n'),
  )
})

test('rejects an unknown model at the schema boundary', async () => {
  // A video model on the image tool must never reach the client. Depending on
  // SDK version this surfaces as a rejected promise or an isError result; both
  // mean the enum guardrail held and the handler was not invoked.
  const mcp = await connect(
    fakeClient({
      generate: async () => {
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

test('get_status blocks by default and returns the final URLs', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['gen1'] } })
  assert.match(urlsIn(res), /https:\/\/cdn\/v\.mp4/)
  assert.ok(!res.isError)
})

test('import of a url waits within the call, and hands back the outputId as pending when the job is still running', async () => {
  let options
  const mcp = await connect(fakeClient({ import: async (_input, opts) => { options = opts; throw new GenerationTimeoutError('im9') } }))
  const res = await mcp.callTool({ name: 'import', arguments: { url: 'https://example.com/a.mp4' } })
  assert.deepEqual(options, { timeoutMs: 300, pollIntervalMs: 50 })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /Import im9 is still running/)
  assert.match(res.content[0].text, /get_status \{ ids: \["im9"\], kind: "output" \}/)
})

test('get_status: a settled import says where the bytes already are, and never asks to poll again', async () => {
  const dup = { outputId: 'old1', shortId: 'Old00001', appUrl: 'https://app/media/Old00001', url: 'https://cdn/old.png', objectName: 'u/old.png', role: 'original', ownedBy: 'studio_outputs' }
  const abandoned = (id, extra = {}) => ({ outputId: id, status: 'settled', contentType: 'image', modelId: 'import', outputs: outs([]), error: null, ...extra })
  const mcp = await connect(fakeClient({ waitForGeneration: async (id) => abandoned(id, id === 'imp1' ? { alreadyExisted: dup } : {}) }))
  const dupRes = await mcp.callTool({ name: 'get_status', arguments: { ids: ['imp1'] } })
  assert.match(dupRes.content[0].text, /Already in your library/)
  assert.match(dupRes.content[0].text, /https:\/\/cdn\/old\.png/)
  const other = await mcp.callTool({ name: 'get_status', arguments: { ids: ['voice1'] } })
  assert.doesNotMatch(other.content[0].text, /again/)
})

test('get_status takes wait:false for an instant snapshot', async () => {
  let waited = false
  const mcp = await connect(
    fakeClient({
      waitForGeneration: async (id) => {
        waited = true
        return { outputId: id, status: 'settled', contentType: 'video', outputs: outs(['https://cdn/v.mp4']), error: null }
      },
    }),
  )
  await mcp.callTool({ name: 'get_status', arguments: { ids: ['gen1'], wait: false } })
  // The direction that used to live in the tool NAME is an argument now, so this must not block.
  assert.equal(waited, false)
})

test('get_status checks several ids in one call', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['gen1', 'gen2'] } })
  assert.match(res.content[0].text, /2 generation\(s\)/)
})

/**
 * get_status reads any background job. A job that is not a generation answers one line each: kind, id, state, why it
 * failed, progress, steps and its link, with the call to make again while any is unfinished. Break-verified: routing a
 * non-output status into the generation formatter turns the first red; dropping `kind` from the read turns the second.
 */
test('get_status answers an export, a brand kit read and a failed avatar one line each, and says how to re-poll', async () => {
  const statuses = {
    Exp12345: { kind: 'export', id: 'Exp12345', state: 'processing', reason: null, appUrl: 'https://app/e', progress: 0.42, detail: {} },
    Bk123456: {
      kind: 'brand_kit', id: 'Bk123456', state: 'processing', reason: null, appUrl: 'https://app/b', progress: null,
      steps: [{ name: 'website', state: 'completed', reason: null }, { name: 'analysis', state: 'processing', reason: null }], detail: {},
    },
    Av123456: { kind: 'avatar', id: 'Av123456', state: 'failed', reason: 'no face found', appUrl: null, progress: null, detail: {} },
  }
  const mcp = await connect(fakeClient({ waitForStatus: async (targets) => targets.map((t) => statuses[t.id]) }))
  const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['Exp12345', 'Bk123456', 'Av123456'] } })
  const out = res.content[0].text
  assert.match(out, /3 job\(s\):/)
  assert.match(out, /- export Exp12345: processing \| progress: 42% \| https:\/\/app\/e \[poll_after_seconds: \d+\]/)
  assert.match(out, /- brand_kit Bk123456: processing \| steps: website completed, analysis processing/)
  assert.match(out, /- avatar Av123456: failed \| reason: no face found$/m)
  assert.match(out, /get_status \{ ids: \["Exp12345", "Bk123456"\] \}/)
  assert.ok(!res.isError, 'one failed job among running ones is an answer, not an error')
  assert.equal(res._meta, undefined, 'a status answer never mounts a card')
})

/**
 * One id that names nothing never fails the others (found live 2026-10-10: two ids, one unknown, and the whole call
 * answered "Export not found"). Runs the real SDK over a fake server, so the rule is held where it lives (the SDK's
 * per-id answer) and where it is read (one line per id). Break-verified: letting `unansweredOrThrow` rethrow a 404
 * turns both calls red.
 */
test('get_status answers each id on its own: one that names nothing is its own line, and the rest still answer', async () => {
  const fetch = async (url) => {
    const id = url.split('/').pop().split('?')[0]
    if (id === 'Exp12345') {
      return new Response(
        JSON.stringify({ kind: 'export', id, state: 'settled', reason: null, appUrl: 'https://app/exports/Exp12345', progress: 1, detail: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (id === 'Theirs12') {
      return new Response(JSON.stringify({ error: `Export '${id}' not found in your account.` }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: `'${id}' names nothing.` }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
  const mcp = await connect(new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://x.test' }))
  for (const wait of [true, false]) {
    const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['Exp12345', 'Nope1234', 'Theirs12'], wait } })
    const out = res.content[0].text
    assert.match(out, /3 job\(s\):/)
    assert.match(out, /- export Exp12345: settled \| progress: 100% \| https:\/\/app\/exports\/Exp12345/)
    assert.match(out, /- Nope1234: not found \| 'Nope1234' names nothing\./)
    assert.match(out, /- Theirs12: not found \| Export 'Theirs12' not found in your account\./)
    assert.ok(!res.isError, `wait ${wait}: one unknown id beside a found one is an answer, not an error`)
  }
  // Every id unanswered is an error, still one line each.
  const none = await mcp.callTool({ name: 'get_status', arguments: { ids: ['Nope1234'], wait: false } })
  assert.equal(none.isError, true)
  assert.match(none.content[0].text, /^- Nope1234: not found \| 'Nope1234' names nothing\.$/)
})

test('get_status passes kind through, and a lone finished transcript reads as done', async () => {
  let asked
  const mcp = await connect(
    fakeClient({
      getStatus: async (id, opts) => {
        asked = { id, kind: opts?.kind }
        return { kind: 'transcript', id, state: 'settled', reason: null, appUrl: null, progress: null, detail: { status: 'ready', mediaId: id } }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['Med12345'], kind: 'transcript', wait: false } })
  assert.deepEqual(asked, { id: 'Med12345', kind: 'transcript' })
  assert.match(res.content[0].text, /^- transcript Med12345: settled$/)
  assert.doesNotMatch(res.content[0].text, /poll_after_seconds|again/)
})

test('get_status: a running scene map keeps its kind in the call to make again, beside a job its id names alone', async () => {
  const mcp = await connect(
    fakeClient({
      getStatus: async (id, opts) =>
        opts?.kind === 'scenes'
          ? { kind: 'scenes', id, state: 'processing', reason: null, appUrl: null, progress: null, detail: { status: 'running' } }
          : { kind: 'export', id, state: 'processing', reason: null, appUrl: null, progress: 0.5, detail: {} },
    }),
  )
  const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['Pc4tSc3n'], kind: 'scenes', wait: false } })
  assert.match(res.content[0].text, /^- scenes Pc4tSc3n: processing/)
  // Without its kind the post's id would name the post's analysis, a different job.
  assert.match(res.content[0].text, /call get_status \{ ids: \["Pc4tSc3n"\], kind: "scenes" \} again/)
  const mixed = await mcp.callTool({ name: 'get_status', arguments: { ids: ['Exp12345'], wait: false } })
  assert.match(mixed.content[0].text, /call get_status \{ ids: \["Exp12345"\] \} again/)
})

test('get_status refuses a kind it does not know', async () => {
  const mcp = await connect(fakeClient())
  let refused = false
  try {
    const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['x'], kind: 'project' } })
    refused = res.isError === true
  } catch {
    refused = true
  }
  assert.ok(refused)
})

/**
 * The generation card polls the server by itself. Its call is built by `statusPollCall`, and this runs that exact call
 * against the real tool: the schema must accept it, and the answer must carry the card payload the widget merges.
 * Break-verified: the old tool name, the old `outputIds` argument, or a poll with no kind turns this red.
 */
test('the widget polls with get_status, and the answer carries the finished card', async () => {
  const mcp = await connect(fakeClient())
  const call = statusPollCall('gen1')
  assert.equal(call.name, 'get_status')
  // The card holds the output's full id, which the status route places only with its kind.
  assert.equal(call.arguments.kind, 'output')
  const res = await mcp.callTool(call)
  assert.ok(!res.isError, res.content?.[0]?.text)
  const sc = res.structuredContent
  assert.equal(sc.outputId, 'gen1')
  assert.notEqual(sc.status, 'processing')
  assert.ok(sc.items.some((i) => /https:\/\/cdn\/v\.mp4/.test(i.url)), JSON.stringify(sc))
  assert.equal(res._meta, undefined, 'the poll answers the card; it never mounts a second one')
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

/**
 * ⛔⛔ THE REGISTRY IS THE ONLY MODEL LIST, AND THE SERVER CHECKS EVERY ID AGAINST IT.
 *
 * Each generate tool used to carry an enum of model ids, built at startup from the catalog or, when that read failed,
 * from a hardcoded copy (the hosted server used the copy always). The copy drifted: measured 2026-10-05 it still
 * offered a disabled model, lacked six enabled ones, and its guidance led with a model the registry does not default
 * to. So a tool takes any id, says what work it asks for, and the server refuses a model of another kind against the
 * registry, naming the models that do that work. These are the two halves the MCP owns.
 */
test('every generate tool tells the server the work it asks for', async () => {
  const sent = []
  const mcp = await connect(
    fakeClient({
      generate: async (request) => {
        sent.push(request)
        return { outputId: `g${sent.length}`, appUrl: 'https://app/x', status: 'processing' }
      },
    }),
  )
  const call = (name, args) => mcp.callTool({ name, arguments: args })
  await call('generate_image', { modelId: 'sentinel-image-model', prompt: 'x' })
  await call('generate_video', { modelId: 'veo-3.1-fast', prompt: 'x' })
  await call('upscale', { modelId: 'topaz-image-upscale', sourceUrl: 'https://cdn/in.png', factor: '2x' })
  await call('upscale', { modelId: 'topaz-video-upscale', sourceUrl: 'https://cdn/in.mp4', factor: '2x', durationSeconds: 4 })
  await call('generate_lip_sync', { modelId: 'infinitalk', imageUrl: 'https://cdn/face.png', audioUrl: 'https://cdn/v.mp3' })
  assert.deepEqual(
    sent.map((r) => [r.modelId, r.contentType, r.kind]),
    [
      ['sentinel-image-model', 'image', 'generate'],
      ['veo-3.1-fast', 'video', 'generate'],
      // An upscaler's medium is the registry's answer, asked at call time: the source rides where the model reads it.
      ['topaz-image-upscale', 'image', 'upscale'],
      ['topaz-video-upscale', 'video', 'upscale'],
      ['infinitalk', 'video', 'lip-sync'],
    ],
  )
  assert.deepEqual(sent[2].references, { images: ['https://cdn/in.png'] })
  assert.deepEqual(sent[3].references, { videos: ['https://cdn/in.mp4'] })
})

test("a model that does other work comes back as the server's refusal, naming the models to use", async () => {
  const refusal = "Model 'topaz-image-upscale' is for image upscale, and this call asks for image generation. Image generation models: nano-banana-2, gpt-image-2."
  const mcp = await connect(
    fakeClient({
      generate: async () => {
        throw Object.assign(new Error(refusal), { status: 400 })
      },
    }),
  )
  const res = await mcp.callTool({ name: 'generate_image', arguments: { modelId: 'topaz-image-upscale', prompt: 'x' } })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /Image generation models: nano-banana-2, gpt-image-2/)
})

test('the MCP package names no model and takes no model enum', () => {
  // A list here is a copy of the registry, and a copy drifts. Model ids appear only in tests.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  // src/models.ts held the board types until 7.52; the server's list is the only one now (get_model('reference-boards')).
  const files = ['src/server.ts', 'src/format.ts', 'src/index.ts']
  for (const f of files) {
    const code = strip(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
    assert.doesNotMatch(code, /\b(veo|seedance|nano-banana|gpt-image|seedream|kling-\d|wan-2|sora|elevenlabs-|topaz|infinitalk|auphonic)[\w.-]*/i, `${f} names a model`)
    assert.doesNotMatch(code, /modelId:\s*z\s*\.enum\(/, `${f} gives a modelId an enum`)
    assert.doesNotMatch(code, /FALLBACK|resolveModelEnums/, `${f} keeps a fallback model list`)
    assert.doesNotMatch(code, /BOARD_TYPES|'mascot'/, `${f} keeps a copy of the board types`)
  }
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
  // ⚠️ SUBMITS AND RETURNS, like every other generate_* tool: an upscale is work in progress, and its card
  // should exist while the work is happening rather than appearing already finished.
  assert.match(res.content[0].text, /gen1/)
  assert.match(res.content[0].text, /get_status/)
})


test('generate_lip_sync (script mode) builds a portrait + script request and returns the video', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generate: async (request) => {
        captured = request
        return {
          outputId: 'ls1',
          status: 'settled',
          contentType: 'video',
          modelId: 'infinitalk',
          outputs: outs(['https://cdn/talk.mp4']),
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
  // ⚠️ The REQUEST is what this test is about, and it still is. The result is now a pollable pending id
  // rather than a finished url, because the card has to exist while the work is happening.
  assert.match(res.content[0].text, /get_status/)
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
      generate: async (request) => {
        captured = request
        return {
          outputId: 'ls2',
          status: 'settled',
          contentType: 'video',
          modelId: 'infinitalk',
          outputs: outs(['https://cdn/talk2.mp4']),
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



test('list_avatars surfaces the id, base image, and default voice', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_avatars', arguments: {} })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /Taylan Test/)
  assert.match(res.content[0].text, /av1/)
  assert.match(urlsIn(res), /https:\/\/cdn\/face\.png/)
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
  assert.match(urlsIn(res), /https:\/\/cdn\/look\.png/)
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
  assert.match(body, /get_status \{ ids: \["av-new"\], kind: "avatar" \}/, 'the wait is get_status, named as a call it accepts')
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
  assert.match(res.content[0].text, /image/)
  // Two outputs of one generation render as two rows, each named by its own media id, the favorited one tagged.
  assert.match(res.content[0].text, /media Out12345-1/)
  assert.match(res.content[0].text, /media Out12345-2/)
  // Each row says it has a sibling without claiming a number: output 2's row is not "1 of 2".
  assert.match(res.content[0].text, /one of 2 outputs/)
  assert.doesNotMatch(res.content[0].text, /\b1 of 2\b/)
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
              kind: 'image',
              model: 'nano-banana-2',
              prompt: 'a cat',
              mediaId: 'Out12345-2',
              otherMediaIds: ['Out12345-1'],
            },
          ],
        }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'get_media',
    arguments: { items: [{ mediaId: 'Out12345-2' }] },
  })
  assert.ok(!res.isError)
  assert.deepEqual(capturedItems, [{ mediaId: 'Out12345-2' }])
  assert.match(res.content[0].text, /image Out12345-2/)
  assert.match(urlsIn(res), /https:\/\/cdn\/2\.png/)
  assert.match(res.content[0].text, /other outputs: Out12345-1/)
})

/**
 * get_media reports an audio file's recorded facts (the app's batch read carries `audio`, 2026-10-22), in the one
 * wording the CLI and the single read share. Facts are said only when known, and an item without any has no audio line.
 */
test('get_media prints an audio item\'s recorded facts, only the ones known, and nothing when none are', async () => {
  const mcp = await connect(
    fakeClient({
      getMediaBatch: async (items) => ({
        items: [
          { ok: true, input: items[0], url: 'https://cdn/a.mp3', type: 'audio', mediaId: 'Aud00001', otherMediaIds: [], durationSeconds: 30,
            audio: { sizeBytes: 480000, mimeType: 'audio/mpeg', durationSeconds: 30, derivedBitrateKbps: 128 } },
          { ok: true, input: items[1], url: 'https://cdn/b.wav', type: 'audio', mediaId: 'Aud00002', otherMediaIds: [],
            audio: { sizeBytes: 1000, mimeType: 'audio/wav' } },
          { ok: true, input: items[2], url: 'https://cdn/c.mp3', type: 'audio', mediaId: 'Aud00003', otherMediaIds: [] },
        ],
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'Aud00001' }, { mediaId: 'Aud00002' }, { mediaId: 'Aud00003' }] } })
  assert.ok(!res.isError)
  const text = res.content.map((c) => c.text ?? '').join('\n')
  const blocks = text.split(/\n(?=\[\d+\] )/)
  assert.match(blocks[1], /\n    audio: audio\/mpeg, .*30\.00s, 128 kbps mean \(derived from size and duration\)/)
  assert.match(blocks[2], /\n    audio: audio\/wav, /)
  assert.doesNotMatch(blocks[2], /kbps/)
  assert.doesNotMatch(blocks[3], /\n    audio: /)
})

/**
 * get_media reads no clip frames: its items take no window, a video's keyframes are not shown even if a server sent
 * them, and its description points a clip to view. Break-verified: restoring the `frames` and `fromSec` fields on the
 * mediaId item schema turns the first assertion red (the item is closed, so the call is refused);
 * restoring the video keyframe sentence in the description turns the last two red.
 */
test('get_media takes no clip window and points a clip to view', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      getMediaBatch: async (items) => {
        captured = items
        return {
          items: [
            {
              ok: true, input: items[0], url: 'https://cdn/clip.mp4', imageUrl: null, kind: 'video', model: null, prompt: null,
              mediaId: 'vid-1', otherMediaIds: [], keyframes: [{ atSec: 0, dataUrl: 'data:image/jpeg;base64,AAAA' }],
            },
          ],
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'vid-1' }] } })
  // The item is a closed object, so a clip window is refused rather than silently dropped.
  const windowed = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'vid-1', frames: 2, fromSec: 0, toSec: 5, frameWidth: 640 }] } })
  assert.equal(windowed.isError, true)
  assert.equal((captured as { mediaId: string }[])[0]!.mediaId, 'vid-1')
  assert.equal(res.content.filter((c) => c.type === 'image').length, 0)
  assert.match(res.content[0].text, /\(video: no still available for this view; use the url\)/)
  const { tools } = await mcp.listTools()
  const getMedia = tools.find((t) => t.name === 'get_media')
  assert.doesNotMatch(getMedia.description, /keyframe|fromSec/i)
  // The contract declares no clip window on an item, so none is listed.
  assert.doesNotMatch(JSON.stringify(getMedia.inputSchema), /fromSec|toSec|frameWidth/)
  assert.match(getMedia.description, /To see a clip's frames, use view;/)
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

test("get_schema kind 'platform' with no platform lists the platforms, formats, and the connected flag", async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'platform' } })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /instagram \(Instagram\) \[connected\]/)
  assert.match(res.content[0].text, /youtube \(YouTube\)/)
  // Points the agent to the one-platform read for the full shape.
  assert.match(res.content[0].text, /get_schema \(kind 'platform', with the platform/)
})

test("get_schema kind 'platform' passes platform + format through and renders the field shape", async () => {
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
    name: 'get_schema',
    arguments: { kind: 'platform', platform: 'instagram', format: 'post' },
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
          isDefault: true,
          isActive: true,
          isFavorited: false,
          isArchived: false,
          createdAt: 't',
          websiteUrls: [],
          sourceType: null,
          logos: [],
          brandColors: [],
          typography: null,
          socialAccounts: [],
          assets: [],
          sections: [{ id: 's1', key: 'voice_and_tone', role: 'voice_and_tone', tab: 'voice', sectionName: 'Voice & Tone', width: 'full', version: 1, body: 'confident', updatedAt: 't' }],
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
  // The full kit comes back as JSON, so nested field content is intact.
  assert.match(res.content[0].text, /"key": "voice_and_tone"/)
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


test('transcribe a tracked post: priced with getCost, followed while it runs, word-timed once done', async () => {
  const calls = []
  const mcp = await connect(
    fakeClient({
      estimateTranscribeCost: async (req) => {
        calls.push(['cost', req])
        return { getCost: true, creditsEstimate: 6, contentId: req.contentId, ...(req.slide !== undefined ? { slide: req.slide } : {}) }
      },
      transcribe: async (req) => {
        calls.push(['run', req])
        if (req.slide === 1) return { status: 'running', contentId: 'c1', slide: 1, charge: { credits: 0, held: 6, state: 'pending', balanceAfter: null } }
        return { status: 'completed', contentId: 'c1', transcript: 'one two three', language: 'en', wordCount: 3, durationSeconds: 4, charge: { credits: 6, held: 0, state: 'charged', balanceAfter: 94 } }
      },
    }),
  )
  const cost = await mcp.callTool({ name: 'transcribe', arguments: { contentId: 'c1', getCost: true } })
  assert.equal(cost.content[0].text, "Transcribing post c1 costs 6 credits, priced from its video's length and charged for what is heard. Nothing ran and nothing was charged.")

  const running = await mcp.callTool({ name: 'transcribe', arguments: { contentId: 'c1', slide: 1 } })
  assert.ok(!running.isError)
  assert.match(running.content[0].text, /^Still transcribing post c1, slide 1\. Call transcribe again with contentId "c1" and slide 1 to follow it, which is free\./)
  assert.match(running.content[0].text, /Estimated cost: 6 credits/)

  const done = await mcp.callTool({ name: 'transcribe', arguments: { contentId: 'c1' } })
  const out = done.content[0].text
  assert.match(out, /^Transcript of post c1 \(en\), 3 words:\n\none two three\n\nget_content with transcript='segments' returns it word-timed\./)
  assert.match(out, /Cost: 6 credits charged\./)
  assert.deepEqual(calls, [['cost', { contentId: 'c1' }], ['run', { contentId: 'c1', slide: 1 }], ['run', { contentId: 'c1' }]])
})

test('transcribe prices an audio file by its length, and says when it cannot', async () => {
  const asked = []
  let price = { getCost: true, audioUrl: 'https://cdn/a.mp3', creditsEstimate: 3, durationSeconds: 61.6 }
  const mcp = await connect(fakeClient({
    estimateTranscribeCost: async (req) => (asked.push(req), price),
    transcribe: async () => { throw new Error('must not run') },
  }))
  const priced = await mcp.callTool({ name: 'transcribe', arguments: { audioUrl: 'https://cdn/a.mp3', getCost: true } })
  assert.equal(priced.content[0].text, 'Transcribing this audio file (62 s) costs 3 credits, priced from its length and charged for what is heard. Nothing ran and nothing was charged.')
  assert.deepEqual(asked, [{ audioUrl: 'https://cdn/a.mp3' }])

  price = { getCost: true, audioUrl: 'https://cdn/a.mp3', creditsEstimate: null, durationSeconds: null, note: "This file's length could not be read, so its price is known only after it is transcribed." }
  const unknown = await mcp.callTool({ name: 'transcribe', arguments: { audioUrl: 'https://cdn/a.mp3', getCost: true } })
  assert.equal(unknown.content[0].text, "This file's length could not be read, so its price is known only after it is transcribed. Nothing ran and nothing was charged.")
})

test('transcribe a public video page: priced with getCost, answered with its words and facts, or why none', async () => {
  const asked = []
  const mcp = await connect(fakeClient({
    estimateTranscribeCost: async (req) => (asked.push(['cost', req]), { getCost: true, videoUrl: 'https://youtu.be/x', platform: 'youtube', creditsEstimate: 4 }),
    transcribe: async (req) => {
      asked.push(['run', req])
      return asked.length === 2
        ? { status: 'completed', videoUrl: 'https://youtu.be/x', platform: 'youtube', title: 'T', channel: 'C', transcript: 'the words', charge: null }
        : { status: 'unavailable', videoUrl: 'https://youtu.be/x', platform: 'youtube', reason: 'No captions or speech are available for this video.', charge: null }
    },
  }))
  const priced = await mcp.callTool({ name: 'transcribe', arguments: { videoUrl: 'https://youtu.be/x', getCost: true } })
  assert.match(priced.content[0].text, /^Transcribing this video costs 4 credits/)
  const done = await mcp.callTool({ name: 'transcribe', arguments: { videoUrl: ' https://youtu.be/x ' } })
  assert.match(done.content[0].text, /^Transcript of youtube video https:\/\/youtu\.be\/x \(T, C\):\n\nthe words/)
  const none = await mcp.callTool({ name: 'transcribe', arguments: { videoUrl: 'https://youtu.be/x' } })
  assert.match(none.content[0].text, /Nothing was charged for it\.$/)
  assert.deepEqual(asked, [['cost', { videoUrl: 'https://youtu.be/x' }], ['run', { videoUrl: 'https://youtu.be/x' }], ['run', { videoUrl: 'https://youtu.be/x' }]])
  for (const args of [{ videoUrl: 'https://youtu.be/x', audioUrl: 'https://cdn/a.mp3' }, { videoUrl: 'https://youtu.be/x', diarize: true }, { videoUrl: 'https://youtu.be/x', slide: 0 }]) {
    assert.equal((await mcp.callTool({ name: 'transcribe', arguments: args })).isError, true, JSON.stringify(args))
  }
})

test('transcribe takes exactly one source, and slide only for a post', async () => {
  let called = 0
  const mcp = await connect(fakeClient({ transcribe: async () => { called++; return {} }, estimateTranscribeCost: async () => { called++; return {} } }))
  for (const args of [
    {},
    { audioUrl: 'https://cdn/a.mp3', contentId: 'c1' },
    { audioUrl: 'https://cdn/a.mp3', slide: 0 },
    { contentId: 'c1', languageCode: 'en' },
  ]) {
    const res = await mcp.callTool({ name: 'transcribe', arguments: args })
    assert.equal(res.isError, true, JSON.stringify(args))
  }
  assert.equal(called, 0)
})

test('a failed post transcription says so, and a silent one says no speech was heard', async () => {
  const failed = await connect(fakeClient({ transcribe: async () => ({ status: 'failed', contentId: 'c1', error: 'This video could not be transcribed. Please contact support.' }) }))
  const f = await failed.callTool({ name: 'transcribe', arguments: { contentId: 'c1' } })
  assert.equal(f.isError, true)
  assert.equal(f.content[0].text, 'This video could not be transcribed. Please contact support. Nothing was charged for it.')
  const silent = await connect(fakeClient({ transcribe: async () => ({ status: 'completed', contentId: 'c1', slide: 0, transcript: '', wordCount: 0, durationSeconds: 3 }) }))
  const q = await silent.callTool({ name: 'transcribe', arguments: { contentId: 'c1', slide: 0 } })
  assert.equal(q.content[0].text, 'No speech was heard in post c1, slide 0.')
})

test('download lists each file by name with its save link, read-only', async () => {
  let asked
  const mcp = await connect(
    fakeClient({
      download: async (id) => {
        asked = id
        return { files: [{ mediaId: 'Abc12345-1', name: 'cat-1', url: 'https://app/api/media/k1?download=cat-1' }, { mediaId: 'Abc12345-2', name: 'cat-2', url: 'https://app/api/media/k2?download=cat-2' }] }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'download', arguments: { id: 'Abc12345' } })
  assert.equal(asked, 'Abc12345')
  assert.equal(
    res.content[0].text,
    [
      '2 files to download. Each link names the file, needs no sign-in and does not expire:',
      '- cat-1 (Abc12345-1): https://app/api/media/k1?download=cat-1',
      '- cat-2 (Abc12345-2): https://app/api/media/k2?download=cat-2',
    ].join('\n'),
  )
  assert.equal(res.structuredContent.files.length, 2)
  const { tools } = await mcp.listTools()
  assert.equal(tools.find((t) => t.name === 'download').annotations.readOnlyHint, true)
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
  // A live card must not be labeled archived, or the flag means nothing when it does appear.
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
      nextCursor: null,
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

/**
 * 🚨 **THE REVISION IS AN INPUT TO THE NEXT CALL, SO IT HAS TO SURVIVE THE FORMATTER.**
 *
 * `update_card` refuses a `notes` write that does not carry the revision the caller read. The only place
 * an agent can learn it is this output. A formatter that dropped the line would leave the notes surface
 * unreachable while every other assertion here stayed green, which is precisely how a card's `script`
 * field went on being printed for months after the column stopped holding anything.
 */
test('get_card reports the revision, and says what it is for', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_card', arguments: { cardId: 'p1' } })
  assert.match(res.content[0].text, /revision: 3/)
  assert.match(res.content[0].text, /expectedRevision/)
})

/**
 * ⛔ **0 IS A REAL REVISION AND MUST STILL PRINT.** A card nobody has edited sits at 0, and a formatter
 * written with the usual `value ? line : null` idiom would omit exactly that case, so the first write to
 * a fresh card would be the one with nothing to send.
 */
test('get_card reports revision 0 rather than omitting it', async () => {
  const client = fakeClient()
  const base = client.getCard
  client.getCard = async (id: string) => ({ ...(await base(id)), revision: 0 })
  const mcp = await connect(client)
  const res = await mcp.callTool({ name: 'get_card', arguments: { cardId: 'p1' } })
  assert.match(res.content[0].text, /revision: 0/)
})

/**
 * ⛔ **`script` IS GONE FROM THE CARD.** The column never held content (one row, 170 characters, dropped
 * 2026-09-19) and the panel stopped showing it long before that, but the tool schema still advertised it,
 * so an agent could spend a write on a field that no longer existed and get a success.
 */
test('update_card no longer advertises the retired `script` field', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const updateCard = tools.find((t) => t.name === 'update_card')
  assert.ok(updateCard, 'update_card must exist')
  assert.ok(!('script' in (updateCard.inputSchema.properties ?? {})), 'script must not be a parameter')
  assert.ok('expectedRevision' in (updateCard.inputSchema.properties ?? {}), 'expectedRevision must be')
  assert.doesNotMatch(updateCard.description ?? '', /\bscript\b/)
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
  assert.deepEqual(captured, { assetType: 'card', id: 'p1', archived: true })
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
  assert.deepEqual(captured, { assetType: 'brand_kit', id: 'bk1', favorited: true })
  assert.match(res.content[0].text, /Favorited brand_kit bk1/)
})

test('favorite names one output by its media id (no assetType)', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      favorite: async (input) => {
        captured = input
      },
    }),
  )
  const res = await mcp.callTool({ name: 'favorite', arguments: { mediaId: 'Out12345-2' } })
  assert.deepEqual(captured, { mediaId: 'Out12345-2', favorited: true })
  assert.match(res.content[0].text, /Favorited media Out12345-2/)
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
  assert.deepEqual(fav, { assetType: 'voice', id: 'v1', favorited: false })
  assert.match(r1.content[0].text, /Unfavorited voice v1/)

  const r2 = await mcp.callTool({ name: 'archive', arguments: { assetType: 'project', id: 'pr1', archived: false } })
  assert.deepEqual(arch, { assetType: 'project', id: 'pr1', archived: false })
  assert.match(r2.content[0].text, /Unarchived project pr1/)
})

test('list filters forward favorited/archived to the client', async () => {
  let mediaOpts, kitOpts, voiceOpts
  const mcp = await connect(
    fakeClient({
      listMedia: async (opts) => {
        mediaOpts = opts
        return { media: [], nextCursor: null }
      },
      listBrandKits: async (opts) => {
        kitOpts = opts
        return { brandKits: [], nextCursor: null }
      },
      listVoices: async (opts) => {
        voiceOpts = opts
        return { voices: [], nextCursor: null }
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

/**
 * In-place notes edits. The tool passes them through untouched, in order, and does NOT demand a revision:
 * the server applies them to the notes as they are when the call arrives. Which keys may combine is the
 * server's rule, so the schema refuses only a key that is not an edit field.
 */
test('update_card passes notesEdits through in order, with no revision', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateCard: async (id, input) => {
        captured = input
        return { id, title: 'Launch clip', description: null, platform: 'instagram', status: 'draft', stageId: 'st1', boardOrder: 0, contentType: null, coverUrl: null, isFavorite: false, scheduledAt: null, publishedAt: null, publishUrl: null, createdAt: 't', updatedAt: 't', platforms: [] }
      },
    }),
  )
  const notesEdits = [{ append: '\n\nNew paragraph' }, { find: 'draft', replace: 'ready' }]
  const res = await mcp.callTool({ name: 'update_card', arguments: { cardId: 'p1', notesEdits } })
  assert.notEqual(res.isError, true)
  assert.deepEqual(captured.notesEdits, notesEdits)
  assert.equal('expectedRevision' in captured, false)
  assert.equal('notes' in captured, false)
})

test('update_card advertises notesEdits with the approved description', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const field = tools.find((t) => t.name === 'update_card')?.inputSchema.properties?.notesEdits as
    | { type?: string; description?: string; items?: { additionalProperties?: boolean } }
    | undefined
  assert.ok(field, 'notesEdits must be a parameter')
  assert.equal(field.type, 'array')
  assert.equal(
    field.description,
    'Change the notes in place without resending them. Each edit is { append: text }, which adds to the end, or { find, replace }, where find must match exactly one place in the current notes. Edits apply in order, all or none, to the notes as they are when the call arrives, so no expectedRevision is needed. Prefer this to notes for any change smaller than a rewrite.',
  )
  assert.equal(field.items?.additionalProperties, false, 'a key that is not an edit field is refused')
})

test('update_card refuses an edit carrying a key that is not an edit field', async () => {
  let called = false
  const mcp = await connect(fakeClient({ updateCard: async () => { called = true; return {} as never } }))
  const res = await mcp.callTool({
    name: 'update_card',
    arguments: { cardId: 'p1', notesEdits: [{ append: 'x', mode: 'prepend' }] },
  })
  assert.equal(res.isError, true)
  assert.equal(called, false)
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

test('list_tracked_accounts returns BOTH kinds, each labeled', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_tracked_accounts', arguments: {} })
  // The whole point of merging the two list tools: one call answers both questions, and a reader can still
  // tell the two kinds apart.
  assert.match(res.content[0].text, /@mrbeast \(id ia1\) \[inspiration\]/)
  assert.match(res.content[0].text, /@contenthero \(id ba1\) \[brand\]/)
})

test('list_tracked_accounts narrows to one kind when asked', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'list_tracked_accounts', arguments: { accountType: 'brand' } })
  assert.match(res.content[0].text, /@contenthero/)
  assert.ok(!/@mrbeast/.test(res.content[0].text))
})

test('add_tracked_account lists what it tracked, and what the plan refused with the ways to continue', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({
    name: 'add_tracked_account',
    arguments: { accounts: [{ handleOrUrl: 'https://youtube.com/@mkbhd' }, { platform: 'instagram', handleOrUrl: 'rival' }] },
  })
  const out = res.content[0].text
  assert.match(out, /1 account\(s\) tracked:/)
  assert.match(out, /@mkbhd \(id ta9\) \[inspiration\] .* \| added/)
  assert.match(out, /1 not tracked:\n- rival \| instagram/)
  assert.match(out, /Tracking more than 3 accounts is part of the Hero plan/)
  assert.match(out, /- Upgrade: https:\/\/app\/billing/)
})

test('remove_tracked_account says the posts are kept', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'remove_tracked_account', arguments: { accountId: 'ta9' } })
  assert.match(res.content[0].text, /Stopped tracking account ta9\. Its posts are kept\./)
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
        return { content: [], total: 0, nextCursor: null }
      },
    }),
  )
  await mcp.callTool({
    name: 'list_content',
    arguments: { platform: 'youtube', sort: 'viewCount', order: 'asc', limit: 5, scope: 'brand', publicationDate: 'month' },
  })
  assert.equal(captured.platform, 'youtube')
  assert.equal(captured.sort, 'viewCount')
  assert.equal(captured.order, 'asc')
  assert.equal(captured.limit, 5)
  // scope and the published window are the two things the API could not express at all before.
  assert.equal(captured.scope, 'brand')
  assert.equal(captured.publicationDate, 'month')
})

test('analyze_content prices first, waits for a running analysis, and returns it', async () => {
  let reads = 0
  const mcp = await connect(
    fakeClient({
      estimateAnalysisCost: async () => ({ getCost: true, creditsEstimate: 10 }),
      // Running when asked; once the post reads finished, asked again: the analysis with its final charge.
      analyzeContent: async (id) =>
        reads === 0
          ? { contentId: id, analysis: { status: 'running' }, charge: { credits: 0, held: 10, state: 'pending', balanceAfter: null } }
          : {
              contentId: id,
              analysis: { status: 'complete', sections: ['hook'], data: { hook: { text: 'wait for it' } } },
              charge: { credits: 10, held: 0, state: 'charged', balanceAfter: 90 },
            },
      // The one status wait, by the post's id as its analysis.
      waitForStatus: async (targets) => {
        reads++
        assert.deepEqual(targets, [{ id: 'c1', kind: 'content' }])
        return [{ kind: 'content', id: 'c1', state: 'settled', reason: null, appUrl: null, progress: null, detail: { status: 'complete' } }]
      },
    }),
  )
  const cost = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', getCost: true } })
  assert.match(cost.content[0].text, /costs 10 credits\. Nothing ran and nothing was charged/)

  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1' } })
  assert.equal(reads, 1)
  assert.match(res.content[0].text, /analysis: complete/)
  assert.match(res.content[0].text, /wait for it/)
  // The charge is the finished one, not the hold the first answer carried (it used to be dropped entirely).
  assert.match(res.content[0].text, /Cost: 10 credits charged\. Balance after: 90 credits\./)
})

test('analyze_content kind scenes prices by kind, waits through get_status as scenes, and says how to read them', async () => {
  const seen = { estimate: null, analyze: null, asked: 0, waited: null }
  const mcp = await connect(
    fakeClient({
      estimateAnalysisCost: async (_id, opts) => ((seen.estimate = opts), { getCost: true, creditsEstimate: 5 }),
      analyzeContent: async (id, opts) => (
        (seen.analyze = opts),
        seen.asked++
          ? { contentId: id, kind: 'scenes', scenes: { status: 'complete', sceneCount: 7 } }
          : { contentId: id, kind: 'scenes', scenes: { status: 'running' } }
      ),
      waitForStatus: async (targets) => (
        (seen.waited = targets),
        [{ kind: 'scenes', id: 'c1', state: 'settled', reason: null, appUrl: null, progress: null, detail: { status: 'complete', sceneCount: 7 } }]
      ),
    }),
  )
  const cost = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'scenes', getCost: true } })
  assert.deepEqual(seen.estimate, { kind: 'scenes' })
  assert.match(cost.content[0].text, /scenes costs 5 credits \(priced per started minute of video\)/)

  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'scenes' } })
  assert.deepEqual(seen.analyze, { kind: 'scenes' })
  assert.deepEqual(seen.waited, [{ id: 'c1', kind: 'scenes' }])
  assert.match(res.content[0].text, /7 scenes ready\. Read them with get_content scenes='map', and see a scene's frames with view\./)
  assert.equal(res.structuredContent.status, 'complete')
})

test('get_content scenes: the map names each scene in words, points to view for its frames, and frames is refused', async () => {
  const scenes = {
    status: 'complete',
    sceneCount: 2,
    detail: {
      summary: 'A creator unboxes a phone.',
      timedTranscript: true,
      windowed: false,
      scenes: [
        { index: 0, startMs: 0, endMs: 3000, description: 'box on a desk', said: 'Look at this.' },
        { index: 1, startMs: 3000, endMs: 8000, description: 'phone lifted out', said: '' },
      ],
    },
  }
  let asked
  const mcp = await connect(
    fakeClient({
      getContent: async (_id, opts) => ((asked = opts), { id: 'c1', shortId: 'Pc4tSc3n', title: 'Unboxing', hashtags: [], analysis: { status: 'absent' }, scenes }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', scenes: 'map', startMs: 0 } })
  assert.deepEqual(asked, { scenes: 'map', startMs: 0 })
  assert.equal(res.content.length, 1)
  const body = res.content[0].text
  assert.match(body, /scenes: complete \(2\)/)
  assert.match(body, /scenes\.frames: see a scene with view \{ contentId: "Pc4tSc3n", atSec \} at a second in its range/)
  assert.match(body, /scene 1 \[0\.0s to 3\.0s\] box on a desk \| said: "Look at this\."$/m)
  assert.match(body, /scene 2 \[3\.0s to 8\.0s\] phone lifted out \| said: \(nothing\)$/m)
  assert.doesNotMatch(body, /frame:/)

  // 'frames' is no longer a value: the schema refuses it before the API is asked.
  asked = undefined
  const frames = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', scenes: 'frames' } })
  assert.equal(frames.isError, true)
  assert.equal(asked, undefined)
})

test('get_content without scenes reports only whether they exist', async () => {
  const mcp = await connect(
    fakeClient({ getContent: async () => ({ title: 'x', hashtags: [], analysis: { status: 'absent' }, scenes: { status: 'complete', sceneCount: 4 } }) }),
  )
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1' } })
  assert.match(res.content[0].text, /scenes: complete \(4; pass scenes='map' to read them\)/)
})

/**
 * get_content always reports the post's videos with their states, and cuts adds each downloaded one's cut list, in
 * analyze_content's words; a video never downloaded says how to download it. Break-verified: dropping postVideoLines
 * from inspirationContentResult turns this red; dropping cuts from the schema, the first assertion.
 */
test("get_content reports each video's state, and cuts adds its cut list", async () => {
  let asked
  const video = {
    copy: { status: 'absent' },
    videos: [
      { slide: 1, copy: { status: 'ready' }, cuts: { boundaries: [1.5, 4], scores: [0.9, 0.7], durationSec: 6 } },
      { slide: 3, copy: { status: 'absent' } },
    ],
  }
  const mcp = await connect(
    fakeClient({ getContent: async (_id, opts) => ((asked = opts), { title: 'x', hashtags: [], analysis: { status: 'absent' }, video }) }),
  )
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', cuts: true, startMs: 1000 } })
  assert.deepEqual(asked, { cuts: true, startMs: 1000 })
  const body = res.content[0].text
  assert.match(body, /videos: not downloaded \(analyze_content with kind video downloads them\)/)
  assert.match(body, /Slide 2 \(slide: 1\): ready; cut list: 2 cuts in 6\.0s, at 1\.50s, 4\.00s\./)
  assert.match(body, /Slide 4 \(slide: 3\): not downloaded yet\./)
  const { tools } = await mcp.listTools()
  assert.match(tools.find((t) => t.name === 'get_content').description, /Each of the post's videos is reported with its state; once analyze_content kind video has downloaded one, cuts adds where its picture changes\./)
})

const AUDIO_SOUND = {
  atSec: 1.2, endSec: 1.6, stem: 'other', levelDb: -18, riseDb: 14, vsVoiceDb: 3,
  descriptors: { attackMs: 4, decayMs: 180, peakDb: -9, centroidHz: { start: 5200, peak: 4100, end: 2600 }, bandwidthHz: 3100, flatness: 0.62, pitchHz: null, lowBandShare: 0.08, stereoWidth: 0.4 },
}
const AUDIO_WINDOW = {
  fromSec: 1, toSec: 4, durationSec: 6,
  speech: [{ fromSec: 1, toSec: 2.5 }],
  sounds: [AUDIO_SOUND],
  music: { present: true, tempoBpm: 118, beatsSec: [1.5, 2], key: 'A', mode: 'minor', levelDb: -24 },
  ducking: { musicUnderSpeechDb: -30, musicWithoutSpeechDb: -21, dropDb: 9 },
  loudness: { integratedLufs: -14, shortTerm: [{ atSec: 1.5, lufs: -15 }] },
  levels: { vocalsDb: -16, drumsDb: -24, bassDb: -28, otherDb: -30 },
}

/**
 * Each video's audio map summary reports on every get_content, and audioMap adds its window below it, narrowed by the
 * window. Break-verified: dropping audioMap from the schema turns the first assertion red; dropping the window lines
 * from postVideoLines, the window assertion.
 */
test("get_content reports each video's audio map summary, and audioMap adds its window", async () => {
  let asked
  const summary = { durationSec: 6, speechSec: 1.5, soundCount: 1, music: { present: true, tempoBpm: 118, key: 'A', mode: 'minor' }, duckingDropDb: 9, integratedLufs: -14 }
  const video = {
    copy: { status: 'ready' },
    videos: [
      { slide: 0, copy: { status: 'ready' }, audioMap: { status: 'ready', summary, window: AUDIO_WINDOW } },
      { slide: 2, copy: { status: 'ready' }, audioMap: { status: 'pending' } },
    ],
  }
  const mcp = await connect(
    fakeClient({ getContent: async (_id, opts) => ((asked = opts), { title: 'x', hashtags: [], analysis: { status: 'absent' }, video }) }),
  )
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', audioMap: true, startMs: 1000, endMs: 4000 } })
  assert.deepEqual(asked, { audioMap: true, startMs: 1000, endMs: 4000 })
  const body = res.content[0].text
  assert.match(body, /Slide 1 \(slide: 0\): ready; audio map: 1\.5s of speech in 6\.0s, 1 sound candidate, music 118 BPM, A minor, drops 9 dB under speech, mix -14 LUFS\./)
  assert.match(body, /\n {4}audio map, 1\.0s to 4\.0s:\n {6}speech: 1\.0-2\.5s\n {6}sound candidates \(measured, not identified\): 1\n {8}1\. 1\.2s to 1\.6s on other: -18 dB, \+14 over its floor, \+3 vs voice; attack 4 ms/)
  assert.match(body, /Slide 3 \(slide: 2\): ready; audio map: the sound analysis is still being made: read it again with the same inputs\./)
})

/**
 * The audio map is exact data (phase 5 item 4): the text rounds for reading, and the API's own values ride in
 * structuredContent for computing, once, with a line saying where. Break-verified: dropping structuredContent from
 * inspirationContentResult or clipSection turns this red; leaving the map in the view's JSON text, the size assertion.
 */
test("a render's exact audio map rides once, in the structured data, never in the text's JSON", async () => {
  const rendered = { renderId: 'r1', state: 'done', kind: 'sound', audioMap: { status: 'ready', window: AUDIO_WINDOW } }
  const viewer = await connect(fakeClient({ view: async () => ({ rendered }) }))
  const seen = await viewer.callTool({ name: 'view', arguments: { renderId: 'r1' } })
  assert.doesNotMatch(seen.content[0].text, /"audioMap"/)
  assert.match(seen.content[0].text, /Exact values for computing are in the structured data beside this text\./)
  const { summary, ...exact } = seen.structuredContent as Record<string, unknown>
  assert.deepEqual(exact, { rendered: { audioMap: { status: 'ready', window: AUDIO_WINDOW } } })
  // A render alone carries no live context (gap closure D4).
  assert.doesNotMatch(String(summary), /Live context/)
})

test('get_content and view carry the exact audio map in structuredContent, beside the readable text', async () => {
  const video = { copy: { status: 'ready' }, videos: [{ slide: 0, copy: { status: 'ready' }, audioMap: { status: 'ready', window: AUDIO_WINDOW } }] }
  const mcp = await connect(fakeClient({ getContent: async () => ({ id: 'c1', title: 'x', hashtags: [], analysis: { status: 'absent' }, video }) }))
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', audioMap: true } })
  assert.match(res.content[0].text, /Exact values for computing are in the structured data beside this text\./)
  // A host may show the structured data alone, so it stands alone: the readable text rides in it as `summary`.
  const { summary, ...exact } = res.structuredContent as Record<string, unknown>
  assert.deepEqual(exact, { contentId: 'c1', videos: [{ slide: 0, audioMap: { status: 'ready', window: AUDIO_WINDOW } }] })
  assert.equal(summary, res.content[0].text)
  // Nothing exact was asked for: no structured data, no pointer.
  const plain = await connect(fakeClient({ getContent: async () => ({ id: 'c1', title: 'x', hashtags: [], analysis: { status: 'absent' } }) }))
  const bare = await plain.callTool({ name: 'get_content', arguments: { contentId: 'c1' } })
  assert.equal(bare.structuredContent, undefined)
  assert.doesNotMatch(bare.content[0].text, /Exact values/)

  const clip = { contentId: 'post-1', type: 'video', fromSec: 1, toSec: 4, audioMap: { status: 'ready', window: AUDIO_WINDOW } }
  const viewer = await connect(fakeClient({ view: async () => ({ clip }) }))
  const seen = await viewer.callTool({ name: 'view', arguments: { contentId: 'post-1', fromSec: 1, toSec: 4 } })
  const { summary: seenSummary, ...seenExact } = seen.structuredContent as Record<string, unknown>
  assert.deepEqual(seenExact, { clip })
  // Each channel says each fact once (2026-10-15): the summary beside the exact map says where its window is, and never
  // lists the window's lines again.
  assert.match(String(seenSummary), /Its window is in clip\.audioMap\./)
  assert.doesNotMatch(String(seenSummary), /speech:/)
  assert.match(seen.content[0].text, /speech:/)
  assert.match(seen.content[0].text, /Exact values for computing are in the structured data beside this text\./)
  // The map is in the structured data once; the text's JSON carries the clip without it.
  assert.doesNotMatch(seen.content[0].text, /"audioMap"/)
})

/**
 * Word timing reaches the reader only when asked (phase 5 item 3): each word at its exact start and end under its
 * segment, and a transcript without word timing says so. Break-verified: dropping the words line from transcriptLines,
 * or 'words' from the transcript enum, turns this red.
 */
test('get_content shows each word at its exact time when words are asked for', async () => {
  let asked
  const transcript = {
    status: 'complete', language: 'en', wordTimed: true,
    segments: [{ startMs: 1200, endMs: 1850, text: 'Hello there.', speaker: null, words: [{ startMs: 1200, endMs: 1480, text: 'Hello' }, { startMs: 1505, endMs: 1850, text: 'there.' }] }],
  }
  const mcp = await connect(fakeClient({ getContent: async (_id, opts) => ((asked = opts), { id: 'c1', title: 'x', hashtags: [], analysis: { status: 'absent' }, transcript }) }))
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', transcript: 'words' } })
  assert.deepEqual(asked, { transcript: 'words' })
  assert.match(res.content[0].text, /\[1\.2s\] Hello there\.\n {4}Hello@1\.2s-1\.48s there\.@1\.505s-1\.85s/)
  const { summary: _summary, ...exactWords } = res.structuredContent as Record<string, unknown>
  assert.deepEqual(exactWords, { contentId: 'c1', transcript })

  const unTimed = await connect(fakeClient({ getContent: async () => ({ id: 'c1', title: 'x', hashtags: [], analysis: { status: 'absent' }, transcript: { status: 'complete', language: 'en', wordTimed: false, segments: [{ startMs: 0, endMs: 2000, text: 'Hi', speaker: null }] } }) }))
  const phrases = await unTimed.callTool({ name: 'get_content', arguments: { contentId: 'c1', transcript: 'words' } })
  assert.match(phrases.content[0].text, /This post's transcript has no word timing: its segments are timed, its words are not\./)
})

/**
 * A source's frames come in pages, as frames or contact sheets (phase 5 item 5, gap 12): each sheet attached with the
 * seconds it spans, the page named with how to read the next, and no live context. Break-verified: dropping parseSheets
 * from clipSection turns this red.
 */
test("view shows a source's contact sheets, a page at a time", async () => {
  const clip = {
    contentId: 'post-1', type: 'video', fromSec: 0, toSec: 9, layout: 'sheets', page: 1, pages: 2,
    sheets: [{ atSec: [0, 0.2, 0.4], columns: 3, rows: 1, width: 600, height: 120, dataUrl: 'data:image/webp;base64,U0gx' }],
  }
  const mcp = await connect(fakeClient({ view: async () => ({ clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { contentId: 'post-1', fromSec: 0, toSec: 9, perSecond: 5, layout: 'sheets' } })
  const text = res.content[0].text
  assert.match(text, /1 contact sheet\(s\) of the source are attached below, in order, each tile labeled with its second in the source\./)
  assert.doesNotMatch(text, /U0gx|Live context/)
  assert.deepEqual(res.content.slice(1).map((c) => (c.type === 'image' ? c.data : c.text)), ['From 0s to 0.4s:', 'U0gx'])
})

/**
 * view on a post's video carries its audio map for the window read, whatever was asked of it. Break-verified: dropping
 * describeAudioMap from clipSection turns this red.
 */
test("view on a post's video shows its audio map for the window", async () => {
  const clip = { contentId: 'post-1', type: 'video', fromSec: 1, toSec: 4, durationSeconds: 6, audioMap: { status: 'ready', window: AUDIO_WINDOW } }
  const mcp = await connect(fakeClient({ view: async () => ({ clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { contentId: 'post-1', fromSec: 1, toSec: 4, count: 1 } })
  const text = res.content[0].text
  assert.match(text, /audio map, 1\.0s to 4\.0s:/)
  assert.match(text, /music: 118 BPM, A minor, drops 9 dB under speech, 2 beats in this window/)
  assert.match(text, /levels: vocals -16 dB, drums -24 dB, bass -28 dB, other -30 dB/)
})

/**
 * A heard window of a post comes with its evidence sheet: attached as an image after the keyframes and before the
 * sound's picture, its data URL stripped from the JSON, and a line saying how to read it; pending says why, with no
 * image. Break-verified: dropping the sheet from clipSection's blocks, or leaving its data URL in the JSON, turns this red.
 */
test("view on a post's heard window attaches its evidence sheet and says how to read it", async () => {
  const sheet = {
    status: 'ready', fromSec: 1, toSec: 4, width: 1292, height: 610, dataUrl: 'data:image/webp;base64,U0hFRVQ=',
    frames: [{ atSec: 1.25 }], words: [{ atSec: 1.3, text: 'hi' }], stems: ['vocals', 'drums', 'bass', 'other'], frequencyHz: { min: 20, max: 20000 }, soundsMarked: 1,
  }
  const clip = {
    contentId: 'post-1', type: 'video', fromSec: 1, toSec: 4, durationSeconds: 6,
    sound: { kind: 'sound', fromSec: 1, toSec: 4, loudness: { integratedLufs: -14 }, onsets: [] },
    audioMap: { status: 'ready', window: AUDIO_WINDOW },
    sheet,
  }
  const mcp = await connect(fakeClient({ view: async () => ({ clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { contentId: 'post-1', fromSec: 1, toSec: 4, sound: true } })
  const text = res.content[0].text
  assert.match(text, /evidence sheet, 1\.0s to 4\.0s: frames along the top, the spoken words under them, then one spectrogram strip per stem \(vocals, drums, bass, other;/)
  assert.match(text, /its 1 sound candidate marked on the stem each is loudest in, numbered as listed under sound candidates\. It is attached below\./)
  assert.doesNotMatch(text, /U0hFRVQ=/)
  const images = res.content.filter((b) => b.type === 'image')
  assert.deepEqual(images.map((b) => b.data), ['U0hFRVQ='])
  assert.ok(res.content.some((b) => b.type === 'text' && b.text === 'Its evidence sheet:'))

  const pending = { ...clip, sheet: { status: 'pending', since: '2026-10-13T10:00:00Z', reason: 'The evidence sheet is rendered once the audio map is ready.' } }
  const mcp2 = await connect(fakeClient({ view: async () => ({ clip: pending }) }))
  const res2 = await mcp2.callTool({ name: 'view', arguments: { contentId: 'post-1', fromSec: 1, toSec: 4, sound: true } })
  assert.match(res2.content[0].text, /evidence sheet is still being made \(since 2026-10-13T10:00:00Z\): The evidence sheet is rendered once the audio map is ready\./)
  assert.equal(res2.content.filter((b) => b.type === 'image').length, 0)
})

test('analyze_content says pending when the analysis outlasts the call', async () => {
  const mcp = await connect(
    fakeClient({
      analyzeContent: async (id, opts) =>
        opts?.kind === 'scenes'
          ? { contentId: id, kind: 'scenes', scenes: { status: 'running' } }
          : { contentId: id, analysis: { status: 'running' } },
      waitForStatus: async (targets) =>
        targets.map((t) => ({ kind: t.kind, id: t.id, state: 'processing', reason: null, appUrl: null, progress: null, detail: { status: 'running' } })),
    }),
  )
  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1' } })
  assert.match(res.content[0].text, /pending, still running \(wait with get_status \{ ids: \["c1"\], kind: "content" \}, then analyze_content reads it at no charge\)/)
  assert.equal(res.structuredContent.status, 'pending')
  // Scenes wait the same way: get_status names them by kind, since the post's id alone names its analysis.
  const scenes = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'scenes' } })
  assert.match(scenes.content[0].text, /still being prepared \(wait with get_status \{ ids: \["c1"\], kind: "scenes" \}, then analyze_content reads it at no charge\)/)
  assert.equal(scenes.structuredContent.status, 'pending')
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

test('get_tracked_account reports totals and averages for either kind of account', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_tracked_account', arguments: { accountId: 'ba1' } })
  assert.match(res.content[0].text, /content tracked: 50/)
  assert.match(res.content[0].text, /1\.0M views/)
  assert.match(res.content[0].text, /5\.5% engagement/)
})

// -- brand-kit writes ---------------------------------------------------------

test('update_brand_kit passes section writes through and returns the kit', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = { id, input }
        return { id, name: input.name ?? 'ContentHero', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  const sections = [{ key: 'voice_and_tone', body: '## Personality', expectedVersion: 2 }, { key: 'offer', revertTo: 1 }]
  const res = await mcp.callTool({ name: 'update_brand_kit', arguments: { brandKitId: 'bk1', sections } })
  assert.equal(captured.id, 'bk1')
  assert.deepEqual(captured.input.sections, sections)
  assert.match(res.content[0].text, /Brand kit "ContentHero"/)
})

test('the retired kit inputs are not declared on create_brand_kit or update_brand_kit', async () => {
  const mcp = await connect(fakeClient({}))
  const { tools } = await mcp.listTools()
  for (const name of ['create_brand_kit', 'update_brand_kit']) {
    const declared = Object.keys(tools.find((t) => t.name === name).inputSchema.properties)
    // The field-era inputs (Revision 7): a kit's text is its sections, and visual style is the Design Guidelines section.
    for (const retired of ['businessName', 'primaryOffer', 'nicheDefinition', 'positioning', 'audience', 'voiceProfile', 'contentStrategy', 'visualStyle', 'designPrinciples', 'fields']) {
      assert.ok(!declared.includes(retired), `${name} still declares ${retired}`)
    }
  }
})

test('get_brand_kit reads three ways and refuses the combinations that cannot mean anything', async () => {
  const calls = []
  const mcp = await connect(
    fakeClient({
      getBrandKit: async (id, options) => {
        calls.push(options)
        if (options?.detail === 'summary') {
          return {
            id, name: 'CH',
            sections: [{ id: 's1', key: 'voice_and_tone', role: 'voice_and_tone', tab: 'voice', sectionName: 'Voice & Tone', width: 'full', version: 3, updatedAt: 't', charCount: 412, outline: ['Personality', 'Principles'] }],
          }
        }
        if (options) {
          return {
            id, name: 'CH',
            sections: [{ id: 's1', key: 'voice_and_tone', role: 'voice_and_tone', tab: 'voice', sectionName: 'Voice & Tone', width: 'full', version: 3, updatedAt: 't', body: '## Personality\n\nWarm.', revisions: [{ version: 2, body: 'Older.', bodySource: 'user', createdAt: 't0' }] }],
          }
        }
        return { id, name: 'CH', isDefault: true, sections: [] }
      },
    }),
  )
  const summary = await mcp.callTool({ name: 'get_brand_kit', arguments: { brandKitId: 'bk1', detail: 'summary' } })
  assert.match(summary.content[0].text, /\[voice\] Voice & Tone \| key voice_and_tone \| role voice_and_tone \| v3 \| 412 chars/)
  assert.match(summary.content[0].text, /covers: Personality \/ Principles/)

  const scoped = await mcp.callTool({ name: 'get_brand_kit', arguments: { brandKitId: 'bk1', tabs: ['voice'], history: true } })
  assert.deepEqual(calls[1], { tabs: ['voice'], history: true })
  // The body arrives as Markdown, not as a JSON string with escaped line breaks, and its history follows it.
  assert.match(scoped.content[0].text, /1 section\(s\) from brand kit "CH"/)
  assert.match(scoped.content[0].text, /v3 \(pass as expectedVersion\) ===\n\n## Personality\n\nWarm\./)
  assert.match(scoped.content[0].text, /--- v2, user, t0 ---\n\nOlder\./)

  await mcp.callTool({ name: 'get_brand_kit', arguments: { brandKitId: 'bk1' } })
  assert.equal(calls[2], undefined)

  const bad = await mcp.callTool({ name: 'get_brand_kit', arguments: { brandKitId: 'bk1', detail: 'summary', keys: ['x'] } })
  assert.equal(bad.isError, true)
  const lonely = await mcp.callTool({ name: 'get_brand_kit', arguments: { brandKitId: 'bk1', history: true } })
  assert.equal(lonely.isError, true)
  assert.equal(calls.length, 3)
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
  assert.deepEqual(captured, { assetType: 'brand_kit', id: 'bk1', archived: true })
  assert.match(res.content[0].text, /Archived brand_kit bk1/)
})

test('update_brand_kit forwards brandAccounts, including a url that adds a NEW account', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'ContentHero', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
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
        return { id, name: 'x', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
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
    name: 'n', websiteUrls: ['https://x.test'], logos: [{ url: 'https://x/1.png' }],
    assets: [{ url: 'https://x/2.png' }], sections: [{ key: 'about', body: 'b' }],
    brandAccounts: ['https://youtube.com/@a'], inspirationAccounts: ['https://youtube.com/@b'],
    brandColors: [{ hex: '#1A2B3C', role: 'primary' }], typography: { titleFont: 'Manrope' },
    afterId: 'bk2', beforeId: 'bk3', position: 'top',
  }
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'x', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  const { tools } = await mcp.listTools()
  const declared = Object.keys(tools.find((t) => t.name === 'update_brand_kit').inputSchema.properties)
  // These are handled by the tool itself rather than passed through, by design.
  const NOT_FORWARDED = new Set(['brandKitId', 'extract', 'isDefault'])
  for (const field of declared) {
    if (NOT_FORWARDED.has(field)) continue
    assert.ok(field in SAMPLES, `add a sample value for update_brand_kit.${field} to this test`)
    captured = undefined
    await mcp.callTool({ name: 'update_brand_kit', arguments: { brandKitId: 'bk1', [field]: SAMPLES[field] } })
    assert.ok(captured, `update_brand_kit dropped "${field}": the patch reached the client empty`)
    assert.ok(field in captured, `update_brand_kit declared "${field}" but never forwarded it`)
  }
})

test('update_brand_kit names only the sections it changes: edit by key, add without one', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (id, input) => {
        captured = input
        return { id, name: 'ContentHero', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] }
      },
    }),
  )
  const res = await mcp.callTool({
    name: 'update_brand_kit',
    arguments: {
      brandKitId: 'bk1',
      sections: [
        { key: 'about', body: '## Who We Are', expectedVersion: 2, width: 'full' },
        { sectionName: 'Hooks', tab: 'voice', body: 'Open with the outcome.' },
      ],
    },
  })
  assert.ok(!res.isError, res.content[0].text)
  assert.deepEqual(captured.sections, [
    { key: 'about', body: '## Who We Are', expectedVersion: 2, width: 'full' },
    { sectionName: 'Hooks', tab: 'voice', body: 'Open with the outcome.' },
  ])
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
  assert.deepEqual(captured, { assetType: 'brand_kit_section', id: 'sec9', archived: true })
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
        return {
          item: { id: 'kn-new', title: input.title ?? 'Note', sourceType: input.sourceType, sourceUrl: null, createdAt: 't', updatedAt: 't' },
          charge: { credits: 0, held: 0, state: 'free', balanceAfter: null },
        }
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
  assert.match(res.content[0].text, /\nCost: Nothing was charged\.$/)
})

test('remove_brand_knowledge removes by id', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'remove_brand_knowledge', arguments: { brandKitId: 'bk1', knowledgeId: 'kn9' } })
  // A removed item has no title or page left to show, so the confirmation names only its id.
  assert.equal(res.content[0].text, 'Knowledge item removed (id kn9).')
})

test('list_content forwards brandKitId for brand-scoped reads', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      listContent: async (options) => {
        captured = options
        return { content: [], total: 0, nextCursor: null }
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

test('list_projects lists projects with type + title', async () => {
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
  assert.doesNotMatch(body, /Scoped read/)
})

/**
 * A windowed read is part of the document, and the result says so: a full read of one beat otherwise looks exactly like
 * a full read of a short timeline. Break-verified: dropping the scope line from `projectDetailResult` turns this red.
 */
test('get_project states the scope a windowed read applied', async () => {
  const base = await fakeClient().getProject('p1', {})
  const mcp = await connect(fakeClient({ getProject: async () => ({ ...base, scope: { fromFrame: 600, toFrame: 629, trackId: 'main' } }) }))
  const res = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1', detail: 'full', fromFrame: 600, toFrame: 629, trackId: 'main' } })
  assert.match(res.content[0].text, /Scoped read \(frames 600 to 629, track main\): the state is that part of the project, not all of it\./)
})

test('view returns the context text + a focused-slide image block', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/webp' } })) as typeof fetch
  try {
    const mcp = await connect(fakeClient())
    const res = await mcp.callTool({ name: 'view', arguments: {} })
    assert.match((res.content[0]).text, /canvas surface/)
    const image = res.content.find((c) => c.type === 'image')
    assert.ok(image, 'expected an image content block')
    assert.equal(image.mimeType, 'image/webp')
    assert.ok(image.data.length > 0)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('view render returns the composed-output as an inline image block', async () => {
  const rendered = { surface: 'editor', frame: 34, dataUrl: 'data:image/webp;base64,AQIDBA==' }
  const mcp = await connect(
    fakeClient({
      view: async () => ({
        live: { context: { surface: 'editor', playheadFrame: 34 }, participant: { userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }, participants: [{ userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }] },
        rendered,
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'view', arguments: { render: true, frame: 34 } })
  const image = res.content.find((c) => c.type === 'image')
  assert.ok(image, 'expected an inline render image block')
  assert.equal(image.mimeType, 'image/webp')
  assert.equal(image.data, 'AQIDBA==')
  // the bulky base64 dataUrl must be stripped from the JSON text (it rides only as the image block)
  assert.doesNotMatch((res.content[0]).text, /AQIDBA==/)
})

test('view returns one image block per frame across a range', async () => {
  const rendered = {
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
      view: async () => ({
        live: { context: { surface: 'editor', playheadFrame: 0 }, participant: { userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }, participants: [{ userId: 'u1', sessionId: 'sess', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }] },
        rendered,
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'view', arguments: { render: true, count: 3, fromFrame: 0, toFrame: 60 } })
  const images = res.content.filter((c) => c.type === 'image')
  assert.equal(images.length, 3, 'expected one image block per frame in the range')
  assert.deepEqual(images.map((i) => i.data), ['AAAA', 'BBBB', 'CCCC'])
  // frame timing is kept in the JSON; the base64 payloads are stripped from the text.
  assert.match((res.content[0]).text, /"frame": 30/)
  assert.doesNotMatch((res.content[0]).text, /AAAA/)
})

/**
 * A render is a job with an id, and its answer reads the way it came back (the review loop): contact sheets are
 * attached as images with each frame's number in the text, a render still going says how to read the rest, and a
 * sound attaches its picture with its measurement in words. Break-verified: dropping the sheets from the image list
 * turns the first red; dropping `describeRenderProgress`, the second; dropping the sound picture or its summary, the
 * third; sending a wait on a structured read, or none on a render, the fourth.
 */
function noTabFirst(rendered) {
  return fakeClient({ view: async () => ({ rendered }) })
}

test('view attaches contact sheets as images and keeps their frames in the text', async () => {
  const rendered = {
    renderId: 'r1',
    state: 'done',
    kind: 'picture',
    layout: 'sheets',
    page: 1,
    pages: 2,
    readyPages: [1, 2],
    sheets: [
      { frames: [0, 10, 20], columns: 3, rows: 1, dataUrl: 'data:image/webp;base64,U0hFRVQx' },
      { frames: [30, 40], columns: 2, rows: 1, dataUrl: 'data:image/webp;base64,U0hFRVQy' },
    ],
  }
  const mcp = await connect(noTabFirst(rendered))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, fromFrame: 0, toFrame: 90, perSecond: 3 } })
  assert.deepEqual(res.content.filter((c) => c.type === 'image').map((i) => i.data), ['U0hFRVQx', 'U0hFRVQy'])
  assert.match(res.content[0].text, /2 contact sheets are attached below, in order\. Each frame's number is written under its tile/)
  assert.match(res.content[0].text, /Page 1 of 2\. Read another page with renderId r1 and its page number\./)
  assert.match(res.content[0].text, /"frames": \[\s*30,\s*40\s*\]/)
  assert.doesNotMatch(res.content[0].text, /U0hFRVQ/)
})

test('view says a render still going is read with its id, and shows what is ready', async () => {
  const rendered = { renderId: 'r2', status: 'pending', since: '2026-10-13T10:00:00Z', readWith: { renderId: 'r2', page: 1 }, kind: 'picture', layout: 'sheets', page: 1, pages: 6, readyPages: [], frameCount: 600, renderedFrameCount: 0 }
  const mcp = await connect(noTabFirst(rendered))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, count: 600 } })
  assert.equal(res.content.filter((c) => c.type === 'image').length, 0)
  assert.match(res.content[0].text, /Still rendering: 0 of 600 frames are rendered\. Read this page with renderId r2 and page 1, and the rest with renderId r2 and a page number\./)
  assert.doesNotMatch(res.content[0].text, /The render produced no image/)
})

test("view attaches a sound's picture and says what it measured", async () => {
  const rendered = {
    renderId: 'r3',
    state: 'done',
    kind: 'sound',
    fromFrame: 0,
    toFrame: 299,
    loudness: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 5, samplePeakDbfs: -1.2 },
    onsets: [{ frame: 15, seconds: 0.5 }],
    stereo: { sideToMid: 0.2, correlation: 0.9 },
    picture: { width: 1240, height: 402, dataUrl: 'data:image/webp;base64,V0FWRQ==' },
    audioUrl: 'https://media.contenthero.ai/a/original.wav?t=x',
  }
  const mcp = await connect(noTabFirst(rendered))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', sound: true, fromFrame: 0, toFrame: 299 } })
  assert.deepEqual(res.content.filter((c) => c.type === 'image').map((i) => i.data), ['V0FWRQ=='])
  assert.match(res.content[0].text, /A picture of the sound is attached below/)
  assert.match(res.content[0].text, /Integrated loudness -14 LUFS, true peak -1 dBTP/)
  assert.match(res.content[0].text, /"audioUrl": "https:\/\/media\.contenthero\.ai\/a\/original\.wav\?t=x"/)
  assert.doesNotMatch(res.content[0].text, /V0FWRQ==/)
})

/**
 * A heard range of your own edit comes with its sound analysis and evidence sheet, as a source's window does: the sheet
 * attached after the render, its data URL stripped from the JSON, the measurement still read as the loudness; pending
 * says why, with no image. Break-verified: dropping the sheet from renderedSection turns this red.
 */
test("view on a rendered sound attaches its evidence sheet and its audio map", async () => {
  const sheet = {
    status: 'ready', fromSec: 0, toSec: 4, width: 1292, height: 610, dataUrl: 'data:image/webp;base64,UkVOREVS',
    frames: [{ atSec: 0.4 }], words: [{ atSec: 0.5, text: 'hi' }], stems: ['vocals', 'drums', 'bass', 'other'], frequencyHz: { min: 20, max: 20000 }, soundsMarked: 0,
  }
  const rendered = {
    renderId: 'r4', state: 'done', kind: 'sound', fromFrame: 0, toFrame: 119,
    loudness: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 5, samplePeakDbfs: -1.2 }, onsets: [],
    audioMap: { status: 'ready', version: 2, window: AUDIO_WINDOW },
    sheet,
  }
  const mcp = await connect(noTabFirst(rendered))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', sound: true, fromFrame: 0, toFrame: 119 } })
  const text = res.content[0].text
  assert.match(text, /Integrated loudness -14 LUFS/)
  assert.match(text, /music: 118 BPM, A minor, drops 9 dB under speech/)
  assert.match(text, /evidence sheet, 0\.0s to 4\.0s: frames along the top[^\n]*It is attached below\./)
  assert.doesNotMatch(text, /UkVOREVS/)
  assert.deepEqual(res.content.filter((c) => c.type === 'image').map((i) => i.data), ['UkVOREVS'])

  const pending = {
    ...rendered,
    audioMap: { status: 'pending', since: '2026-10-13T10:00:00Z', readWith: { renderId: 'r4' } },
    sheet: { status: 'pending', since: '2026-10-13T10:00:00Z', readWith: { renderId: 'r4' }, reason: 'The evidence sheet is rendered once the sound analysis is ready: read this render again by its id to get it.' },
  }
  const mcp2 = await connect(noTabFirst(pending))
  const res2 = await mcp2.callTool({ name: 'view', arguments: { projectId: 'p1', sound: true } })
  // A pending part names the render to read, never the range (gap closure D3).
  assert.match(res2.content[0].text, /audio map: the sound analysis is still being made \(since 2026-10-13T10:00:00Z\): read it again with renderId r4\./)
  assert.match(res2.content[0].text, /evidence sheet is still being made \(since 2026-10-13T10:00:00Z\): read it again with renderId r4\./)
  assert.equal(res2.content.filter((c) => c.type === 'image').length, 0)
})

test('view forwards the new render inputs, and waits only when it renders', async () => {
  const seen = []
  const mcp = await connect(fakeClient({ view: async (input) => (seen.push(input), { live: { context: null, participant: null, participants: [] } }) }))
  await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, frames: [4, 2], layout: 'frames' } })
  await mcp.callTool({ name: 'view', arguments: { renderId: 'r1', page: 2 } })
  await mcp.callTool({ name: 'view', arguments: { projectId: 'p1' } })
  assert.deepEqual(seen[0].frames, [4, 2])
  assert.equal(seen[0].layout, 'frames')
  assert.ok(seen[0].wait > 0 && seen[0].wait < 45, 'a render waits inside the call deadline')
  assert.equal(seen[1].renderId, 'r1')
  assert.equal(seen[1].page, 2)
  assert.ok(seen[1].wait > 0)
  assert.equal(seen[2].wait, undefined)
})

// video starts a render (it waits), and a raw clip is named by assetId or mediaUrl with its window. Break-verified:
// dropping video from the wait condition, or any clip field from the forwarded input, turns this red.
test('view forwards video and a raw clip, and waits for video', async () => {
  const seen = []
  const mcp = await connect(fakeClient({ view: async (input) => (seen.push(input), { live: { context: null, participant: null, participants: [] } }) }))
  await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', video: true, fromFrame: 0, toFrame: 90 } })
  await mcp.callTool({ name: 'view', arguments: { assetId: 'a1', fromSec: 1.5, toSec: 4, count: 6, width: 480 } })
  await mcp.callTool({ name: 'view', arguments: { mediaUrl: 'https://media.contenthero.ai/c.mp4' } })
  assert.equal(seen[0].video, true)
  assert.ok(seen[0].wait > 0, 'video is a render, so it waits')
  assert.deepEqual(
    { assetId: seen[1].assetId, fromSec: seen[1].fromSec, toSec: seen[1].toSec, count: seen[1].count, width: seen[1].width },
    { assetId: 'a1', fromSec: 1.5, toSec: 4, count: 6, width: 480 },
  )
  assert.equal(seen[2].mediaUrl, 'https://media.contenthero.ai/c.mp4')
})

// A tracked post's video is a source named by contentId and slide, and frames come at named seconds. Break-verified:
// dropping contentId, slide or atSec from the forwarded input turns this red.
test('view forwards a tracked post, its slide, frames at named seconds and sound on a source', async () => {
  const seen = []
  const mcp = await connect(fakeClient({ view: async (input) => (seen.push(input), { live: { context: null, participant: null, participants: [] } }) }))
  await mcp.callTool({ name: 'view', arguments: { contentId: 'post-1', slide: 4, atSec: [1, 3.5], sound: true } })
  await mcp.callTool({ name: 'view', arguments: { assetId: 'a1', fromSec: 2, toSec: 4, perSecond: 2 } })
  assert.deepEqual(
    { contentId: seen[0].contentId, slide: seen[0].slide, atSec: seen[0].atSec, sound: seen[0].sound },
    { contentId: 'post-1', slide: 4, atSec: [1, 3.5], sound: true },
  )
  assert.deepEqual({ assetId: seen[1].assetId, fromSec: seen[1].fromSec, toSec: seen[1].toSec, perSecond: seen[1].perSecond }, { assetId: 'a1', fromSec: 2, toSec: 4, perSecond: 2 })
  const { tools } = await mcp.listTools()
  const view = tools.find((t) => t.name === 'view')
  assert.match(view.description, /a tracked post's video with contentId \(and slide for a carousel\) once analyze_content kind video has downloaded it/)
  assert.ok(['contentId', 'slide', 'atSec'].every((k) => k in view.inputSchema.properties))
})

/**
 * A post is named by its contentId and slide, never by its copy's address; its frames come as images labeled with their
 * time, and its sound as the edit's sound render is shown: the measurement, where its sounds start, and its picture as
 * an image, its data kept out of the JSON. A sound that could not be heard says why. Break-verified: dropping the
 * sound picture from clipSection turns the first red; dropping describeSourceSound, the onset and error assertions.
 */
test("view shows a post's frames and its sound, with the picture as an image", async () => {
  const clip = {
    contentId: 'post-1', slide: 4, type: 'video', fromSec: 2, toSec: 4, durationSeconds: 10,
    keyframes: [{ atSec: 2, dataUrl: 'data:image/jpeg;base64,SzE=' }],
    sound: {
      kind: 'sound', fromSec: 2, toSec: 4, sampleRate: 48000, channels: 2, durationSeconds: 2,
      loudness: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 3, samplePeakDbfs: -1.2 },
      stereo: { sideToMid: 0.2, correlation: 0.9 }, bands: {}, onsets: [{ seconds: 2.25 }, { seconds: 3.5 }],
      picture: { width: 1240, height: 402, dataUrl: 'data:image/webp;base64,U05E' }, audioUrl: 'https://media.test/w.wav',
    },
  }
  const mcp = await connect(fakeClient({ view: async () => ({ clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { contentId: 'post-1', slide: 4, fromSec: 2, toSec: 4, count: 1, sound: true } })
  const text = res.content[0].text
  assert.match(text, /Tracked post post-1, its video \(slide 4\) \(10\.00s long\), from 2s to 4s/)
  assert.match(text, /Its sound from 2s to 4s, as it is: Integrated loudness -14 LUFS/)
  assert.match(text, /Sounds start at 2\.25s, 3\.5s, in the source's own seconds\./)
  assert.match(text, /A picture of the sound is attached below/)
  assert.doesNotMatch(text, /U05E|SzE=/)
  assert.deepEqual(res.content.slice(1).map((c) => (c.type === 'image' ? c.data : c.text)), ['At 2s:', 'SzE=', 'Its sound:', 'U05E'])

  const silent = await connect(
    fakeClient({ view: async () => ({ clip: { contentId: 'post-1', type: 'video', sound: { kind: 'sound', error: { code: 'no_sound', message: 'This video has no sound.' } } } }) }),
  )
  const quiet = await silent.callTool({ name: 'view', arguments: { contentId: 'post-1', sound: true } })
  assert.match(quiet.content[0].text, /The sound could not be heard\. no_sound: This video has no sound\./)
})

/**
 * Where video cannot be received, the server renders the range's frames into `rendered` and its sound into
 * `renderedSound`, and the sound reads exactly as a sound render does. Break-verified: dropping the renderedSound
 * section from viewResult turns this red.
 */
test('view shows the frames and the sound of a video range', async () => {
  const rendered = {
    renderId: 'r5', state: 'done', kind: 'picture', layout: 'frames',
    frames: [{ frame: 0, dataUrl: 'data:image/webp;base64,RjA=' }, { frame: 30, dataUrl: 'data:image/webp;base64,RjE=' }],
  }
  const renderedSound = {
    renderId: 'r6', state: 'done', kind: 'sound', fromFrame: 0, toFrame: 60,
    loudness: { integratedLufs: -15, truePeakDbtp: -1.5, loudnessRangeLu: 4, samplePeakDbfs: -2 },
    onsets: [], stereo: null,
    picture: { width: 1240, height: 402, dataUrl: 'data:image/webp;base64,U05E' },
  }
  const mcp = await connect(fakeClient({ view: async () => ({ rendered, renderedSound }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', video: true, fromFrame: 0, toFrame: 60 } })
  assert.deepEqual(res.content.filter((c) => c.type === 'image').map((i) => i.data), ['RjA=', 'RjE=', 'U05E'])
  assert.match(res.content[0].text, /2 rendered frames are attached below, in order\./)
  assert.match(res.content[0].text, /A picture of the sound is attached below/)
  assert.match(res.content[0].text, /Integrated loudness -15 LUFS, true peak -1\.5 dBTP/)
  assert.ok(res.content.some((c) => c.type === 'text' && c.text === 'The sound of the same range:'))
  assert.doesNotMatch(res.content[0].text, /U05E|RjA=/)
})

/**
 * A project window asked only of its picture analysis answers in numbers, with no live context, and the inputs reach the
 * client. Break-verified: dropping the picture part from viewResult turns this red (it reads as no live context).
 */
test('view answers a project window\'s picture analysis in numbers', async () => {
  let asked: Record<string, unknown> = {}
  const unseen = [{ clipId: 'code-1', trackId: 'fx', fromFrame: 0, toFrame: 90, why: 'no_file' }]
  const picture = { status: 'ready', version: 1, fps: 30, fromFrame: 0, toFrame: 300, sources: [], unseen, nextCursor: 'NEXT', cost: { credits: 12 } }
  const mcp = await connect(fakeClient({ view: async (input: Record<string, unknown>) => ((asked = input), { picture }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', find: 'a face', where: true, fromFrame: 0, toFrame: 300 } })
  assert.equal(asked.find, 'a face')
  assert.equal(asked.where, true)
  assert.match(res.content[0].text, /The picture analysis of the project's window/)
  // The clips it cannot see are named, with why, once (in the JSON); the lines say how many and where to find them.
  assert.match(res.content[0].text, /1 clip on this page is not seen by it \(code, text or a shape; a still image; a file not stored here\), listed in unseen with why\./)
  assert.equal(res.content[0].text.match(/"code-1"/g)?.length, 1)
  assert.match(res.content[0].text, /Answering it was charged 12 credits\./)
  assert.match(res.content[0].text, /More: pass cursor "NEXT"\./)
  assert.equal(res.content.filter((c) => c.type === 'image').length, 0)
})

/**
 * A raw clip's keyframes come back as images, each labeled with its time in the clip, within the one result budget,
 * with no live tab. Break-verified: dropping the clip from the "No live context" check turns both red; dropping the
 * time labels turns the first red; admitting keyframes without the budget turns the second red.
 */
test('view shows a raw clip by its keyframes, each labeled with its time', async () => {
  const clip = {
    url: 'https://media.contenthero.ai/c.mp4', type: 'video', fromSec: 1, toSec: 3, durationSeconds: 12,
    keyframes: [{ atSec: 1, dataUrl: 'data:image/jpeg;base64,SzE=' }, { atSec: 2.5, dataUrl: 'data:image/jpeg;base64,SzI=' }],
  }
  const mcp = await connect(fakeClient({ view: async () => ({ clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { assetId: 'a1', fromSec: 1, toSec: 3 } })
  assert.doesNotMatch(res.content[0].text, /No live context/)
  assert.match(res.content[0].text, /Raw source clip \(video\) \(12\.00s long\), from 1s to 3s: https:\/\/media\.contenthero\.ai\/c\.mp4/)
  assert.match(res.content[0].text, /2 keyframe\(s\) of the source are attached below/)
  assert.doesNotMatch(res.content[0].text, /SzE=/)
  assert.deepEqual(
    res.content.slice(1).map((c) => (c.type === 'image' ? c.data : c.text)),
    ['At 1s:', 'SzE=', 'At 2.5s:', 'SzI='],
  )
})

/**
 * A region on a raw clip is in the clip's own pixels and cuts each frame; the answer says how the cut maps back, or why
 * it could not be cut, in get_media's zoom wording. Break-verified: dropping the describeCrop line from describeClip
 * turns the second and third assertions red; dropping the clip sentence from region's description turns the first red.
 */
test("view cuts a clip's frames to a region and says how they map back", async () => {
  const mcp = await connect(
    fakeClient({
      view: async () => ({
        clip: {
          url: 'https://media.contenthero.ai/c.mp4', type: 'video',
          // How the frames map back to the source (gap closure D2: `pixels`, the region cut by the service).
          pixels: { width: 640, height: 360, region: { x: 960, y: 540, width: 960, height: 540 }, pixelsPerSourcePixel: 0.6667 },
        },
      }),
    }),
  )
  const { tools } = await mcp.listTools()
  const region = tools.find((t) => t.name === 'view').inputSchema.properties.region
  assert.match(region.description, /For a source, the rectangle is in its own pixels\.$/)
  const res = await mcp.callTool({ name: 'view', arguments: { assetId: 'a1', region: { x: 960, y: 540, width: 960, height: 540 } } })
  assert.match(res.content[0].text, /Zoom: 960x540 at \(960, 540\) in the file's pixels, shown at 640x360 \(0\.6667 px per file px\)/)
  const failed = await connect(
    fakeClient({
      view: async () => ({ clip: { url: 'https://media.contenthero.ai/c.mp4', type: 'video', keyframeError: 'The region has no area inside the 1920x1080 video.' } }),
    }),
  )
  const why = await failed.callTool({ name: 'view', arguments: { assetId: 'a1', region: { x: 0, y: 0, width: 10, height: 10 } } })
  assert.match(why.content[0].text, /Keyframes not shown: The region has no area inside the 1920x1080 video\./)
})

test('view keyframes spend the one result budget, and a clip that failed says why', async () => {
  const frame = (c, atSec) => ({ atSec, dataUrl: `data:image/jpeg;base64,${c.repeat(400_000)}` })
  const clip = { url: 'https://media.contenthero.ai/c.mp4', type: 'video', keyframes: [frame('A', 0), frame('B', 1), frame('C', 2)] }
  const mcp = await connect(fakeClient({ view: async () => ({ clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { assetId: 'a1', count: 3 } })
  assert.deepEqual(res.content.filter((c) => c.type === 'image').map((i) => i.data[0]), ['A', 'B'])
  assert.match(res.content[0].text, /1 keyframe\(s\) not shown: too large for this reply\. Ask for fewer frames or a narrower fromSec\/toSec\./)

  const failed = await connect(
    fakeClient({
      view: async () => ({
        clip: { url: 'https://media.contenthero.ai/c.mp4', type: 'video', keyframeError: 'The video service is unavailable.', error: { code: 'clip_unreadable', message: 'The clip could not be opened.' } },
      }),
    }),
  )
  const why = await failed.callTool({ name: 'view', arguments: { assetId: 'a1' } })
  assert.match(why.content[0].text, /Keyframes not shown: The video service is unavailable\./)
  assert.match(why.content[0].text, /The clip could not be read\. clip_unreadable: The clip could not be opened\./)
})

/**
 * ⭐ A RENDER REACHES THE AGENT WITH OR WITHOUT A LIVE TAB, AND A FAILED ONE SAYS WHY.
 *
 * The API returns a render with `participant: null` when no one is viewing (render works from the saved project).
 * The formatter answered "No live context" whenever the participant was null, so that render was thrown away, and
 * a render that failed carried its reason only inside JSON nobody summarized. Break-verified: restoring
 * `if (!context || !participant)` turns the first, second and fourth red (each has no live tab); dropping
 * the failure sentence (`describeRenderFailure`) turns the second and third red; attaching every frame regardless of the budget turns the
 * fourth red.
 */
const noTab = (rendered) =>
  fakeClient({ view: async () => ({ rendered }) })

test('view shows a render with no live tab', async () => {
  const mcp = await connect(noTab({ surface: 'editor', frame: 12, dataUrl: 'data:image/webp;base64,AQIDBA==' }))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, frame: 12 } })
  const image = res.content.find((c) => c.type === 'image')
  assert.ok(image, 'the render must come back even though no one is viewing the project')
  assert.equal(image.data, 'AQIDBA==')
  assert.doesNotMatch(res.content[0].text, /Live context/)
  assert.doesNotMatch(res.content[0].text, /No live context/)
})

test('view states why a render produced no image, with no live tab', async () => {
  const mcp = await connect(noTab({ error: { code: 'render_unavailable', message: 'Rendering is unavailable right now.' } }))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true } })
  assert.equal(res.content.filter((c) => c.type === 'image').length, 0)
  assert.match(res.content[0].text, /The render produced no image\. render_unavailable: Rendering is unavailable right now\./)
})

test('view names the frames of a range that did not render', async () => {
  const rendered = {
    fromFrame: 0,
    toFrame: 60,
    frames: [{ frame: 0, dataUrl: 'data:image/webp;base64,AAAA' }, { frame: 60, dataUrl: 'data:image/webp;base64,CCCC' }],
    missingFrames: [30],
    error: { code: 'render_failed', message: 'Lambda timed out' },
  }
  const mcp = await connect(
    fakeClient({
      view: async () => ({
        live: { context: { surface: 'editor' }, participant: { userId: 'u1', sessionId: 's', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-10-04T00:00:00Z' }, participants: [{ userId: 'u1', sessionId: 's', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-10-04T00:00:00Z' }] },
        rendered,
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'view', arguments: { render: true, count: 3, fromFrame: 0, toFrame: 60 } })
  assert.equal(res.content.filter((c) => c.type === 'image').length, 2)
  assert.match(res.content[0].text, /1 frame could not be rendered \(frames 30\)\. render_failed: Lambda timed out/)
})

/**
 * Full resolution is reachable: the width limit was 1440 while the server rendered at 960, and a region crops at native
 * scale. Break-verified: restoring `.max(1440)` turns it red; dropping `region: args.region` turns it red too.
 */
test('view accepts a native-width render and forwards a region', async () => {
  let seen
  const mcp = await connect(fakeClient({ view: async (input) => ((seen = input), { live: { context: null, participant: null, participants: [] } }) }))
  const res = await mcp.callTool({
    name: 'view',
    arguments: { projectId: 'p1', render: true, width: 3840, region: { x: 480, y: 270, width: 240, height: 135 } },
  })
  assert.ok(!res.isError, `the call was refused: ${JSON.stringify(res.content)}`)
  assert.equal(seen.width, 3840)
  assert.deepEqual(seen.region, { x: 480, y: 270, width: 240, height: 135 })
})

test('view frames spend the one result budget and name the frames that did not fit', async () => {
  // 24 frames of 100,000 base64 characters each is 2.4 MB against a 1 MB ceiling for the whole result.
  const frames = Array.from({ length: 24 }, (_, i) => ({ frame: i * 10, dataUrl: `data:image/webp;base64,${'A'.repeat(100_000)}` }))
  const mcp = await connect(noTab({ fromFrame: 0, toFrame: 230, frames }))
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, count: 24 } })
  const images = res.content.filter((c) => c.type === 'image')
  const bytes = images.reduce((n, c) => n + c.data.length, 0)
  assert.ok(bytes <= 900_000, `inline images must stay inside the result allowance (got ${bytes})`)
  assert.equal(images.length, 9)
  assert.match(res.content[0].text, /15 rendered images were not attached \(frames 90, 100, .*230\): over this result's size limit/)
})

/**
 * The preview video is retired (motion graphics 9.8, pass B): no agent can receive video over MCP, so there is no
 * `get_preview`, the render takes no `mode` (images are its only medium), and the render's description says, as a
 * principle, that frames across a range are how an agent judges motion. Break-verified: restoring `get_preview` or a
 * `mode` turns case 1 red; dropping the sentence, case 2.
 */
test('view takes no mode, and get_preview is gone', async () => {
  let sent
  const mcp = await connect(fakeClient({ view: async (input) => ((sent = input), { live: { context: null, participant: null, participants: [] } }) }))
  const { tools } = await mcp.listTools()
  assert.equal(tools.some((t) => t.name === 'get_preview'), false)
  const schema = tools.find((t) => t.name === 'view')?.inputSchema
  assert.equal('mode' in (schema?.properties ?? {}), false)
  // The tool's schema is strict, so a caller still sending a medium is refused, never answered with images unasked.
  const res = await mcp.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, mode: 'video' } })
  assert.equal(res.isError, true)
  assert.equal(sent, undefined)
})

test('view says frames across a range are how motion is judged', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const schema = tools.find((t) => t.name === 'view')?.inputSchema as { properties: Record<string, { description?: string; enum?: string[] }> }
  assert.match(schema.properties.render?.description ?? '', /Frames across a range show motion, timing and pacing/)
})

test("get_schema kind 'layer' detail 'full' lists canvas layer types + props", async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'layer', detail: 'full' } })
  const body = (res.content[0]).text
  assert.match(body, /Canvas layer types/)
  assert.match(body, /text/)
})

// The canvas schema reads in two steps, as the timeline's does (2026-10-10).
test("get_schema kind 'layer' reads the index, one entry by name, or the whole on request", async () => {
  const seen: unknown[] = []
  const index = { projectType: 'canvas', surface: 'canvas', description: 'The canvas index.', rules: ['Each op is { op, ...fields }.'], layerTypes: [{ type: 'text', description: 'A text.', supports: ['base'] }], ops: [{ op: 'create_layer', shape: "{ op: 'create_layer', layer, slideId? }" }] }
  const op = { entry: 'op', op: 'create_layer', shape: "{ op: 'create_layer', layer, slideId? }", description: 'Add a new layer.' }
  const layerType = { entry: 'layerType', layerType: { type: 'text', description: 'A text.', props: [{ name: 'text', type: 'string' }], supports: ['base'] }, sharedProps: { base: [] } }
  const mcp = await connect(
    fakeClient({
      getLayerTypes: async (options?: { name?: string; detail?: string }) => {
        seen.push(options)
        if (options?.name === 'create_layer') return op
        if (options?.name === 'text') return layerType
        return index
      },
    } as never),
  )
  const read = async (args: Record<string, unknown>) => (await mcp.callTool({ name: 'get_schema', arguments: { kind: 'layer', ...args } })).content[0].text as string
  const indexText = await read({})
  assert.match(indexText, /^The canvas index\./)
  assert.match(indexText, /Rules:\n- Each op is \{ op, \.\.\.fields \}\./)
  assert.match(indexText, /Ops:\n- \{ op: 'create_layer', layer, slideId\? \}/)
  assert.match(indexText, /Layer types:\n- text: A text\./)
  assert.match(await read({ name: 'create_layer' }), /^\{ op: 'create_layer', layer, slideId\? \}\nAdd a new layer\./)
  assert.match(await read({ name: 'text', jsonSchema: true }), /^text: A text\.\nFields: text\nShared groups: base/)
  await read({ detail: 'full' })
  assert.deepEqual(seen, [{}, { name: 'create_layer' }, { jsonSchema: true, name: 'text' }, { detail: 'full' }])
})

/**
 * get_schema kind 'code' prints the guide the app rendered, verbatim, so the MCP never holds a second rendering of
 * it that could drift. Break-verified: dropping the case leaves the kind unhandled and the call returns nothing.
 */
test("get_schema kind 'code' prints the app's code guide as one document, with its version", async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'code' } })
  const body = (res.content[0]).text
  assert.match(body, /^# Writing a clip's code\n\nA clip's code is a React component\./)
  assert.match(body, /\(Guide version abc12345\.\)$/)
  assert.ok(!res.isError)
  // The retired kind 'graphic' is refused at the schema boundary (a rejected call or an isError result), never served.
  let refused = false
  try {
    refused = (await mcp.callTool({ name: 'get_schema', arguments: { kind: 'graphic' } })).isError === true
  } catch {
    refused = true
  }
  assert.ok(refused, "kind 'graphic' must be refused")
})

/**
 * get_schema kind 'effect' (motion graphics 7.25, 7.37): the effect catalog by group, saying where each can go, and one
 * effect in full by its name; a name on any other kind is refused rather than ignored.
 */
test("get_schema kind 'effect' lists the effects, reads one by name, and refuses a name on any other kind", async () => {
  const asked = []
  const mcp = await connect(
    fakeClient({
      listEffects: async () => (asked.push('list'), {
        effects: [
          { name: 'glow', group: 'Blur & Shadow', description: 'Soft halo effect', importPath: '@remotion/effects/glow', onClips: true },
          { name: 'blur', group: 'Blur & Shadow', description: 'Gaussian blur effect', importPath: '@remotion/effects/blur', onClips: false, gradedBy: 'Blur' },
        ],
        codeHosts: ['Solid', 'Img'],
      }),
      getEffect: async (name) => (asked.push(`get ${name}`), {
        name, group: 'Blur & Shadow', description: 'Soft halo effect', importPath: '@remotion/effects/glow', onClips: true,
        backend: 'webgl2', documentation: 'https://www.remotion.dev/docs/effects/glow',
        params: { radius: { type: 'number', min: 0, max: 200, default: 20, description: 'Radius' } },
        defaults: {}, keyframeable: ['radius'],
      }),
    }),
  )
  const list = (await mcp.callTool({ name: 'get_schema', arguments: { kind: 'effect' } })).content[0].text
  assert.match(list, /^2 effects\. In code, they go on Solid, Img; on a video or image clip, in its effects\./)
  assert.match(list, /- blur \(@remotion\/effects\/blur\): Gaussian blur effect\. code only; on a clip, Blur does this\./)
  const one = (await mcp.callTool({ name: 'get_schema', arguments: { kind: 'effect', name: 'glow' } })).content[0].text
  assert.match(one, /- radius: number 0\.\.200, default 20 \(Radius\)/)
  assert.match(one, /Keyframeable on a clip \(effects\.<id>\.<param>\): radius/)
  const refused = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'export', name: 'glow' } })
  assert.ok(refused.isError)
  assert.match(refused.content[0].text, /kind 'export' takes no name; it belongs to kinds 'effect', 'timeline' and 'layer'\./)
  assert.deepEqual(asked, ['list', 'get glow'])
})

test("get_schema kind 'timeline' lists clip + track types", async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'timeline' } })
  const body = (res.content[0]).text
  assert.match(body, /Track types/)
  assert.match(body, /media/)
})

test("get_schema passes jsonSchema through for kinds 'timeline' and 'layer', and refuses it elsewhere", async () => {
  const seen: unknown[] = []
  const mcp = await connect(
    fakeClient({
      getTimelineTypes: async (options?: unknown) => {
        seen.push(options)
        return { projectType: 'editor', surface: 'editor', description: 'd', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, clipTypes: [], trackTypes: [] }
      },
    }),
  )
  await mcp.callTool({ name: 'get_schema', arguments: { kind: 'timeline', jsonSchema: true } })
  assert.deepEqual(seen[0], { jsonSchema: true })
  const refused = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'export', jsonSchema: true } })
  assert.equal(refused.isError, true)
  assert.match((refused.content[0]).text, /takes no jsonSchema/)
})

// The timeline schema reads in two steps (2026-10-09): the whole is larger than one tool result carries.
test("get_schema kind 'timeline' reads the index, one entry by name, or the whole on request", async () => {
  const seen: unknown[] = []
  const index = { projectType: 'editor', surface: 'editor', description: 'The index.', rules: ['Mint your own string ids.'], clipTypes: [{ type: 'video', description: 'A video.', supports: ['base'] }], trackTypes: [{ trackType: 'media', description: 'm', holds: ['video'] }], ops: [{ op: 'create_clip', shape: "{ op: 'create_clip', trackId, clip }", use: 'create' }, { op: 'update_clip', shape: "{ op: 'update_clip', clipId, patch?, edits? }", use: 'edit' }] }
  const op = { entry: 'op', op: 'update_clip', shape: "{ op: 'update_clip', clipId, patch?, edits? }", description: 'Patch one clip.', use: 'edit' }
  const clipType = { entry: 'clipType', clipType: { type: 'video', description: 'A video.', props: [{ name: 'code', type: 'string' }], supports: ['base'] }, sharedProps: { base: [] } }
  const mcp = await connect(
    fakeClient({
      getTimelineTypes: async (options?: { name?: string; detail?: string }) => {
        seen.push(options)
        if (options?.name === 'update_clip') return op
        if (options?.name === 'video') return clipType
        return index
      },
    } as never),
  )
  const read = async (args: Record<string, unknown>) => (await mcp.callTool({ name: 'get_schema', arguments: { kind: 'timeline', ...args } })).content[0].text as string
  const indexText = await read({})
  assert.match(indexText, /^The index\./)
  assert.match(indexText, /Rules:\n- Mint your own string ids\./)
  assert.match(indexText, /Create ops:\n- \{ op: 'create_clip', trackId, clip \}/)
  assert.match(indexText, /Edit ops:\n- \{ op: 'update_clip', clipId, patch\?, edits\? \}/)
  assert.match(await read({ name: 'update_clip' }), /^\{ op: 'update_clip', clipId, patch\?, edits\? \}\nPatch one clip\./)
  assert.match(await read({ name: 'video', jsonSchema: true }), /^video: A video\.\nFields: code\nShared groups: base/)
  await read({ detail: 'full' })
  assert.deepEqual(seen, [{}, { name: 'update_clip' }, { jsonSchema: true, name: 'video' }, { detail: 'full' }])
  const refused = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'code', detail: 'full' } })
  assert.equal(refused.isError, true)
  assert.match((refused.content[0]).text, /kind 'code' takes no detail; it belongs to kinds 'timeline' and 'layer'\./)
})

test('update_timeline and update_canvas say a batch is atomic; get_project names the main track', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const description = (name: string) => tools.find((t) => t.name === name)!.description ?? ''
  for (const name of ['update_timeline', 'update_canvas']) {
    assert.match(description(name), /A batch is ordered and atomic: when any operation is refused, nothing is stored/)
  }
  assert.match(description('get_project'), /whether it is the main track and whether it is muted or hidden/)
  assert.match(description('get_project'), /speed, whether it is disabled and source/)
})

/**
 * The summary names what changes what plays, each only when set; the text carries them as the server sent them and adds
 * none. Break-verified: dropping `muted` from the fixture's music track turns the first assertion red.
 */
test('get_project shows a muted track, a hidden track and a disabled clip, and only when set', async () => {
  const base = await fakeClient().getProject('p1', {})
  const clip = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'video', from: 0, durationInFrames: 30, trackId: 't', ...extra })
  const state = {
    tracks: [
      { id: 'main', name: 'Main', trackType: 'media', isPrimary: true, items: [clip('a'), clip('b', { disabled: true })] },
      { id: 'music', name: 'Music', trackType: 'audio', muted: true, items: [] },
      { id: 'over', name: 'Overlay', trackType: 'media', hidden: true, items: [] },
      { id: 'plain', name: 'Plain', trackType: 'media', items: [clip('p')] },
    ],
  }
  const mcp = await connect(fakeClient({ getProject: async () => ({ ...base, type: 'editor', state }) }))
  const res = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1' } })
  const text = res.content[0].text as string
  const json = JSON.parse(text.slice(text.indexOf('{')))
  const byId = Object.fromEntries(json.tracks.map((t: Record<string, unknown>) => [t.id, t]))
  assert.equal(byId.music.muted, true)
  assert.equal(byId.over.hidden, true)
  assert.equal(byId.main.muted, undefined)
  assert.equal('muted' in byId.plain || 'hidden' in byId.plain, false)
  assert.equal(byId.main.items[1].disabled, true)
  assert.equal('disabled' in byId.main.items[0], false)
  assert.equal('disabled' in byId.plain.items[0], false)
})

// F23: `solid` was retired 2026-09-13; the tool description offered it to agents for weeks after.
test('get_schema does not offer the retired solid layer type', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const description = tools.find((t) => t.name === 'get_schema')!.description ?? ''
  assert.doesNotMatch(description, /\bsolid\b/)
  assert.match(description, /shape/)
})

/**
 * ⛔ `includeRenderUrl` IS RETIRED (2026-10-04): it made a read and an edit render and SAVE a cover, and the url it
 * returned was the stored address an agent could not download. view's render is the one way to see a project.
 * Break-verified: restoring the parameter on any of the three tools turns this red.
 */
test('get_project and the edit tools offer no render option', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  for (const name of ['get_project', 'update_timeline', 'update_canvas']) {
    const properties = Object.keys(tools.find((t) => t.name === name)?.inputSchema.properties ?? {})
    assert.ok(properties.length > 0, `${name} is registered`)
    assert.ok(!properties.includes('includeRenderUrl'), `${name} still offers includeRenderUrl`)
  }
})

test('create_project returns the new id + revision', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'create_project', arguments: { type: 'canvas', title: 'Deck' } })
  assert.ok(!res.isError)
  const body = (res.content[0]).text
  assert.match(body, /Created canvas project new1/)
  assert.match(body, /update_canvas/)
})

test('create_project names a new editor project\'s main track, so the first clips go on it', async () => {
  const { projectCreatedResult } = await import('./format.js')
  const res = projectCreatedResult({
    id: 'p1', type: 'editor', title: 'Edit', orientation: '9:16', width: 1080, height: 1920, revision: 0,
    state: { tracks: [{ id: 'media-1', isPrimary: true, items: [] }] },
  } as never)
  assert.match((res.content[0] as { text: string }).text, /Main track: media-1\. Add the first clips to it\./)
  const canvas = projectCreatedResult({ id: 'c1', type: 'canvas', title: 'Deck', orientation: '1:1', width: 1080, height: 1080, revision: 0, state: { slides: [] } } as never)
  assert.doesNotMatch((canvas.content[0] as { text: string }).text, /Main track/)
})

test('import of a page address reports what its download cost', async () => {
  const mcp = await connect(fakeClient({
    import: async () => ({ outputId: 'im1', shortId: 'Imp00001', appUrl: 'https://app/m/Imp00001', url: 'https://cdn/v.mp4', alreadyExisted: false, contentType: 'video', charge: CHARGE }),
  }))
  const res = await mcp.callTool({ name: 'import', arguments: { url: 'https://www.youtube.com/watch?v=x' } })
  assert.ok(!res.isError)
  assert.match(res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), /Cost: 7 credits charged\./)
})

test('import of a pptxUrl creates a canvas project from a file URL', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'import', arguments: { pptxUrl: 'https://x/deck.pptx' } })
  assert.ok(!res.isError)
  assert.match((res.content[0]).text, /Created canvas project imp1/)
})

test('import of a canvaDesignId hands the design to importProject', async () => {
  let seen
  const mcp = await connect(fakeClient({ importProject: async (input) => { seen = input; return { id: 'imp2', type: 'canvas', kind: 'canvas', title: 'D', orientation: '16:9', width: 1920, height: 1080, revision: 0, state: { slides: [] } } } }))
  const res = await mcp.callTool({ name: 'import', arguments: { canvaDesignId: 'DAF1', title: 'D' } })
  assert.ok(!res.isError)
  assert.deepEqual(seen, { source: { type: 'canva', designId: 'DAF1' }, title: 'D', cardId: undefined })
})

test('import takes exactly one source, and refuses an input that belongs to another source', async () => {
  const mcp = await connect(fakeClient())
  const none = await mcp.callTool({ name: 'import', arguments: {} })
  assert.ok(none.isError)
  assert.match(none.content[0].text, /exactly one source/)
  const two = await mcp.callTool({ name: 'import', arguments: { url: 'https://x/a.png', pptxUrl: 'https://x/d.pptx' } })
  assert.ok(two.isError)
  assert.match(two.content[0].text, /got url and pptxUrl/)
  const stray = await mcp.callTool({ name: 'import', arguments: { pptxUrl: 'https://x/d.pptx', fileName: 'a.mp4' } })
  assert.ok(stray.isError)
  assert.match(stray.content[0].text, /go with url only/)
  const card = await mcp.callTool({ name: 'import', arguments: { url: 'https://x/a.png', cardId: 'c1' } })
  assert.ok(card.isError)
  assert.match(card.content[0].text, /go with pptxUrl or canvaDesignId only/)
})

test('import takes no contentId: a tracked post\'s video is analyze_content kind video', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const imp = tools.find((t) => t.name === 'import')
  assert.deepEqual(Object.keys(imp.inputSchema.properties).sort(), ['canvaDesignId', 'cardId', 'contentType', 'fileName', 'getCost', 'pptxUrl', 'title', 'url'])
  assert.match(imp.description, /analyze_content with kind video/)
  const analyze = tools.find((t) => t.name === 'analyze_content')
  assert.deepEqual(analyze.inputSchema.properties.kind.enum, ['breakdown', 'scenes', 'video'])
})

test('import getCost prices a url through the SDK, and a project as free without asking', async () => {
  const asked = []
  const mcp = await connect(fakeClient({
    estimateImportCost: async (url) => { asked.push(url); return { getCost: true, creditsEstimate: 0 } },
  }))
  const file = await mcp.callTool({ name: 'import', arguments: { url: 'https://x/a.png', getCost: true } })
  assert.match(file.content[0].text, /costs 0 credits: it is a file/)
  const deck = await mcp.callTool({ name: 'import', arguments: { pptxUrl: 'https://x/d.pptx', getCost: true } })
  assert.match(deck.content[0].text, /canvas project costs 0 credits/)
  assert.deepEqual(asked, ['https://x/a.png'])
})

test('analyze_content kind video asks again while its copy downloads, then names where it stands and its cut list', async () => {
  const answers = [
    { contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'pending' }, videos: [{ copy: { status: 'pending' } }], charge: null },
    { contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'ready' }, videos: [{ copy: { status: 'ready' }, cuts: { boundaries: [1.5, 4.25], scores: [0.9, 0.7], durationSec: 9 } }], charge: null },
  ]
  let asked = 0
  const mcp = await connect(fakeClient({
    analyzeContent: async (id, opts) => { assert.equal(id, 'c1'); assert.deepEqual(opts, { kind: 'video' }); return answers[Math.min(asked++, 1)] },
  }))
  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video' } })
  assert.ok(!res.isError)
  assert.equal(asked, 2)
  assert.match(res.content[0].text, /Con00001/)
  assert.match(res.content[0].text, /Its video is ready in the post's shared analysis copies/)
  assert.match(res.content[0].text, /Video: ready; cut list: 2 cuts in 9\.0s, at 1\.50s, 4\.25s\./)
  assert.equal(res.structuredContent.status, 'ready')
  assert.deepEqual(res.structuredContent.videos[0].cuts.boundaries, [1.5, 4.25])
  assert.equal(res.structuredContent.cuts, undefined)
})

test('analyze_content kind video asks once for more detail, follows the upgrade without asking again, and says what each copy is', async () => {
  const at = (copy: Record<string, unknown>) => ({ contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy, videos: [{ copy }], charge: null })
  const answers = [at({ status: 'ready', resolution: 360, upgrading: { resolution: 1080 } }), at({ status: 'ready', resolution: 1080 })]
  const seen: unknown[] = []
  const mcp = await connect(fakeClient({ analyzeContent: async (_id, opts) => (seen.push(opts), answers[Math.min(seen.length - 1, 1)]) }))
  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video', resolution: '1080p' } })
  assert.ok(!res.isError)
  assert.deepEqual(seen, [{ kind: 'video', resolution: '1080p' }, { kind: 'video' }])
  assert.match(res.content[0].text, /Video: ready at 1080p\./)

  // Still upgrading at the end of the call: the stored copy is readable and how to follow it is named.
  const waiting = await connect(fakeClient({ analyzeContent: async () => answers[0] }))
  const text = (await waiting.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video' } })).content[0].text
  assert.match(text, /Video: ready at 360p; a 1080p copy is downloading; the 360p copy stays readable until it lands\./)

  // A resolution is for kind video only.
  const refused = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'scenes', resolution: '1080p' } })
  assert.ok(refused.isError)
  assert.match(refused.content[0].text, /resolution applies only to kind video/)
})

test('analyze_content kind video getCost lists the detail stored and offered, and the price of each upgrade', async () => {
  const mcp = await connect(fakeClient({
    estimateAnalysisCost: async () => ({ getCost: true, creditsEstimate: 0, videos: [{ stored: 360, offered: [360, 720, 1080] }], upgrades: [{ resolution: 720, creditsEstimate: 13 }, { resolution: 1080, creditsEstimate: 27 }] }),
  }))
  const text = (await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video', getCost: true } })).content[0].text
  assert.match(text, /Stored copy: 360p\. The platform offers: 360p, 720p, 1080p\./)
  assert.match(text, /Upgrade to 720p: about 13 credits\./)
  assert.match(text, /Upgrade to 1080p: about 27 credits\./)
})

test('analyze_content kind video on a carousel reports each video slide, by slide, with its state and cut list', async () => {
  const carousel = {
    contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'failed', error: 'one slide could not be read.' },
    videos: [
      { slide: 1, copy: { status: 'ready' }, cuts: { boundaries: [2], scores: [0.8], durationSec: 6 } },
      { slide: 3, copy: { status: 'failed', error: 'the page listed no file.' } },
    ],
    charge: null,
  }
  const mcp = await connect(fakeClient({ analyzeContent: async () => carousel }))
  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video' } })
  assert.ok(!res.isError)
  const text = res.content[0].text
  assert.match(text, /A download failed: one slide could not be read\. Asking again tries once more\./)
  assert.match(text, /Slide 2 \(slide: 1\): ready; cut list: 1 cut in 6\.0s, at 2\.00s\./)
  assert.match(text, /Slide 4 \(slide: 3\): the download failed: the page listed no file\./)
  assert.deepEqual(res.structuredContent.videos.map((v) => v.slide), [1, 3])
})

test('analyze_content kind video still downloading at the end of the call says to ask again with the same kind', async () => {
  const pending = { contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'pending' }, videos: [{ copy: { status: 'pending' } }], charge: null }
  const mcp = await connect(fakeClient({ analyzeContent: async () => pending }))
  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video' } })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /analyze_content \{ contentId: "Con00001", kind: "video" \} again, which is free/)
  assert.equal(res.structuredContent.status, 'pending')
})

test('analyze_content getCost for kind video prices the download', async () => {
  const asked = []
  const mcp = await connect(fakeClient({
    estimateAnalysisCost: async (id, opts) => { asked.push([id, opts]); return { getCost: true, creditsEstimate: 9 } },
  }))
  const res = await mcp.callTool({ name: 'analyze_content', arguments: { contentId: 'c1', kind: 'video', getCost: true } })
  assert.match(res.content[0].text, /at most 9 credits/)
  assert.deepEqual(asked, [['c1', { kind: 'video' }]])
})

test('export returns the download URL when it finishes in time', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'export', arguments: { projectId: 'p1', format: 'mp4' } })
  assert.ok(!res.isError)
  assert.match((res.content[0]).text, /completed/)
  assert.match((res.content[0]).text, /out\.mp4/)
})

test("export passes this export's loudness through, and the result says how it came out", async () => {
  let asked
  const mcp = await connect(
    fakeClient({
      exportProjectAndWait: async (projectId, input) => (
        (asked = [projectId, input]),
        { exportId: 'exp1', shortId: 'e', appUrl: 'https://app.example/e', status: 'completed', outputUrl: 'https://x/out.mp4', loudness: { target: -16, outcome: 'leveled', gainDb: 2, peakReductionDb: null, deliveredLufs: -16, deliveredTruePeakDbtp: -1.5, summary: 'Leveled to the project loudness.' } }
      ),
    }),
  )
  const res = await mcp.callTool({ name: 'export', arguments: { projectId: 'p1', format: 'mp4', loudness: -16 } })
  assert.deepEqual(asked, ['p1', { format: 'mp4', loudness: -16 }])
  assert.match(res.content[0].text, /Download: https:\/\/x\/out\.mp4\nLeveled to the project loudness\./)
  const off = await mcp.callTool({ name: 'export', arguments: { projectId: 'p1', loudness: 'off' } })
  assert.ok(!off.isError)
  assert.deepEqual(asked, ['p1', { loudness: 'off' }])
  const refused = await mcp.callTool({ name: 'export', arguments: { projectId: 'p1', loudness: 'loud' } })
  assert.ok(refused.isError)
})

test('get_export reads one export', async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_export', arguments: { exportId: 'exp1' } })
  assert.match((res.content[0]).text, /exp1/)
})

test("get_schema kind 'export' lists formats per project type", async () => {
  const mcp = await connect(fakeClient())
  const res = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'export' } })
  const body = (res.content[0]).text
  assert.match(body, /mp4/)
  assert.match(body, /pptx/)
})

test('get_schema refuses an input its kind does not take, instead of ignoring it', async () => {
  const mcp = await connect(fakeClient())
  const wrongKind = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'layer', platform: 'instagram' } })
  assert.ok(wrongKind.isError)
  assert.match(wrongKind.content[0].text, /kind 'layer' takes no platform or format/)
  const formatAlone = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'platform', format: 'reel' } })
  assert.ok(formatAlone.isError)
  assert.match(formatAlone.content[0].text, /format narrows one platform/)
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
        return { media: [], nextCursor: null }
      },
    }),
  )
  await mcp.callTool({ name: 'list_media', arguments: { source: 'uploads' } })
  assert.equal(captured.source, 'uploads')
})

test('list_media surfaces an upload file name, duration, and url inline', async () => {
  const mcp = await connect(
    fakeClient({
      listMedia: async () => ({
        media: [{
          id: 'up-uuid-1',
          type: 'video',
          model: null,
          prompt: null,
          status: 'completed',
          createdAt: 't',
          mediaId: 'Upl12345',
          url: 'https://cdn/editor-media-1.mp4',
          generationSize: 1,
          isFavorited: false,
          kind: 'upload',
          boardType: null,
          source: 'uploads',
          fileName: 'C0001.MP4',
          durationSeconds: 1792,
        }],
        nextCursor: null,
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'list_media', arguments: { source: 'uploads' } })
  assert.ok(!res.isError)
  assert.match(res.content[0].text, /C0001\.MP4/)
  assert.match(res.content[0].text, /1792s/)
  assert.match(res.content[0].text, /editor-media-1\.mp4/)
})

/**
 * The asset id is what get_project reports as a clip's `sourceId`; printed, so a clip can be matched to the library
 * item it was cut from. Break-verified: dropping `assetStr` from the row turns this red.
 */
test('list_media prints each item\'s asset id', async () => {
  const item = {
    id: 'up-uuid-1', type: 'video', model: null, prompt: null, status: 'completed', createdAt: 't', mediaId: 'Upl12345',
    url: 'https://cdn/editor-media-1.mp4', generationSize: 1, isFavorited: false, kind: 'upload', boardType: null,
    source: 'uploads', fileName: null, durationSeconds: null, assetId: '15bf8171-0000-4000-8000-000000000000',
  }
  const mcp = await connect(fakeClient({ listMedia: async () => ({ media: [item, { ...item, id: 'up-uuid-2', assetId: null }], nextCursor: null }) }))
  const res = await mcp.callTool({ name: 'list_media', arguments: { source: 'uploads' } })
  const [first, second] = res.content[0].text.split('\n').slice(1)
  assert.match(first, /\| asset 15bf8171-0000-4000-8000-000000000000 \|/)
  assert.doesNotMatch(second, /asset/)
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

// ── The DECIDER, which nothing tested until it shipped broken ────────────────────────────────────────────

/**
 * ⭐⭐⭐ **EVERY ATTACHMENT TEST IN `format.test.ts` HANDS THE FORMATTER AN ARRAY IT BUILT BY HAND.**
 *
 * That tests assembly, which was never wrong. The DECISION of block-versus-link lives in `attachmentsFor`,
 * and nothing called it, so it returned `kind: 'link'` for images for as long as it existed while the
 * formatter's `bytes` branch sat unreachable. The feature reached production not rendering in either host.
 *
 * ⚠️ Exported purely so this can address it. A test that cannot reach the decider is testing its neighbors.
 */
test('an image yields an inline BLOCK; video yields text alone', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    // ⚠️ THE RAW URL IS WHAT GETS FETCHED. `optimizedImageSibling` only rewrites the retired
    // `/object/public/studio-outputs/` path, so for a gateway url there is no sibling to prefer, and a
    // capability token could not read one anyway: it names a single object.
    assert.ok(url.includes('media.contenthero.ai'), 'the capability url itself is fetched')
    return new Response(Buffer.from('fake-image-bytes'), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '16' },
    })
  }) as typeof fetch
  try {
    const image = await attachmentsFor({
      outputId: 'o1', modelId: 'nb2', status: 'settled', contentType: 'image',
      outputs: outs(['https://media.contenthero.ai/u/a.png?t=tok']),
    } as never)
    assert.equal(image.filter((a) => a.kind === 'bytes').length, 1, 'an image MUST produce a block')
    // ⛔ NO `resource_link`. It was a third representation of a url the text list and the widget's
    // structuredContent both carry, and hosts run a sequence of them together without separators.
    assert.equal(image.filter((a) => a.kind === 'link').length, 0, 'the link is carried by the text list now')

    const video = await attachmentsFor({
      outputId: 'o2', modelId: 'v', status: 'settled', contentType: 'video',
      outputs: outs(['https://media.contenthero.ai/u/a.mp4?t=tok']),
    } as never)
    assert.equal(video.filter((a) => a.kind === 'bytes').length, 0, 'video has no MCP block to fill')
    assert.equal(video.filter((a) => a.kind === 'link').length, 0, 'the widget and the text list carry it')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('⛔ an oversized image degrades to text rather than eating the context', async () => {
  // A BACKSTOP, not a budget: real generated images are expected to pass. It exists so one pathological
  // file cannot put tens of megabytes of base64 into every later turn of the conversation.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Buffer.alloc(9_000_000), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' },
    })) as typeof fetch
  try {
    const out = await attachmentsFor({
      outputId: 'o3', modelId: 'nb2', status: 'settled', contentType: 'image',
      outputs: outs(['https://media.contenthero.ai/u/big.jpg?t=tok']),
    } as never)
    assert.equal(out.filter((a) => a.kind === 'bytes').length, 0, 'over the cap, no block')
    // The url still reaches the caller: `completedResult` lists every one in its text block, and the widget
    // renders from `structuredContent`. Nothing is lost by declining to inline.
  } finally {
    globalThis.fetch = realFetch
  }
})

test('⛔ every variation of a batch that fits gets its own block, not just the first', async () => {
  // The whole reason to generate four is to compare them.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Buffer.from('x'), {
      status: 200, headers: { 'content-type': 'image/webp', 'content-length': '1' },
    })) as typeof fetch
  try {
    const out = await attachmentsFor({
      outputId: 'o4', modelId: 'nb2', status: 'settled', contentType: 'image',
      outputs: outs(['a', 'b', 'c', 'd'].map((n) => `https://media.contenthero.ai/u/${n}.png?t=tok`)),
    } as never)
    // 1 byte each, so all four fit inside one budget and all four must appear.
    assert.equal(out.filter((a) => a.kind === 'bytes').length, 4)
  } finally {
    globalThis.fetch = realFetch
  }
})

/**
 * ⛔⛔⛔ **THE ENVELOPE, NOT THE ITEM. THIS DEFECT SHIPPED TWICE AT TWO LEVELS.**
 *
 * A host rejects a tool result over 1 MB outright ("Tool result is too large"), which fails the CALL: the
 * generation is charged and unreachable. The cap was written PER ITEM, so four images at 600 KB each passed
 * individually (822 KB encoded, under budget) and totaled 3.3 MB. `get_media` then repeated it one level
 * up, fetching ten images in parallel with no bound at all.
 *
 * ⭐ Today's real assets are ~3.6 MB apiece and fail the per-item check anyway, so the batch case was safe
 * BY ACCIDENT. A guard built only from the assets that exist cannot see the ones that will.
 */
test('a batch never exceeds the inline budget, however many outputs it has', async () => {
  const realFetch = globalThis.fetch
  // 600 KB each: comfortably under any per-item cap, catastrophically over the ceiling when there are four.
  const SIX_HUNDRED_KB = 600_000
  globalThis.fetch = (async () =>
    new Response(Buffer.alloc(SIX_HUNDRED_KB), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(SIX_HUNDRED_KB) },
    })) as typeof fetch
  try {
    const out = await attachmentsFor({
      outputId: 'batch', modelId: 'nb2', status: 'settled', contentType: 'image',
      outputs: outs(['a', 'b', 'c', 'd'].map((n) => `https://media.contenthero.ai/u/${n}.png?t=tok`)),
    } as never)

    const inlined = out.filter((a) => a.kind === 'bytes') as Array<{ data: string }>
    const totalChars = inlined.reduce((sum, a) => sum + a.data.length, 0)

    // The whole point: the sum is bounded, not each item.
    assert.ok(totalChars <= 900_000, `inlined ${totalChars} chars, which would blow the host's ceiling`)
    // ⭐ And nothing is LOST: `completedResult` lists every url in text and the widget renders all four
    // from `structuredContent`, so declining to inline costs only the fallback block.
    // A per-item cap would have inlined all four. This asserts it did not.
    assert.ok(inlined.length < 4, 'a per-item cap would have inlined every one of them')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('one output that fits is still inlined, so the common case keeps its fallback', async () => {
  // The counterweight: a budget that protects the ceiling by inlining NOTHING would pass the test above and
  // silently remove the fallback for every host without app support.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Buffer.alloc(400_000), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '400000' },
    })) as typeof fetch
  try {
    const out = await attachmentsFor({
      outputId: 'single', modelId: 'nb2', status: 'settled', contentType: 'image',
      outputs: outs(['https://media.contenthero.ai/u/a.png?t=tok']),
    } as never)
    assert.equal(out.filter((a) => a.kind === 'bytes').length, 1, 'a single fitting image MUST still inline')
  } finally {
    globalThis.fetch = realFetch
  }
})

/**
 * ⛔⛔⛔ **THE WIDGET IS DECLARED BY THE TOOL, NOT BY THE RESULT, AND I SHIPPED IT THE OTHER WAY.**
 *
 * A host reads `tool._meta` at `tools/list` time to learn a tool renders a widget. With the binding only on
 * the CallToolResult, the host never knows to mount anything: the result arrives as plain blocks, no widget,
 * and NO ERROR ANYWHERE. Measured in Claude Desktop 2026-09-19, four URLs as text and no viewer.
 *
 * ⭐ Checked in BOTH directions. A tool that names a widget must have one registered, or it points at
 * nothing; and every tool whose result is MEDIA must name it, or that medium silently stops rendering.
 */
test('every media tool declares the widget, and only media tools do', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const resources = await mcp.listResources()

  const declares = (t: { _meta?: Record<string, unknown> }) =>
    Boolean((t._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri || t._meta?.['ui/resourceUri'])

  // ⚠️ A uri is an IDENTIFIER the host asks this server to resolve. Naming one nobody registered renders a
  // blank frame, which is worse than no widget at all.
  const uris = new Set(resources.resources.map((r) => r.uri))
  for (const t of tools.filter(declares)) {
    const uri =
      (t._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri ??
      (t._meta?.['ui/resourceUri'] as string)
    assert.ok(uris.has(uri), `${t.name} points at ${uri}, which no resource serves`)
  }
})

/**
 * ⛔⛔⛔ **THE COMPLETENESS GUARD: DECLARING THE WIDGET AND EMITTING ITS PAYLOAD MUST AGREE, BOTH WAYS.**
 *
 * The binding used to be five hand-placed spreads, which is an allowlist, and an allowlist is wrong in two
 * directions at once. It was attached where display was unwanted (a cost preflight rendered an empty card)
 * and MISSING where it was wanted: `generate_audio` and `edit_audio` produced media that never rendered
 * anywhere, for the entire life of this widget. Nobody decided audio should be invisible. It is what
 * happens to anything nobody remembers to add to a list.
 *
 * ⭐ So this asserts an INVARIANT rather than a membership: a tool declares the widget exactly when its
 * handler can return a result carrying the payload. Adding a tool that produces media and forgetting the
 * binding now fails here, by name, without anyone having to notice.
 *
 * ⚠️ NO EXEMPTIONS, deliberately. `get_status` reports rather than displays, so its result
 * builder strips the payload; that is why it can sit on the false side of the equivalence honestly instead
 * of as a special case. An invariant with an exemption is a list again.
 */
test('a tool declares the widget exactly when it can emit one', () => {
  const src = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')

  /**
   * ⭐⭐ **THE EMITTER SET IS DERIVED, AND THE DERIVATION FOLLOWS CALLS.**
   *
   * A hand-written list of result builders is the same allowlist this guard replaced, one level up: adding
   * `mediaBatchResult` made this fail for the wrong reason, because the test had not heard of it.
   *
   * ⚠️ AND IT HAS TO BE TRANSITIVE. `importedMediaResult` attaches the widget through a shared private
   * helper, so a scan that only looked for `RESOURCE_URI_META_KEY` inside each exported body declared it a
   * non-emitter and flagged a correct binding as wrong. "Can this path attach the meta" is a reachability
   * question, so it is answered by closing over calls until nothing new is found.
   */
  const fmt = readFileSync(new URL('./format.ts', import.meta.url), 'utf8')
  const fns = [...fmt.matchAll(/(?:export )?function ([a-zA-Z]+)\(/g)]
  const bodyOf = new Map<string, string>()
  fns.forEach((m, i) => {
    bodyOf.set(m[1]!, fmt.slice(m.index!, i + 1 < fns.length ? fns[i + 1]!.index! : fmt.length))
  })

  /**
   * ⛔ A BUILDER THAT STRIPS THE META IS NOT AN EMITTER, WHATEVER IT CALLS.
   *
   * `generationStatusResult` calls `completedResult` and then deletes its `_meta`, because a status query
   * reports rather than displays. Reachability alone would call it an emitter and flag a correct absence,
   * so the closure reads the deletion, which is a fact the source already states outright.
   */
  const strips = (body: string) => /delete\s*\(res as[^)]*\)\._meta/.test(body)

  /**
   * ⚠️ TWO SEEDS, BECAUSE THE META CONVERGED. Six call sites used to spell the binding out inline, each
   * naming `RESOURCE_URI_META_KEY`; they now share `WIDGET_META`, which is also what made room for a third
   * host dialect without a third copy per site. This guard caught that refactor immediately by reporting
   * zero emitters rather than silently vacuously passing, which is the only reason it is worth having.
   */
  const ATTACHES = /RESOURCE_URI_META_KEY|WIDGET_META/
  const emitters = new Set<string>()
  for (const [name, body] of bodyOf) {
    if (!strips(body) && ATTACHES.test(body)) emitters.add(name)
  }
  for (;;) {
    const before = emitters.size
    for (const [name, body] of bodyOf) {
      if (emitters.has(name) || strips(body)) continue
      if ([...emitters].some((e) => new RegExp(`\\b${e}\\(`).test(body))) emitters.add(name)
    }
    if (emitters.size === before) break
  }
  const EMITTERS = [...emitters]
  assert.ok(EMITTERS.length >= 4, `only found ${EMITTERS.length} widget-emitting builders; the scan broke`)

  const blocks = [...src.matchAll(/^  tool\(\s*'([a-z_]+)'/gm)]
  assert.ok(blocks.length > 20, 'the tool scan found almost nothing; the registration shape changed')

  const problems: string[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    const name = blocks[i]![1]!
    const start = blocks[i]!.index!
    const end = i + 1 < blocks.length ? blocks[i + 1]!.index! : src.length
    const body = src.slice(start, end)
    // ⚠️ MATCHES THE HELPER, NOT A CONSTANT. Declaring the widget is now a CALL that takes the progress
    // label, so a tool cannot mount this frame without saying what it is doing.
    const declares = /\.\.\.renders\(/.test(body)
    const emits = EMITTERS.some((fn) => new RegExp(`\\b${fn}\\(`).test(body))
    if (declares !== emits) {
      problems.push(`${name}: declares=${declares} emits=${emits}`)
    }
  }
  assert.deepEqual(
    problems,
    [],
    'a tool that can return widget data must declare the widget, and only those may declare it',
  )
})

test('the widget binding is emitted in BOTH the modern and legacy spellings', async () => {
  // The spec tells hosts to accept either, so a server that emits one bets on which host it meets.
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const gen = tools.find((t) => t.name === 'generate_image')
  // IMPORTED, not restated. A copy of the string here would keep passing while the server advertised a
  // different name, which is the same blindness the guard tests exist to remove.
  assert.equal((gen?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, GENERATION_WIDGET_URI)
  assert.equal(gen?._meta?.['ui/resourceUri'], GENERATION_WIDGET_URI)
})

test('the widget uri is named by its version and its contents, so no change can be served from cache', async () => {
  /**
   * ⭐ THE REAL INVARIANT, asserted rather than the literal. A host caches a widget resource by its uri, so a
   * name that is the same across builds means new bytes are never fetched and a shipped fix stays invisible.
   * The name was fixed for this server's entire life, which is how a corrected widget could be published,
   * pinned and deployed while the frame kept rendering the old one.
   */
  assert.ok(
    GENERATION_WIDGET_URI.includes(PACKAGE_VERSION),
    `widget uri "${GENERATION_WIDGET_URI}" must contain the package version "${PACKAGE_VERSION}"`,
  )
  // ⭐ And a digest of everything a host caches under the name: the HTML and the resource metadata. A version
  // alone left every rebuild of one version under one name, so a fix to the frame's metadata (2026-10-05,
  // `prefersBorder`) could not reach a host that already held that version.
  const digest = createHash('sha256').update(GENERATION_WIDGET_HTML).update(JSON.stringify(WIDGET_RESOURCE_META)).digest('hex').slice(0, 12)
  assert.equal(GENERATION_WIDGET_URI, `ui://contenthero/generation-${PACKAGE_VERSION}-${digest}.html`)
  // And it must still be a `ui://` identifier, which is what makes the host ask this server for its contents.
  assert.ok(GENERATION_WIDGET_URI.startsWith('ui://'))

  // The resource the server actually serves must answer to that exact name, or the frame loads nothing at all.
  const mcp = await connect(fakeClient())
  const { contents } = await mcp.readResource({ uri: GENERATION_WIDGET_URI })
  assert.equal(contents[0]?.uri, GENERATION_WIDGET_URI)
})

test('every widget-bearing tool states what it is DOING, as a present participle', async () => {
  /**
   * ⛔⛔ THE FRAME SHOWS THIS STRING BEFORE ANY RESULT EXISTS.
   *
   * A host mounts the widget when the CALL starts, so this is the first thing a person reads. It used to
   * be a hardcoded "Waiting for the generation result", which greeted `show_media`, `get_media`, an
   * import and an upload too: a message about generating, from tools that generate nothing.
   *
   * ⛔ IT IS STATED RATHER THAN DERIVED FROM THE TITLE, and the verb list is why. "Drop a trailing e,
   * else add ing" is already wrong for one of the eight verbs shipped today (Get becomes Geting), and
   * English decides that doubling by word STRESS, which a function cannot recover from a string.
   *
   * ⭐ `renders()` takes the label as an ARGUMENT, so there is no list to forget: a tool cannot declare
   * this widget without saying what it is doing. This asserts the outcome anyway, because a helper is
   * only a guarantee until somebody adds a second way to declare one.
   */
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const bearing = tools.filter((t) => Boolean(t._meta?.['ui/resourceUri']))
  assert.ok(bearing.length > 5, `expected several widget-bearing tools, found ${bearing.length}`)

  const labelOf = (t: (typeof bearing)[number]) => t._meta?.['ui/progressLabel'] as string | undefined

  const missing = bearing.filter((t) => !labelOf(t)).map((t) => t.name)
  assert.deepEqual(missing, [], `mounts a widget with nothing to say while it loads: ${missing}`)

  // A label that is not a present participle reads as an imperative, which is what a button says.
  const notProgressive = bearing
    .filter((t) => !/^[A-Z][a-z]+ing\b/.test(labelOf(t) ?? ''))
    .map((t) => `${t.name}: ${labelOf(t)}`)
  assert.deepEqual(notProgressive, [], `not an action in progress: ${notProgressive.join(', ')}`)

  // And it must not simply restate the imperative title, which is the failure that looks like success.
  const echoesTitle = bearing.filter((t) => labelOf(t) === t.title).map((t) => t.name)
  assert.deepEqual(echoesTitle, [], `progress label is just the title again: ${echoesTitle}`)
})

/**
 * ⭐⭐⭐ **THREE HOSTS READ THREE DIFFERENT KEYS FOR ONE URI, AND A MISS IS INVISIBLE IN THE OTHER TWO.**
 *
 * Measured in ChatGPT 2026-09-21: a generation submitted, ran to completion, and rendered as plain text.
 * No crash, no error, no clue. The host looks for `openai/outputTemplate` and we emitted only the two MCP
 * Apps spellings, so it never learned the tool had a UI at all. The whole failure was one absent key, and
 * every test we had passed because they all asked Claude's question.
 *
 * ⛔ THIS ASSERTS AGREEMENT, NOT PRESENCE. A guard that only checks "the key exists" would pass on a
 * version bump that updated two spellings and left the third pointing at a resource that no longer
 * resolves, which is the exact shape this converged code is built to prevent.
 */
test('every widget-bearing tool names the same widget in all three host dialects', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const bearing = tools.filter((t) => Boolean(t._meta?.['ui/resourceUri']))
  assert.ok(bearing.length > 5, `expected several widget-bearing tools, found ${bearing.length}`)

  const disagreeing = bearing
    .map((t) => {
      const m = t._meta ?? {}
      const spellings = {
        'ui/resourceUri': m['ui/resourceUri'],
        'ui.resourceUri': (m.ui as { resourceUri?: string } | undefined)?.resourceUri,
        'openai/outputTemplate': m['openai/outputTemplate'],
      }
      const wrong = Object.entries(spellings)
        .filter(([, v]) => v !== GENERATION_WIDGET_URI)
        .map(([k, v]) => `${k}=${v ?? 'MISSING'}`)
      return wrong.length ? `${t.name}: ${wrong.join(', ')}` : null
    })
    .filter(Boolean)
  assert.deepEqual(disagreeing, [], `does not resolve to ${GENERATION_WIDGET_URI} in every host: ${disagreeing.join(' | ')}`)

  // The progress label likewise has two names, and a tool that says different things to different hosts is
  // a product inconsistency nobody can see from inside one of them.
  const labelMismatch = bearing
    .filter((t) => t._meta?.['openai/toolInvocation/invoking'] !== t._meta?.['ui/progressLabel'])
    .map((t) => `${t.name}: "${t._meta?.['ui/progressLabel']}" vs "${t._meta?.['openai/toolInvocation/invoking']}"`)
  assert.deepEqual(labelMismatch, [], `progress label differs by host: ${labelMismatch.join(' | ')}`)

  // ⚠️ 64 is OpenAI's documented cap. Exceeding it truncates in a UI we cannot observe.
  const tooLong = bearing
    .map((t) => String(t._meta?.['openai/toolInvocation/invoking'] ?? ''))
    .filter((l) => l.length > 64)
  assert.deepEqual(tooLong, [], `over OpenAI's 64-char invoking cap: ${tooLong.join(', ')}`)

  // Without this the component cannot call back, and the widget's own poll is how a card fills in.
  const notAccessible = bearing.filter((t) => t._meta?.['openai/widgetAccessible'] !== true).map((t) => t.name)
  assert.deepEqual(notAccessible, [], `cannot call the server back from ChatGPT: ${notAccessible}`)
})

/**
 * The CSP mirror, for the same reason and with a worse symptom: a frame that mounts and shows nothing but
 * broken images. We already shipped that failure in Claude when `resourceDomains` was absent, so the cost of
 * repeating it one host over is known exactly.
 */
test('the ChatGPT CSP mirror lists the same origins as the MCP Apps one', async () => {
  const mcp = await connect(fakeClient())
  const { resources } = await mcp.listResources()
  const widget = resources.find((r) => r.uri === GENERATION_WIDGET_URI)
  assert.ok(widget, `no resource registered at ${GENERATION_WIDGET_URI}`)

  const meta = widget._meta ?? {}
  const csp = (meta.ui as { csp?: { resourceDomains?: string[]; connectDomains?: string[] } } | undefined)?.csp
  const mirror = meta['openai/widgetCSP'] as { resource_domains?: string[]; connect_domains?: string[] } | undefined

  assert.ok(csp?.resourceDomains?.length, 'the MCP Apps csp names no resource domains')
  assert.deepEqual(mirror?.resource_domains, csp?.resourceDomains, 'resource domains differ between hosts')
  assert.deepEqual(mirror?.connect_domains, csp?.connectDomains, 'connect domains differ between hosts')
})

/**
 * ⭐⭐ The host draws the one frame, so the widget asks every host for its border and draws none itself. Asking
 * for none did not stop Claude drawing one, and our own card then sat inside it with a different corner radius
 * (Claude Desktop, 2026-10-05). Asserted on both the listing and the read result, under both hosts' names,
 * because a host may consult either.
 */
test('the widget asks every host for its border, on the listing and the read', async () => {
  const mcp = await connect(fakeClient())
  const { resources } = await mcp.listResources()
  const listed = resources.find((r) => r.uri === GENERATION_WIDGET_URI)?._meta ?? {}
  const { contents } = await mcp.readResource({ uri: GENERATION_WIDGET_URI })
  const read = (contents[0] as { _meta?: Record<string, unknown> } | undefined)?._meta ?? {}
  for (const meta of [listed, read]) {
    assert.equal((meta.ui as { prefersBorder?: boolean } | undefined)?.prefersBorder, true, 'MCP Apps prefersBorder')
    assert.equal(meta['openai/widgetPrefersBorder'], true, 'ChatGPT widgetPrefersBorder')
  }
})

/**
 * ⭐⭐⭐ **A PUBLISHED WIDGET URI MUST OUTLIVE THE PUBLISH THAT MINTED IT.**
 *
 * The widget's uri carries the package version so a host cannot serve a cached stale bundle. The cost
 * nobody accounted for is that a TRANSCRIPT stores the uri it saw. Publishing 0.4.15 stopped serving
 * `generation-0.4.14.html`, and ChatGPT Desktop, which reopens past conversations from its own cache,
 * showed "This app couldn't be loaded" on every card it had previously rendered. Measured 2026-09-21.
 *
 * ⛔ THE WEB CLIENT DID NOT REPRODUCE IT, because it re-listed tools and got the new uri. So "it works in
 * my browser" was true and useless: the failure only appears where history is replayed.
 *
 * ⚠️ THIS ASSERTS OLD URIS RESOLVE, not merely that the current one does. A guard that reads only the
 * version it just built passes on exactly the bug it exists to catch, forever.
 */
test('every version of the widget uri still resolves, not just the current one', async () => {
  const mcp = await connect(fakeClient())

  const { resources } = await mcp.listResources()
  const listed = resources.map((r) => r.uri)
  assert.deepEqual(listed, [GENERATION_WIDGET_URI], `resources/list should advertise exactly the current uri: ${listed}`)

  const current = await mcp.readResource({ uri: GENERATION_WIDGET_URI })
  const bytes = (current.contents?.[0] as { text?: string })?.text?.length ?? 0
  assert.ok(bytes > 1000, `the current widget should have a body, got ${bytes} bytes`)

  // Versions this package has actually published, plus a shape it has never minted.
  for (const version of ['0.4.12', '0.4.13', '0.4.14', '0.9.99']) {
    const uri = `ui://contenthero/generation-${version}.html`
    const res = await mcp.readResource({ uri })
    const body = res.contents?.[0] as { text?: string; mimeType?: string } | undefined
    assert.equal(body?.text?.length, bytes, `${uri} should serve the CURRENT widget, byte for byte`)
    assert.equal(body?.mimeType, 'text/html;profile=mcp-app', `${uri} served the wrong mime type`)
  }
})

/**
 * ⚠️ THE TEMPLATE MUST NOT SWALLOW UNRELATED URIS. Matching too widely would turn a genuine typo into a
 * silently served widget, which is the same class of defect as the version orphaning, one level up.
 */
test('the widget template does not answer for uris it should not own', async () => {
  const mcp = await connect(fakeClient())
  for (const uri of ['ui://contenthero/something-else.html', 'ui://other/generation-0.4.15.html']) {
    await assert.rejects(
      () => mcp.readResource({ uri }),
      `${uri} should not resolve; only generation-<version>.html is ours`,
    )
  }
})

/**
 * update_card can ADD every kind of attachment get_card reads back (2026-09-27). The assets entry took only
 * assetUrl or outputId, so an inspiration post or a linked project could be read over the connector and never
 * attached; an agent passing assetType 'inspiration' with a url got a plain link. The entry now names one of
 * outputId, assetUrl, contentId or projectId, and the tool's description says which does what.
 */
test('update_card assets take contentId and projectId, and the description says so', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const tool = tools.find((t) => t.name === 'update_card')
  assert.ok(tool, 'update_card is registered')
  const assets = (tool.inputSchema.properties as Record<string, any>).assets
  const entry = Object.keys(assets.items.properties)
  for (const field of ['id', 'outputId', 'assetUrl', 'contentId', 'projectId']) {
    assert.ok(entry.includes(field), `assets entry takes ${field}`)
  }
  for (const phrase of ['contentId (an inspiration post', 'projectId (an editor or canvas project)']) {
    assert.ok(tool.description?.includes(phrase), `description names ${phrase}`)
  }
})

/**
 * The retired "pipeline stage" vocabulary appears nowhere a caller reads: tool titles, descriptions, or parameter
 * descriptions. Claude shows a tool's TITLE, and `list_stages` was titled "List Pipeline Stages" long after stages
 * stopped being called that, which is how the old word surfaced in a Claude session (2026-09-27) while every tool
 * NAME was already clean. A search over names alone missed it.
 */
test('no tool text uses the retired "pipeline stage" vocabulary', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const retired = /pipeline[ _-]?stage/i
  const offenders: string[] = []
  const walk = (label: string, value: unknown): void => {
    if (typeof value === 'string') {
      if (retired.test(value)) offenders.push(label)
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(`${label}.${k}`, v)
    }
  }
  for (const t of tools) walk(t.name, { title: t.title, annotations: t.annotations, description: t.description, inputSchema: t.inputSchema })
  assert.ok(tools.length > 50, 'read the real tool list')
  assert.deepEqual(offenders, [])
})

/**
 * create_project and import hand cardId to the client (2026-09-27). import builds its project input field by
 * field, so a new parameter it does not copy would be accepted by the schema and silently dropped: the project would
 * be made and never linked.
 */
test('create_project and import pass cardId through, and say the project is linked', async () => {
  const seen: Array<Record<string, unknown>> = []
  const project = { id: 'p1', type: 'editor', kind: 'editor', surface: 'editor', title: 'T', orientation: '16:9', width: 1920, height: 1080, revision: 1 }
  const mcp = await connect(
    fakeClient({
      createProject: async (input: Record<string, unknown>) => (seen.push(input), project),
      importProject: async (input: Record<string, unknown>) => (seen.push(input), { ...project, type: 'canvas', kind: 'canvas', surface: 'canvas' }),
    }),
  )
  const created = await mcp.callTool({ name: 'create_project', arguments: { cardId: 'c1' } })
  const imported = await mcp.callTool({
    name: 'import',
    arguments: { pptxUrl: 'https://x/d.pptx', cardId: 'c1' },
  })
  assert.deepEqual(seen.map((s) => s.cardId), ['c1', 'c1'])
  for (const res of [created, imported]) {
    assert.match((res.content as Array<{ text: string }>)[0].text, /Linked to card c1/)
  }
})

test("get_schema kind 'link' prints the grammar, the origin and each noun with its tabs and items", async () => {
  const mcp = await connect(
    fakeClient({
      getLinkFormats: async () => ({
        origin: 'https://app.contenthero.ai',
        grammar: ['{origin}/{noun}/{id}[/{tab}[/{item}]][?{declared params}]'],
        nouns: [
          { noun: 'card', resource: 'cards', id: 'the short id or the UUID', opens: 'the card open on its planner board', tabs: ['details', 'inspiration'] },
          { noun: 'planner', resource: 'spaces', id: 'the short id or the UUID', opens: 'the board', params: { sort: { means: 'sorts the board', values: ['title', 'created_at'] }, tags: { means: 'filters', value: 'tag ids, comma-separated' } } },
          { noun: 'brand', resource: 'brand-kits', id: 'the short id or the UUID', opens: 'the brand kit', tabs: ['overview', 'social'], tabItems: { social: { id: 'a view', values: ['brand', 'inspiration'] } } },
        ],
        sections: [{ section: 'studio', opens: 'the Studio', tabs: ['gallery', 'creations'], defaultTab: null }],
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_schema', arguments: { kind: 'link' } })
  assert.ok(!res.isError)
  const body = res.content[0].text
  assert.match(body, /origin: https:\/\/app\.contenthero\.ai/)
  assert.match(body, /- \/card\/\{id\}: the card open on its planner board\. \{id\}: the short id or the UUID; tabs: details\|inspiration/)
  assert.match(body, /items: social\/\{item\} = brand\|inspiration/)
  assert.match(body, /params: \?sort=title\|created_at \(sorts the board\), \?tags=\{tag ids, comma-separated\} \(filters\)/)
  assert.match(body, /- \/studio: the Studio; tabs: gallery\|creations \(bare path shows the last-used tab, so spell the tab\)/)
})

/**
 * Every tool that spends reports what it cost (the receipt, `charge`), in the same line: an unattended agent logs and
 * caps its spending from it. The lesson 2.5 run found `analyze_content` returned no charge at all, and the cause was
 * a class (each route improvised), so this covers the class. A new tool that declares a spend fails until it is here.
 */
const CHARGE = { credits: 7, held: 0, state: 'charged', balanceAfter: 93 }
const SPENDING_CALLS = {
  generate_image: { modelId: 'nano-banana-2', prompt: 'a cat' },
  generate_board: { boardType: 'character', prompt: 'a stoic ranger' },
  generate_video: { modelId: 'veo-3.1-fast', prompt: 'a city at dusk' },
  generate_audio: { modelId: 'elevenlabs-tts', text: 'hello', voiceId: 'v1' },
  edit_audio: { operation: 'isolate', sourceUrl: 'https://cdn/in.mp3' },
  upscale: { modelId: 'topaz-image-upscale', sourceUrl: 'https://cdn/in.png', factor: '2x' },
  generate_lip_sync: { modelId: 'infinitalk', imageUrl: 'https://cdn/face.png', script: 'hi', voiceId: 'v1' },
  transcribe: { audioUrl: 'https://cdn/clip.mp3' },
  create_avatar: { name: 'Mika', age: '20s', gender: 'female' },
  add_brand_knowledge: { brandKitId: 'bk1', sourceType: 'text', text: 'a note' },
  analyze_content: { contentId: 'c1' },
  import: { url: 'https://www.youtube.com/watch?v=x' },
}

test('every tool that spends reports its cost the same way', async () => {
  const done = { outputId: 'o1', appUrl: 'https://app/o1', status: 'settled', contentType: 'image', modelId: 'm', outputs: outs(['https://cdn/o1.png']), error: null, createdAt: 't', completedAt: 't', charge: CHARGE }
  const mcp = await connect(
    fakeClient({
      generate: async (req) =>
        req.modelId === 'elevenlabs-tts'
          ? { outputId: 'a1', appUrl: 'https://app/a1', status: 'settled', outputs: outs(['https://cdn/a1.mp3']), charge: CHARGE }
          : { outputId: 'o1', appUrl: 'https://app/o1', status: 'processing', charge: CHARGE },
      generateBoardAndWait: async () => done,
      editAudio: async () => ({ outputId: 'e1', appUrl: 'https://app/e1', status: 'settled', outputs: outs(['https://cdn/e1.mp3']), charge: CHARGE }),
      transcribe: async () => ({ outputId: 'tr1', transcript: 'hi', language: 'en', wordCount: 1, durationSeconds: 1, charge: CHARGE }),
      createAvatar: async () => ({ avatar: { id: 'av1', shortId: 'abc', appUrl: 'https://app/av1', name: 'Mika' }, status: 'processing', message: '', charge: CHARGE }),
      analyzeContent: async () => ({ contentId: 'c1', analysis: { status: 'complete', sections: [], data: {} }, charge: CHARGE }),
      addBrandKnowledge: async () => ({ item: { id: 'kn1', title: 'a note', sourceType: 'text' }, charge: CHARGE }),
      import: async () => ({ outputId: 'im1', shortId: 'Imp00001', appUrl: 'https://app/m/Imp00001', url: 'https://cdn/v.mp4', alreadyExisted: false, contentType: 'video', charge: CHARGE }),
    }),
  )
  const { tools } = await mcp.listTools()
  const spending = tools.filter((t) => SPEND_MARKER.test(t.description ?? '')).map((t) => t.name).sort()
  assert.deepEqual(spending, Object.keys(SPENDING_CALLS).sort(), 'a tool that spends must be covered here')

  for (const [name, args] of Object.entries(SPENDING_CALLS)) {
    const res = await mcp.callTool({ name, arguments: args })
    const textOut = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    assert.ok(!res.isError, `${name}: ${textOut}`)
    assert.match(textOut, /Cost: 7 credits charged\. Balance after: 93 credits\./, `${name} does not report its cost`)
  }
})

test('the cost line: an estimate while it runs, the cost once charged, nothing when free (approved wording)', async () => {
  const { chargeLine } = await import('./format.js')
  assert.equal(
    chargeLine({ credits: 0, held: 120, state: 'pending', balanceAfter: null }),
    'Estimated cost: 120 credits, charged when it finishes (only for what succeeds).',
  )
  assert.equal(chargeLine({ credits: 0, held: 0, state: 'free', balanceAfter: null }), 'Cost: Nothing was charged.')
  assert.equal(chargeLine({ credits: 1, held: 0, state: 'charged', balanceAfter: null }), 'Cost: 1 credit charged.')
  assert.equal(chargeLine(undefined), null)
})

test('a connecting agent is told where the user\'s files live, so a blocked download names its own fix', async () => {
  // A sandbox that may reach only listed hosts got logo links it could not download (2026-10-02). The fix is the
  // user allowing these hosts, and only the instructions reach every agent before its first call.
  const mcp = await connect(fakeClient({}))
  const instructions = mcp.getInstructions()
  assert.ok(instructions, 'the server sends no instructions')
  assert.ok(instructions.includes(MEDIA_HOST), `the instructions do not name ${MEDIA_HOST}`)
})

/**
 * KLING ELEMENTS, NEVER BARE "ELEMENTS" (agreed 2026-10-04). The five tools were `list_elements` and its family,
 * filed in the editor group, where an agent read them as the editor's Elements panel. They cut over in one release
 * (agents read the tool list on every connection, as with `get_schema`); only generate_video's inputs keep the old
 * spelling for a window, because code sends those by name.
 */
const KLING_ELEMENT_TOOLS = ['list_kling_elements', 'get_kling_element', 'create_kling_element', 'update_kling_element', 'delete_kling_element']

test('Kling element tools are named for Kling, filed with the characters, and the old names are gone', async () => {
  const mcp = await connect(fakeClient())
  const names = (await mcp.listTools()).tools.map((t) => t.name)
  assert.deepEqual(KLING_ELEMENT_TOOLS.filter((n) => !names.includes(n)), [], 'Kling element tools missing')
  const retired = ['list_elements', 'get_element', 'create_element', 'update_element', 'delete_element']
  assert.deepEqual(retired.filter((n) => names.includes(n)), [], 'pre-rename tool names still advertised')
  const characters = TOOL_GROUPS.find((g) => g.slug === 'characters')
  assert.deepEqual(KLING_ELEMENT_TOOLS.filter((n) => !characters.tools.includes(n)), [])
})

test('the Kling element tools reach the Kling element SDK methods, by klingElementId', async () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111', shortId: 'Kling001', appUrl: 'https://app/kling-element/Kling001',
    name: 'hero', category: 'character', description: 'the subject',
    inputUrls: ['https://cdn/a.png', 'https://cdn/b.png'], inputVideoUrl: null, previewUrl: 'https://cdn/a.png', createdAt: 't',
  }
  const calls = []
  const mcp = await connect(
    fakeClient({
      listKlingElements: async () => (calls.push('list'), { klingElements: [row], nextCursor: null }),
      getKlingElement: async (id) => (calls.push(`get ${id}`), row),
      createKlingElement: async (req) => (calls.push(`create ${JSON.stringify(req)}`), row),
      updateKlingElement: async (id, patch) => (calls.push(`update ${id} ${JSON.stringify(patch)}`), row),
      deleteKlingElement: async (id) => (calls.push(`delete ${id}`), { deleted: true, id }),
    }),
  )
  const listed = await mcp.callTool({ name: 'list_kling_elements', arguments: {} })
  assert.match(listed.content[0].text, /^1 Kling element\(s\):/)
  const got = await mcp.callTool({ name: 'get_kling_element', arguments: { klingElementId: 'Kling001' } })
  assert.match(got.content[0].text, /klingElements \[\{ klingElementId: "11111111-1111-4111-8111-111111111111" \}\]/)
  await mcp.callTool({ name: 'create_kling_element', arguments: { name: 'hero', description: 'the subject', images: row.input_urls } })
  await mcp.callTool({ name: 'update_kling_element', arguments: { klingElementId: 'Kling001', name: 'villain' } })
  const deleted = await mcp.callTool({ name: 'delete_kling_element', arguments: { klingElementId: 'Kling001' } })
  assert.equal(deleted.content[0].text, 'Deleted Kling element Kling001.')
  assert.deepEqual(calls, [
    'list',
    'get Kling001',
    `create ${JSON.stringify({ name: 'hero', description: 'the subject', images: row.input_urls })}`,
    'update Kling001 {"name":"villain"}',
    'delete Kling001',
  ])
})

test('generate_video forwards klingElements alone: the deprecated elements and elementId aliases are gone', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      generate: async (req) => {
        captured = req
        return { outputId: 'g', status: 'processing' }
      },
    }),
  )
  const base = { modelId: 'veo-3.1-fast', prompt: '@hero walks in', startFrame: 'https://cdn/start.png' }

  await mcp.callTool({ name: 'generate_video', arguments: { ...base, klingElements: [{ klingElementId: 'Kling001' }] } })
  assert.deepEqual(captured.references?.klingElements, [{ klingElementId: 'Kling001' }])
  assert.equal(captured.references?.elements, undefined)

  const rejected = await mcp.callTool({ name: 'generate_video', arguments: { ...base, elements: [{ elementId: 'Kling001' }] } })
  assert.ok(rejected.isError, 'the old alias is an undeclared parameter')

  const { tools } = await mcp.listTools()
  const props = tools.find((t) => t.name === 'generate_video').inputSchema.properties
  assert.equal(props.elements, undefined)
  assert.equal(props.klingElements.items.properties.elementId, undefined)
})

/**
 * TEMPLATES (motion graphics 5.7): the editor's Elements, filed with the editor, on the template SDK methods. A write
 * reports what the checks warned about, and archive and favorite take a template like any other asset.
 */
const TEMPLATE_TOOLS = ['list_templates', 'get_template', 'create_template', 'update_template', 'delete_template']

test('the template tools are filed with the editor, and reach the template SDK methods by templateId', async () => {
  const row = {
    id: '22222222-2222-4222-8222-222222222222', scope: 'user', kind: 'code', name: 'Lower third', category: 'lower-thirds',
    description: null, tags: ['name'], props: { title: 'Hi' }, propsSchema: { title: { control: 'text', label: 'Title' } }, durationFrames: 120,
    skeleton: { type: 'video' }, coverage: 'partial', widthFraction: 0.25, heightFraction: 0.125, resize: 'scale',
    aspect: 2, version: 3, archivedAt: null, sourceTemplateId: null, sourceTemplateVersion: null, code: 'export default () => null',
    thumbnailUrl: 'https://media.contenthero.ai/templates/2222/v3.png',
  }
  const calls = []
  const mcp = await connect(
    fakeClient({
      listTemplates: async (opts) => (calls.push(`list ${JSON.stringify(opts)}`), { templates: [row], nextCursor: 'c2' }),
      getTemplate: async (id) => (calls.push(`get ${id}`), row),
      createTemplate: async (req) => (calls.push(`create ${JSON.stringify(req)}`), { template: row, warnings: ['interpolate was given keyframes out of order'] }),
      updateTemplate: async (id, fields, opts) => (calls.push(`update ${id} ${JSON.stringify(fields)} ${JSON.stringify(opts)}`), { template: row, warnings: [] }),
      deleteTemplate: async (id) => (calls.push(`delete ${id}`), { deleted: true, id }),
    }),
  )
  const editor = TOOL_GROUPS.find((g) => g.slug === 'editor')
  assert.deepEqual(TEMPLATE_TOOLS.filter((n) => !editor.tools.includes(n)), [])

  const listed = await mcp.callTool({ name: 'list_templates', arguments: { scope: 'user', kind: 'code', category: ['lower-thirds'], archived: true } })
  assert.match(listed.content[0].text, /^1 template\(s\):\n- Lower third \(id 2{8}-.*\) \| code \| lower-thirds \| yours \| version 3 \| 25% x 13% of the canvas/)
  assert.match(listed.content[0].text, /More: pass cursor "c2"\./)
  // A logo is a kind the app lists, as it is a category: kind logo reaches the SDK instead of being refused.
  const logos = await mcp.callTool({ name: 'list_templates', arguments: { kind: 'logo' } })
  assert.notEqual(logos.isError, true)
  assert.ok(calls.some((c) => c.startsWith('list ') && JSON.parse(c.slice(5)).kind === 'logo'))
  const got = await mcp.callTool({ name: 'get_template', arguments: { templateId: row.id } })
  assert.match(got.content[0].text, /```tsx\nexport default \(\) => null\n```/)
  // Its stored preview, for looking at it before placing it.
  assert.match(got.content[0].text, /\npreview: https:\/\/media\.contenthero\.ai\/templates\/2222\/v3\.png\n/)
  const saved = await mcp.callTool({ name: 'create_template', arguments: { fromItem: { projectId: '11111111-1111-4111-8111-111111111111', itemId: 'g1' }, category: 'lower-thirds' } })
  assert.match(saved.content[0].text, /Saved template "Lower third" .*version 3\.\nWarnings \(it was saved anyway\):\n- interpolate was given keyframes out of order/)
  await mcp.callTool({ name: 'create_template', arguments: { fromTemplateId: row.id, name: 'Mine' } })
  await mcp.callTool({ name: 'update_template', arguments: { templateId: row.id, expectedVersion: 3, props: { title: 'Bye' } } })
  const deleted = await mcp.callTool({ name: 'delete_template', arguments: { templateId: row.id } })
  assert.equal(deleted.content[0].text, `Deleted template ${row.id}. Clips placed from it keep everything.`)

  assert.deepEqual(calls, [
    `list ${JSON.stringify({ scope: 'user', kind: 'code', category: ['lower-thirds'], archived: 'only' })}`,
    `list ${JSON.stringify({ kind: 'logo' })}`,
    `get ${row.id}`,
    `create ${JSON.stringify({ category: 'lower-thirds', fromItem: { itemId: 'g1', projectId: '11111111-1111-4111-8111-111111111111' } })}`,
    `create ${JSON.stringify({ name: 'Mine', fromTemplateId: row.id })}`,
    `update ${row.id} {"props":{"title":"Bye"}} {"expectedVersion":3}`,
    `delete ${row.id}`,
  ])
})

test('archive and favorite take a template', async () => {
  const mcp = await connect(fakeClient())
  const tools = (await mcp.listTools()).tools
  const assetTypes = (name) => tools.find((t) => t.name === name).inputSchema.properties.assetType.enum
  assert.ok(assetTypes('archive').includes('template'))
  assert.ok(assetTypes('favorite').includes('template'))
})

/**
 * ⭐ A batch of uploads is one call each way and one card. Each completion used to be its own call, and each
 * mounted its own card: twelve logos put twelve cards in a row in the person's chat (2026-10-05). A file that
 * fails is named with its reason, never dropped, and does not stop the rest.
 *
 * Break-verified: mounting a card per finalized file, or dropping the failed one from the prose, turns this red.
 */
test('uploads go in a batch: one call each way, one card, and a failed file named', async () => {
  const media = (id: string) => ({
    outputId: id,
    shortId: `s-${id}`,
    url: `https://media.contenthero.ai/${id}/original.png?t=tok`,
    contentType: 'image',
    fileName: id === 'one' ? 'Cover shot.png' : null,
    appUrl: `https://app.contenthero.ai/media/s-${id}`,
  })
  const completions: Array<[string, unknown]> = []
  const mcp = await connect(
    fakeClient({
      createUpload: async (f: { fileName: string }) => {
        if (f.fileName === 'broken.png') throw new Error('Unsupported file type.')
        return {
          outputId: `o-${f.fileName}`,
          upload: { mode: 'single', url: `https://upload.example/${f.fileName}`, headers: { 'content-type': 'image/png' }, expiresAt: '2026-10-05T17:00:00Z' },
        }
      },
      completeUpload: async (id: string, parts?: unknown) => {
        completions.push([id, parts])
        if (id === 'gone') throw new Error('Upload not found.')
        return media(id)
      },
    }),
  )

  const created = await mcp.callTool({
    name: 'create_upload',
    arguments: { files: [{ fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, { fileName: 'broken.png', contentType: 'image/png', sizeBytes: 10 }] },
  })
  const createdText = (created.content as Array<{ text: string }>)[0].text
  assert.match(createdText, /Created 1 of 2 upload\(s\)/)
  assert.match(createdText, /https:\/\/upload\.example\/a\.png/)
  assert.match(createdText, /content-type: image\/png/)
  assert.match(createdText, /broken\.png: could not create its upload: Unsupported file type\./)
  assert.match(createdText, /complete_upload once with uploads \[\{"outputId":"o-a\.png"\}\]/)
  assert.doesNotMatch(createdText, /sign_upload_parts/, 'a batch of single targets has no parts to sign')

  const done = await mcp.callTool({ name: 'complete_upload', arguments: { uploads: [{ outputId: 'one' }, { outputId: 'two' }, { outputId: 'gone' }] } })
  const doneText = (done.content as Array<{ text: string }>)[0].text
  assert.match(doneText, /Media ready \(2 of 3\)/)
  assert.match(doneText, /gone: could not finalize: Upload not found\./)
  assert.ok(done._meta, 'the batch mounts a card')
  const items = (done.structuredContent as { items: Array<{ reference: string }> }).items
  assert.deepEqual(items.map((i) => i.reference), ['one', 'two'], 'one card, one tile per finalized file')
  assert.deepEqual(completions.map(([, parts]) => parts), [undefined, undefined, undefined], 'single uploads complete without parts')
  // A file is shown by the name it was uploaded with, falling back to its id when it has none (gap found 2026-10-12).
  assert.match(doneText, /\[1\] Cover shot\.png, /)
  assert.deepEqual((done.structuredContent as { items: Array<{ name: string }> }).items.map((i) => i.name), ['Cover shot.png', 'two'])
})

/**
 * The upload tools for a file the store takes in parts: create_upload answers the plan from the server (part size and
 * count are printed as received, never written in the tool), sign_upload_parts signs the numbers asked for, and
 * complete_upload passes each part's ETag through untouched.
 */
test('upload tools: a multipart plan, signing the parts asked for, and completing with their ETags', async () => {
  const signed: Array<[string, number[]]> = []
  const completed: Array<[string, unknown]> = []
  const mcp = await connect(
    fakeClient({
      createUpload: async () => ({ outputId: 'big', upload: { mode: 'multipart', partSize: 777, partCount: 5, expiresAt: '2026-10-22T00:00:00Z' } }),
      signUploadParts: async (id: string, numbers: number[]) => {
        signed.push([id, numbers])
        return numbers.map((n) => ({ partNumber: n, url: `https://store.example/part/${n}`, headers: n === 2 ? { 'x-extra': 'yes' } : {} }))
      },
      completeUpload: async (id: string, parts: unknown) => {
        completed.push([id, parts])
        return { outputId: id, shortId: 's-big', url: 'https://media.contenthero.ai/big.mp4', contentType: 'video', fileName: 'big.mp4', appUrl: 'https://app.contenthero.ai/media/s-big' }
      },
    }),
  )
  const plan = (await mcp.callTool({ name: 'create_upload', arguments: { files: [{ fileName: 'big.mp4', contentType: 'video/mp4', sizeBytes: 3000 }] } })).content[0].text
  assert.match(plan, /\[1\] big\.mp4 \(id big\), multipart: 5 parts of 777 bytes each/)
  assert.match(plan, /sign_upload_parts/)
  assert.match(plan, /uploads \[\{"outputId":"big","parts":"\[\{ partNumber, etag \}, \.\.\.\]"\}\]/)

  const parts = (await mcp.callTool({ name: 'sign_upload_parts', arguments: { outputId: 'big', partNumbers: [2, 4] } })).content[0].text
  assert.deepEqual(signed, [['big', [2, 4]]])
  assert.match(parts, /Signed 2 part\(s\) of upload big/)
  assert.match(parts, /part 2:\n {3}https:\/\/store\.example\/part\/2\n {5}x-extra: yes/)
  assert.match(parts, /part 4:\n {3}https:\/\/store\.example\/part\/4\n {5}\(no headers to add\)/)

  const etags = [{ partNumber: 1, etag: '"a"' }, { partNumber: 2, etag: '"b"' }]
  const done = await mcp.callTool({ name: 'complete_upload', arguments: { uploads: [{ outputId: 'big', parts: etags }] } })
  assert.deepEqual(completed, [['big', etags]], 'the ETags go through exactly as given')
  assert.match(done.content[0].text, /Media ready \(1\)/)

  // A refusal from the server reaches the agent as an error with its own words.
  const refused = await connect(fakeClient({ signUploadParts: async () => { throw new Error('Part 9 is beyond the 5 parts of this upload. Parts are numbered 1 to 5.') } }))
  const bad = await refused.callTool({ name: 'sign_upload_parts', arguments: { outputId: 'big', partNumbers: [9] } })
  assert.ok(bad.isError)
  assert.match(bad.content[0].text, /beyond the 5 parts/)
})

test('sign_upload_parts also lists the parts the store already holds, and stays as it was when it cannot', async () => {
  const sign = async (id: string, numbers: number[]) => numbers.map((n) => ({ partNumber: n, url: `https://store.example/part/${n}`, headers: {} }))
  const listed: string[] = []
  const holding = await connect(
    fakeClient({
      signUploadParts: sign,
      listUploadParts: async (id: string) => {
        listed.push(id)
        return { partCount: 4, partSize: 10, uploaded: [{ partNumber: 1, etag: '"aa"', sizeBytes: 10 }, { partNumber: 3, etag: '"cc"', sizeBytes: 10 }] }
      },
    }),
  )
  const withHeld = (await holding.callTool({ name: 'sign_upload_parts', arguments: { outputId: 'big', partNumbers: [2] } })).content[0].text
  assert.deepEqual(listed, ['big'])
  assert.match(withHeld, /^The store already holds 2 part\(s\) of this upload, which need no sending again and go into complete_upload exactly as listed: part 1 ETag "aa"; part 3 ETag "cc"\.$/m)
  assert.match(withHeld, /Signed 1 part\(s\) of upload big/)

  const none = await connect(fakeClient({ signUploadParts: sign, listUploadParts: async () => ({ partCount: 4, partSize: 10, uploaded: [] }) }))
  assert.doesNotMatch((await none.callTool({ name: 'sign_upload_parts', arguments: { outputId: 'big', partNumbers: [1] } })).content[0].text, /already holds/)

  const cannot = await connect(fakeClient({ signUploadParts: sign, listUploadParts: async () => { throw new Error('a single upload has no parts') } }))
  const plain = await cannot.callTool({ name: 'sign_upload_parts', arguments: { outputId: 'big', partNumbers: [1] } })
  assert.ok(!plain.isError)
  assert.doesNotMatch(plain.content[0].text, /already holds/)
  assert.match(plain.content[0].text, /Signed 1 part\(s\)/)
})

test('upload tools: schemas and approved wording, with the old names gone', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const byName = (n: string) => tools.find((t) => t.name === n)
  for (const old of ['create_media_upload', 'complete_media_upload']) assert.equal(byName(old), undefined, `${old} is removed`)
  for (const n of ['create_upload', 'sign_upload_parts', 'complete_upload'] as const) assert.equal(byName(n).description, toolDescription(n, 'mcp'))
  // Principle-based: no number another system owns appears in any of the three texts or their parameter texts.
  const texts = (v: unknown): string[] => (typeof v === 'string' ? [] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => (k === 'description' && typeof x === 'string' ? [x] : texts(x))) : [])
  const prose = ['create_upload', 'sign_upload_parts', 'complete_upload'].flatMap((n) => texts(byName(n))).join(' ')
  assert.doesNotMatch(prose, /\d{2,}|MiB|MB\b|GB\b/)
  assert.doesNotMatch(prose, /[\u2013\u2014]/)

  const files = byName('create_upload').inputSchema.properties.files
  assert.deepEqual(files.items.required.sort(), ['contentType', 'fileName', 'sizeBytes'], 'the size is required')
  assert.ok(files.items.properties.sizeBytes.description)
  assert.deepEqual(byName('sign_upload_parts').inputSchema.required.sort(), ['outputId', 'partNumbers'])
  const upload = byName('complete_upload').inputSchema.properties.uploads.items
  assert.deepEqual(upload.required, ['outputId'], 'parts are optional: a single upload completes without them')
  assert.deepEqual(upload.properties.parts.items.required.sort(), ['etag', 'partNumber'])
  const media = TOOL_GROUPS.find((g) => g.slug === 'media')
  assert.deepEqual(['create_upload', 'sign_upload_parts', 'complete_upload'].filter((n) => !media.tools.includes(n)), [])
})

/**
 * 7.42, 7.44, 7.45, 7.49, 7.50 at the MCP boundary (2026-10-06).
 *
 * Break-verified: waiting with the old 50s and no deadline turns the first red; dropping `cursor` turns the second
 * red; showing the full still instead of the crop turns the third red; dropping the shortfall line turns the fourth
 * red; fetching past the deadline turns the fifth red.
 */
test('get_status waits 40s for every id at once, inside the host ceiling', async () => {
  let asked
  const mcp = await connect(
    fakeClient({
      waitForStatus: async (targets, opts) => {
        asked = { ids: targets.map((t) => t.id), timeoutMs: opts.timeoutMs }
        return targets.map((t) => outputStatus({ outputId: t.id, status: 'processing', contentType: 'image', modelId: 'm', outputs: [], error: null, createdAt: 't', completedAt: null }))
      },
    }),
  )
  await mcp.callTool({ name: 'get_status', arguments: { ids: ['g1', 'g2'] } })
  assert.deepEqual(asked, { ids: ['g1', 'g2'], timeoutMs: 40_000 })
})

test('list_media pages with a cursor, and offset is refused', async () => {
  let opts
  const mcp = await connect(fakeClient({ listMedia: async (o) => ((opts = o), { media: [], nextCursor: null }) }))
  await mcp.callTool({ name: 'list_media', arguments: { limit: 20, cursor: 'c40' } })
  assert.equal(opts.cursor, 'c40')
  assert.equal(opts.limit, 20)
  const old = await mcp.callTool({ name: 'list_media', arguments: { limit: 20, offset: 40 } })
  assert.ok(old.isError, 'offset is no longer an input')
})

test('the media listings take smallCopies and print each small copy as one, the file itself where none is kept (8.5)', async () => {
  const asked: Record<string, unknown> = {}
  const image = { url: 'https://media/a.png', smallUrl: 'https://media/a.vision.webp' }
  const bare = { url: 'https://media/b.png', smallUrl: null }
  const mcp = await connect(
    fakeClient({
      listMedia: async (o) => {
        asked.list = o.smallCopies
        return { nextCursor: null, media: [
          { id: '1', shortId: 'Aaaaaaaa', appUrl: 'https://app/media/Aaaaaaaa', type: 'image', model: 'm', prompt: null, status: 'completed', createdAt: null, mediaId: 'Aaaaaaaa', generationSize: 1, isFavorited: false, kind: 'creation', boardType: null, source: 'creations', fileName: null, durationSeconds: null, ...image },
          { id: '2', shortId: 'Bbbbbbbb', appUrl: 'https://app/media/Bbbbbbbb', type: 'image', model: 'm', prompt: null, status: 'completed', createdAt: null, mediaId: 'Bbbbbbbb', generationSize: 1, isFavorited: false, kind: 'creation', boardType: null, source: 'creations', fileName: null, durationSeconds: null, ...bare },
        ] }
      },
      searchMedia: async (_q, o) => {
        asked.search = o.smallCopies
        return { results: [{ mediaId: 'Aaaaaaaa', appUrl: 'https://app/media/Aaaaaaaa', kind: 'image', summary: null, tags: [], relevance: 0.9, scenes: [], ...image }], nextCursor: null }
      },
      getFolder: async (_id, o) => {
        asked.folder = o?.smallCopies
        return { folder: { name: 'Wall' }, items: [{ type: 'media', kind: 'image', mediaId: 'Bbbbbbbb', summary: null, isFavorited: false, ...bare }], nextCursor: null }
      },
    }),
  )
  const list = (await mcp.callTool({ name: 'list_media', arguments: { smallCopies: true } })).content[0].text
  assert.match(list, /\(media Aaaaaaaa.*\| small copy: https:\/\/media\/a\.vision\.webp$/m)
  assert.doesNotMatch(list, /https:\/\/media\/a\.png/)
  assert.match(list, /\(media Bbbbbbbb.*\| https:\/\/media\/b\.png$/m)
  const search = (await mcp.callTool({ name: 'search_media', arguments: { query: 'serum', smallCopies: true } })).content[0].text
  assert.match(search, /\| small copy: https:\/\/media\/a\.vision\.webp$/m)
  const folder = (await mcp.callTool({ name: 'get_folder', arguments: { folderId: 'f1', smallCopies: true } })).content[0].text
  assert.match(folder, /\(media Bbbbbbbb.*\| https:\/\/media\/b\.png$/m)
  assert.deepEqual(asked, { list: true, search: true, folder: true })
})

/**
 * 9.7b: ONE paging mechanism for every paged listing. Each tool forwards `limit` and `cursor` and refuses `offset`, and
 * its text ends with the next page's cursor exactly when there is one, in the one wording (`moreLine`). Break-verified:
 * dropping `moreLine` from a formatter, or forwarding no cursor, turns this red by tool name.
 */
test('every paged listing forwards limit and cursor, refuses offset, and ends with the next cursor only when there is one', async () => {
  const base = fakeClient()
  const media = (await base.listMedia()).media
  const template = { id: 't1', scope: 'system', kind: 'shape', name: 'Circle', category: 'shapes', version: 1, coverage: 'full', archived_at: null }
  const pages = {
    list_media: { method: 'listMedia', args: {}, page: { media } },
    search_media: { method: 'searchMedia', args: { query: 'cat' }, page: { results: [{ mediaId: 'Out12345-1', kind: 'image', summary: null, tags: [], relevance: 0.8, scenes: [], url: 'https://cdn/1.png' }] } },
    get_folder: { method: 'getFolder', args: { folderId: 'favorites' }, page: { folder: null, items: [{ type: 'media', kind: 'image', mediaId: 'Out12345-1', url: null, summary: null, isFavorited: true }] } },
    list_cards: { method: 'listCards', args: {}, page: await base.listCards() },
    list_content: { method: 'listContent', args: {}, page: await base.listContent() },
    list_brand_knowledge: { method: 'listBrandKnowledge', args: { brandKitId: 'k1' }, page: await base.listBrandKnowledge() },
    list_templates: { method: 'listTemplates', args: {}, page: { templates: [template] } },
    list_projects: { method: 'listProjects', args: {}, page: { projects: (await base.listProjects()).projects } },
    list_style_libraries: { method: 'listStyleLibraries', args: {}, page: { styleLibraries: [{ id: 's1', name: 'kit', description: null, latestVersion: 1, archivedAt: null, createdAt: 'c', updatedAt: 'u' }] } },
  }
  for (const [tool, { method, args, page }] of Object.entries(pages)) {
    for (const nextCursor of ['next-9', null]) {
      let asked
      const mcp = await connect(fakeClient({ [method]: async (...a) => ((asked = a.at(-1)), { ...page, nextCursor }) }))
      const res = await mcp.callTool({ name: tool, arguments: { ...args, limit: 5, cursor: 'c-1' } })
      assert.ok(!res.isError, `${tool}: ${res.content[0].text}`)
      assert.equal(asked.cursor, 'c-1', `${tool} forwards cursor`)
      assert.equal(asked.limit, 5, `${tool} forwards limit`)
      assert.equal('offset' in asked, false, `${tool} sends no offset`)
      const body = res.content[0].text
      if (nextCursor) assert.match(body, /\nMore: pass cursor "next-9"\.(\n|$)/, `${tool} names the next page`)
      else assert.doesNotMatch(body, /More:/, `${tool} says nothing on the last page`)
      const refused = await mcp.callTool({ name: tool, arguments: { ...args, offset: 10 } })
      assert.ok(refused.isError, `${tool} refuses offset`)
    }
  }
})

/**
 * STYLE LIBRARIES: four tools filed with the editor, on the style library SDK methods, in the approved words. A library
 * is archived with the archive tool and never deleted, and a project's pins print under get_project.
 */
test('the style library tools are filed with the editor, use the approved texts, and reach the SDK methods', async () => {
  const lib = { id: 's1', name: 'motion', description: 'Shared motion', latestVersion: 2, archivedAt: null, createdAt: 'c', updatedAt: '2026-10-19T00:00:00Z' }
  const detail = {
    ...lib,
    versions: [{ version: 2, notes: 'faster', contentHash: 'h', modules: [{ name: 'ease', bytes: 12 }], createdAt: 'c2', createdBy: null, sourceProjectId: null, sourceRevision: null }],
    versionsNextCursor: 'v-2',
    pinnedBy: [{ projectId: 'p1', title: 'Edit', version: 1 }],
  }
  const calls = []
  const mcp = await connect(
    fakeClient({
      listStyleLibraries: async (o) => (calls.push(`list ${JSON.stringify(o)}`), { styleLibraries: [lib], nextCursor: null }),
      getStyleLibrary: async (n, o) => (calls.push(`get ${n} ${JSON.stringify(o)}`), o?.version ? { ...lib, version: { ...detail.versions[0], code: { ease: 'export const ease = 1' } } } : detail),
      createStyleLibrary: async (r) => (calls.push(`create ${JSON.stringify(r)}`), lib),
      updateStyleLibrary: async (n, r) => (calls.push(`update ${n} ${JSON.stringify(r)}`), lib),
    }),
  )
  const editor = TOOL_GROUPS.find((g) => g.slug === 'editor')
  const names = ['list_style_libraries', 'get_style_library', 'create_style_library', 'update_style_library']
  assert.deepEqual(names.filter((n) => !editor.tools.includes(n)), [])
  const { tools } = await mcp.listTools()
  for (const n of names) assert.equal(tools.find((t) => t.name === n).description, toolDescription(n as 'get_style_library', 'mcp'))
  assert.ok(!tools.some((t) => t.name === 'delete_style_library'))
  const archiveTool = tools.find((t) => t.name === 'archive')
  assert.ok(archiveTool.inputSchema.properties.assetType.enum.includes('style_library'))
  assert.match(archiveTool.description, /template, style_library\)/)

  const listed = await mcp.callTool({ name: 'list_style_libraries', arguments: { archived: true, search: 'mo', sort: 'name', order: 'asc' } })
  assert.match(listed.content[0].text, /^1 style library\(ies\):\n- motion \(id s1, version 2, updated 2026-10-19T00:00:00Z\): Shared motion/)
  assert.ok((await mcp.callTool({ name: 'list_style_libraries', arguments: { sort: 'createdAt' } })).isError)
  const got = await mcp.callTool({ name: 'get_style_library', arguments: { name: 'motion', limit: 3 } })
  assert.match(got.content[0].text, /version 2 \(c2\): faster \| modules: ease \(12 bytes\)\nMore: pass cursor "v-2"\./)
  assert.match(got.content[0].text, /Pinned by: Edit \(id p1, version 1\)/)
  const one = await mcp.callTool({ name: 'get_style_library', arguments: { name: 'motion', version: 2 } })
  assert.match(one.content[0].text, /module ease:\n```tsx\nexport const ease = 1\n```/)
  const made = await mcp.callTool({ name: 'create_style_library', arguments: { name: 'motion', modules: { ease: { code: 'x' } }, notes: 'first' } })
  assert.equal(made.content[0].text, 'Created style library "motion" (id s1), latest version 2.')
  await mcp.callTool({ name: 'update_style_library', arguments: { name: 'motion', description: null, baseVersion: 2, modules: { ease: null }, fromProject: { projectId: 'p1', modules: ['a'], revision: 4 } } })

  assert.deepEqual(calls, [
    `list ${JSON.stringify({ archived: true, order: 'asc', search: 'mo', sort: 'name' })}`,
    `get motion ${JSON.stringify({ limit: 3 })}`,
    `get motion ${JSON.stringify({ version: 2 })}`,
    `create ${JSON.stringify({ modules: { ease: { code: 'x' } }, name: 'motion', notes: 'first' })}`,
    `update motion ${JSON.stringify({ baseVersion: 2, description: null, fromProject: { modules: ['a'], projectId: 'p1', revision: 4 }, modules: { ease: null } })}`,
  ])

  const archived = []
  const mcp2 = await connect(fakeClient({ archive: async (i) => archived.push(i) }))
  const res = await mcp2.callTool({ name: 'archive', arguments: { assetType: 'style_library', id: 'motion' } })
  assert.deepEqual(archived, [{ assetType: 'style_library', id: 'motion', archived: true }])
  assert.match(res.content[0].text, /Archived style_library motion/)
})

test('get_project prints the style libraries a project pins, with the notes of newer versions', async () => {
  const base = fakeClient()
  const project = await base.getProject('p1')
  const pins = [{ id: 's1', name: 'motion', version: 1, latestVersion: 3, newerVersions: [{ version: 2, notes: 'faster' }, { version: 3, notes: null }] }]
  const mcp = await connect(fakeClient({ getProject: async () => ({ ...project, styleLibraries: pins }) }))
  const body = (await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1' } })).content[0].text
  assert.match(body, /Style libraries pinned:\n  - motion, version 1, newest 3\n      version 2: faster\n      version 3\n/)
  const none = await connect(fakeClient({ getProject: async () => ({ ...project, styleLibraries: [] }) }))
  assert.doesNotMatch((await none.callTool({ name: 'get_project', arguments: { projectId: 'p1' } })).content[0].text, /Style libraries pinned/)
})

test('a paged listing caps limit at 100, templates at 500', async () => {
  const mcp = await connect(fakeClient({ listTemplates: async () => ({ templates: [], nextCursor: null }) }))
  assert.ok((await mcp.callTool({ name: 'list_media', arguments: { limit: 101 } })).isError)
  assert.ok(!(await mcp.callTool({ name: 'list_media', arguments: { limit: 100 } })).isError)
  assert.ok((await mcp.callTool({ name: 'list_templates', arguments: { limit: 501 } })).isError)
  assert.ok(!(await mcp.callTool({ name: 'list_templates', arguments: { limit: 500 } })).isError)
})

test('list_media cuts a long file name the way it cuts a prompt', async () => {
  const long = `${'interview-take-'.repeat(10)}final.mp4`
  const row = { ...(await fakeClient().listMedia()).media[0], fileName: long, prompt: long }
  const mcp = await connect(fakeClient({ listMedia: async () => ({ media: [row], nextCursor: null }) }))
  const body = (await mcp.callTool({ name: 'list_media', arguments: {} })).content[0].text
  const cut = `${long.slice(0, 80)}...`
  assert.equal(body.split(cut).length - 1, 2, 'the file name and the prompt are each cut at the same length')
  assert.doesNotMatch(body, /final\.mp4/)
})

test('get_media with a region shows the cut, not the whole picture, and says how it maps back', async () => {
  const cut = 'data:image/webp;base64,' + 'Q'.repeat(64)
  let captured
  const mcp = await connect(
    fakeClient({
      getMediaBatch: async (items) => {
        captured = items
        return {
          items: [{
            ok: true, input: items[0], url: 'https://cdn/full.png', imageUrl: 'https://cdn/full.png', previewUrl: null, visionUrl: null,
            type: 'image', model: null, prompt: null, mediaId: 'Out12345-2', otherMediaIds: [],
            crop: { dataUrl: cut, width: 400, height: 300, region: { x: 100, y: 50, width: 400, height: 300 }, pixelsPerSourcePixel: 1 },
          }],
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'Out12345-2', region: { x: 100, y: 50, width: 400, height: 300 } }] } })
  assert.deepEqual(captured, [{ mediaId: 'Out12345-2', region: { x: 100, y: 50, width: 400, height: 300 } }])
  const images = res.content.filter((c) => c.type === 'image')
  assert.deepEqual(images.map((i) => i.data), ['Q'.repeat(64)])
  assert.match(res.content[0].text, /zoom: 400x300 at \(100, 50\) in the file's pixels, shown at 400x300 \(1 px per file px\)/)
})

test('get_media says why an image is not shown in plain words, never a status code or a fetch error', async () => {
  // Approved 2026-10-06: a slow file reads differently from a missing one, and neither prints HTTP codes or sizes.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/slow.png')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    return new Response('gone', { status: 404 })
  }) as typeof fetch
  try {
    const item = (mediaId: string, imageUrl: string) => ({ ok: true, input: { mediaId }, url: imageUrl, imageUrl, type: 'image', mediaId, otherMediaIds: [] })
    const mcp = await connect(
      fakeClient({
        getMediaBatch: async () => ({
          items: [
            item('Elsewhere1', 'https://cdn.example/a.png'),
            item('SlowFile12', 'https://media.contenthero.ai/u/slow.png?t=tok'),
            item('GoneFile12', 'https://media.contenthero.ai/u/gone.png?t=tok'),
          ],
        }),
      }),
    )
    const res = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'Elsewhere1' }, { mediaId: 'SlowFile12' }, { mediaId: 'GoneFile12' }] } })
    const text = res.content[0].text
    assert.match(text, /^Found 3 of 3 item\(s\); showing 0 image\(s\) below\. Not shown: not a ContentHero file; took too long to load; couldn't be loaded\./)
    assert.doesNotMatch(text, /HTTP|fetch failed|TimeoutError|out of time|inline|result's size/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('inline bytes stop at the call deadline instead of fetching past it', async () => {
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = (async () => {
    fetched++
    return new Response(Buffer.from('x'), { status: 200, headers: { 'content-type': 'image/webp', 'content-length': '1' } })
  }) as typeof fetch
  try {
    const out = await attachmentsFor(
      { outputId: 'o', modelId: 'm', status: 'settled', contentType: 'image', outputs: outs(['https://media.contenthero.ai/u/a.png?t=tok']) } as never,
      Date.now() - 1,
    )
    assert.equal(out.length, 0)
    assert.equal(fetched, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})

/**
 * 9.9: every sortable list tool takes `sort` (the fields the API declares for that list, from `LIST_SORTS`) and
 * `order`, every growable list tool pages, and neither is dropped on the way to the SDK.
 */
test('every sortable list tool offers exactly its list\'s sort fields and the two orders', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const props = (name: string) => (tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties
  for (const [tool, list] of [['list_cards', 'cards'], ['list_projects', 'projects'], ['list_spaces', 'spaces'], ['list_content', 'content'], ['list_media', 'media']] as const) {
    assert.deepEqual(props(tool).sort?.enum, [...LIST_SORTS[list]], `${tool} sort`)
    assert.deepEqual(props(tool).order?.enum, [...SORT_ORDERS], `${tool} order`)
  }
  for (const tool of [
    'list_tags', 'list_avatars', 'list_voices', 'list_brand_kits', 'list_tracked_accounts', 'list_connected_accounts',
    'list_kling_elements', 'list_stages', 'list_spaces', 'list_folders', 'list_project_versions',
  ]) {
    assert.ok(props(tool).limit && props(tool).cursor, `${tool} pages`)
  }
  // The retired spellings are gone, not kept beside the new ones.
  assert.equal(props('list_content').sortBy, undefined)
  assert.equal(props('list_spaces').includeArchived, undefined)
})

test('list tools forward their sort, page and new filters, and a page ends with its cursor', async () => {
  const seen: Record<string, unknown> = {}
  const mcp = await connect(
    fakeClient({
      listCards: async (o) => ((seen.cards = o), { cards: [], total: 0, nextCursor: null, space: null }),
      listSpaces: async (o) => ((seen.spaces = o), { spaces: [{ id: 's1', name: 'Client', cardCount: 4, isFavorite: false, archivedAt: null }], nextCursor: 'n2' }),
      listProjects: async (o) => ((seen.projects = o), { projects: [], nextCursor: null }),
      listTags: async (o) => ((seen.tags = o), { tags: [{ id: 't1', name: 'launch' }], nextCursor: 'n1' }),
    }),
  )
  const cards = await mcp.callTool({ name: 'list_cards', arguments: { spaceId: 'all', isFavorite: true, tag: 'launch', sort: 'scheduledAt', order: 'asc' } })
  assert.deepEqual(JSON.parse(JSON.stringify(seen.cards)), { spaceId: 'all', isFavorite: true, tag: 'launch', sort: 'scheduledAt', order: 'asc' })
  // Every space was asked for, so no one space answered, and the empty answer says so.
  assert.equal(cards.content[0].text, 'No cards found in every space.')
  const spaces = await mcp.callTool({ name: 'list_spaces', arguments: { archived: true, favorited: true, search: 'cli', sort: 'cardCount', order: 'desc' } })
  assert.deepEqual(seen.spaces, { archived: true, favorited: true, search: 'cli', sort: 'cardCount', order: 'desc' })
  assert.match(spaces.content[0].text, /4 card\(s\)/)
  assert.match(spaces.content[0].text, /More: pass cursor "n2"\.$/)
  await mcp.callTool({ name: 'list_projects', arguments: { sort: 'title', order: 'asc' } })
  assert.deepEqual(seen.projects, { sort: 'title', order: 'asc' })
  const tags = await mcp.callTool({ name: 'list_tags', arguments: { limit: 5, cursor: 'c1' } })
  assert.deepEqual(JSON.parse(JSON.stringify(seen.tags)), { limit: 5, cursor: 'c1' })
  assert.match(tags.content[0].text, /More: pass cursor "n1"\.$/)
})

test('the project tools reach their SDK methods: fields, settings, copy, versions, undo and redo', async () => {
  const calls: string[] = []
  // A project's settings ride its read and its update (2026-10-10): get_project reads them, update_project changes them.
  const settings = { fps: 30, loudness: -16, magneticTrack: false, linkage: true, linkedTracks: { media: true, audio: false, text: true } }
  const summary = { id: 'p2', type: 'editor', title: 'Launch (copy)', orientation: '16:9', width: 1920, height: 1080, coverSource: 'auto', coverFrame: null, isArchived: false, isFavorited: false }
  const mcp = await connect(
    fakeClient({
      updateProject: async (id, input) => (calls.push(`update ${id} ${JSON.stringify(input)}`), { ...summary, ...settings }),
      getProject: async (id) => (calls.push(`get ${id}`), { ...summary, ...settings, revision: 3, state: {}, groups: [] }),
      duplicateProject: async (id, o) => (calls.push(`duplicate ${id} ${JSON.stringify(o)}`), summary),
      listProjectVersions: async (id, page) => (calls.push(`versions ${id} ${JSON.stringify(page)}`), { versions: [{ id: 'v1', createdAt: 't', label: 'Final', triggerReason: 'manual', authorName: 'Taylan', revision: 4, kind: 'tracks', createdBy: 'u', sizeBytes: 1 }], nextCursor: null }),
      createProjectVersion: async (id, o) => (calls.push(`save ${id} ${JSON.stringify(o)}`), { id: 'v2', label: o.label }),
      restoreProjectVersion: async (id, v) => (calls.push(`restore ${id} ${v}`), { revision: 9, kind: 'tracks' }),
      updateProjectVersion: async (id, v, change) => (calls.push(`rename ${id} ${v} ${JSON.stringify(change)}`), { id: v, label: change.label }),
      deleteProjectVersion: async (id, v) => void calls.push(`delete ${id} ${v}`),
      undo: async (id, o) => (calls.push(`undo ${id} ${JSON.stringify(o)}`), { revision: 10, undidRevision: 8, label: 'Undid revision 8' }),
      redo: async (id, o) => (calls.push(`redo ${id} ${JSON.stringify(o)}`), { revision: 11, undidRevision: 10, label: 'Undid revision 10' }),
    }),
  )
  const call = (name: string, args: Record<string, unknown>) => mcp.callTool({ name, arguments: args })
  const updated = await call('update_project', { projectId: 'p1', title: 'Launch', brandKitId: null, coverPosition: { x: 50, y: 40 }, cover: { frame: 12 } })
  assert.match(updated.content[0].text, /^Updated editor project p2/)
  // The settings, changed and reported back as they now stand.
  const set = await call('update_project', { projectId: 'p1', fps: 30, loudness: 'off', magneticTrack: false, linkedTracks: { audio: false }, width: 1080, height: 1920 })
  assert.match(set.content[0].text, /Frame rate: 30 fps\./)
  // The revision the caller read rides along, the one contract update_timeline and update_canvas share.
  await call('update_project', { projectId: 'p1', fps: 24, expectedRevision: 9 })
  assert.ok(calls.includes('update p1 {"expectedRevision":9,"fps":24}'))
  const tools = (await mcp.listTools()).tools
  for (const name of ['update_project', 'update_timeline', 'update_canvas']) {
    const field = (tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { description?: string }>).expectedRevision
    assert.ok(field, `${name} takes expectedRevision`)
    assert.match(field.description ?? '', /nothing since touched what the edit touches/)
  }
  assert.match(set.content[0].text, /Delivery loudness: -16 LUFS/)
  assert.match(set.content[0].text, /Editing: magnetic main track off, linkage on, reaching media, text tracks\./)
  const read = await call('get_project', { projectId: 'p1' })
  assert.match(read.content[0].text, /Delivery loudness: -16 LUFS/)
  assert.match(read.content[0].text, /magnetic main track off/)
  // The timeline settings tools are gone: a project setting has one reader and one writer.
  const listedTools = (await mcp.listTools()).tools.map((t) => t.name)
  assert.equal(listedTools.includes('get_timeline_settings'), false)
  assert.equal(listedTools.includes('update_timeline_settings'), false)
  await call('duplicate_project', { projectId: 'p1' })
  await call('duplicate_project', { projectId: 'p1', versionId: 'v1' })
  const listed = await call('list_project_versions', { projectId: 'p1', limit: 10 })
  assert.match(listed.content[0].text, /v1 \| t \| "Final" \| manual \| by Taylan \| revision 4/)
  await call('create_project_version', { projectId: 'p1', label: 'Before' })
  const restored = await call('restore_project_version', { projectId: 'p1', versionId: 'v1' })
  assert.match(restored.content[0].text, /revision 9/)
  await call('update_project_version', { projectId: 'p1', versionId: 'v1', label: 'Final' })
  await call('delete_project_version', { projectId: 'p1', versionId: 'v1' })
  const undone = await call('undo_project_edit', { projectId: 'p1', expectedRevision: 9 })
  assert.equal(undone.content[0].text, 'Undid revision 8 on project p1. The project is at revision 10.')
  await call('redo_project_edit', { projectId: 'p1', expectedRevision: 10 })
  assert.deepEqual(calls, [
    'update p1 {"brandKitId":null,"cover":{"frame":12},"coverPosition":{"x":50,"y":40},"title":"Launch"}',
    'update p1 {"fps":30,"height":1920,"linkedTracks":{"audio":false},"loudness":"off","magneticTrack":false,"width":1080}',
    'update p1 {"expectedRevision":9,"fps":24}',
    'get p1',
    'duplicate p1 {}',
    'duplicate p1 {"versionId":"v1"}',
    'versions p1 {"limit":10}',
    'save p1 {"label":"Before"}',
    'restore p1 v1',
    'rename p1 v1 {"label":"Final"}',
    'delete p1 v1',
    'undo p1 {"expectedRevision":9}',
    'redo p1 {"expectedRevision":10}',
  ])
})

// A copy from a saved version is duplicate_project with versionId; restore only restores. Break-verified: putting
// `action` back on restore_project_version, or dropping versionId from duplicate_project, turns this red.
test('restore_project_version only restores, and duplicate_project takes the version to copy from', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const props = (name: string) => Object.keys((tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, unknown> }).properties)
  assert.deepEqual(props('restore_project_version').sort(), ['projectId', 'versionId'])
  assert.deepEqual(props('duplicate_project').sort(), ['projectId', 'versionId'])
})

test('list_media follows the library-file contract: its sources, its types, no status, and its sort', async () => {
  let seen
  const mcp = await connect(
    fakeClient({
      listMedia: async (o) => (
        (seen = o),
        { media: [{ mediaId: 'Exp00001', type: 'video', model: null, prompt: null, status: 'completed', source: 'exports', fileName: 'cut.mp4', sizeBytes: 5 * 1024 * 1024, assetId: 'as1', isFavorited: false, kind: null, generationSize: 1, url: 'https://media.contenthero.ai/x/original.mp4', durationSeconds: 12 }], nextCursor: null }
      ),
    }),
  )
  const { tools } = await mcp.listTools()
  const props = (tools.find((t) => t.name === 'list_media')?.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties
  assert.deepEqual(props.source?.enum, [...MEDIA_LIST_SOURCES])
  assert.equal(props.status, undefined, 'status takes only completed, so the tool does not ask for it')
  const res = await mcp.callTool({ name: 'list_media', arguments: { source: 'exports', contentType: ['video', 'doc'], sort: 'sizeBytes', order: 'desc' } })
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), { source: 'exports', contentType: ['video', 'doc'], sort: 'sizeBytes', order: 'desc' })
  assert.match(res.content[0].text, /cut\.mp4 \| 12s \| 5\.0 MB \| asset as1 \| exports/)
  assert.ok((await mcp.callTool({ name: 'list_media', arguments: { contentType: ['transcript'] } })).isError, 'transcript is refused')
})

test('list_media reads stock: collection and query are inputs, the wording is the approved text, the rows name the item, its credit and the id', async () => {
  let seen
  const stockItem = {
    id: 'stock:pexels:image:123', mediaId: 'stock:pexels:image:123', shortId: '', appUrl: null, type: 'image', model: null, prompt: null,
    status: null, createdAt: null, url: 'https://images.example.test/a.jpg', generationSize: null, isFavorited: null, kind: null,
    boardType: null, source: 'stock', name: 'A red car on a street', fileName: null, durationSeconds: null,
    collection: 'photos', provider: 'pexels', providerLabel: 'Pexels', creator: 'Jo Doe', previewUrl: 'https://images.example.test/s.jpg',
    license: { clearedForEndUsers: true, requiresCredit: false },
  }
  const mcp = await connect(fakeClient({ listMedia: async (o) => ((seen = o), { media: [stockItem], nextCursor: 'n1' }) }))
  const { tools } = await mcp.listTools()
  const tool = tools.find((t) => t.name === 'list_media')
  const props = (tool?.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }> }).properties
  assert.deepEqual(props.collection?.enum, [...MEDIA_STOCK_COLLECTIONS])
  assert.equal(props.collection?.description, "Stock only, and required with it. Which part of the stock catalog to read: 'photos', 'videos', 'gifs', 'stickers' or 'sounds'.")
  assert.equal(props.query?.description, "Stock only. Describe what to find. Omit it to read the collection's featured items.")
  assert.equal(props.source?.description, "Which media to read: 'all' (the default, every file the account keeps), 'creations' (studio generations), 'uploads' (files the user uploaded), 'exports' (renders of their projects), or 'stock' (the stock catalog, which is not part of 'all').")
  assert.match(tool?.description ?? '', /^List media you can place\. With no `source`, or a library source, it reads the account's own files/)
  assert.match(tool?.description ?? '', /only an absent `nextCursor` means there are no more\.$/)
  const res = await mcp.callTool({ name: 'list_media', arguments: { source: 'stock', collection: 'photos', query: 'red car' } })
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), { source: 'stock', collection: 'photos', query: 'red car' })
  const body = res.content[0].text
  assert.match(body, /A red car on a street \(media id stock:pexels:image:123\) \| credit: by Jo Doe \| photos \| Pexels \| https:\/\/images\.example\.test\/a\.jpg/)
  assert.ok(!/one of null|\[favorite\]/.test(body))
  const search = tools.find((t) => t.name === 'search_media')
  assert.match(search?.description ?? '', /uploads, stock they have used, and brand assets/)
  assert.match(search?.description ?? '', /To browse stock they have not used, call list_media with source stock\./)
})

test('list_media takes a stock orientation: the enum, the proposed wording, and it is forwarded', async () => {
  let seen
  const mcp = await connect(fakeClient({ listMedia: async (o) => ((seen = o), { media: [], nextCursor: null }) }))
  const { tools } = await mcp.listTools()
  const tool = tools.find((t) => t.name === 'list_media')
  const props = (tool?.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }> }).properties
  assert.deepEqual(props.orientation?.enum, [...MEDIA_STOCK_ORIENTATIONS])
  assert.equal(props.orientation?.description, "Stock photos and videos only. Narrow the results to one shape: 'landscape', 'portrait' or 'square'. Omit it to read every shape.")
  await mcp.callTool({ name: 'list_media', arguments: { source: 'stock', collection: 'photos', orientation: 'square' } })
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), { source: 'stock', collection: 'photos', orientation: 'square' })
  assert.ok((await mcp.callTool({ name: 'list_media', arguments: { orientation: 'wide' } })).isError, 'an unknown shape is refused')
})

test('list_media names a library file by its display name when it has one', async () => {
  const mcp = await connect(fakeClient({ listMedia: async () => ({ media: [{ mediaId: 'Up000001', type: 'image', model: null, prompt: null, status: 'completed', source: 'uploads', name: 'Beach day', fileName: 'IMG_1.jpg', isFavorited: false, kind: null, generationSize: 1, url: 'https://media.contenthero.ai/x.jpg', durationSeconds: null }], nextCursor: null }) }))
  const body = (await mcp.callTool({ name: 'list_media', arguments: {} })).content[0].text
  assert.match(body, /Beach day \| IMG_1\.jpg/)
})

test('update_stage answers with the stage and no position, since the API carries none', async () => {
  let sent
  const mcp = await connect(
    fakeClient({
      updateStage: async (id, input) => ((sent = { id, input }), { id, shortId: 'Stage001', name: 'Done', slug: 'done', color: '#10B981' }),
    }),
  )
  const res = await mcp.callTool({ name: 'update_stage', arguments: { stageId: 'st1', spaceId: 'sp1', position: 'top' } })
  assert.equal(JSON.parse(JSON.stringify(sent)).input.position, 'top')
  assert.doesNotMatch(res.content[0].text, /Position|renumbered/)
  assert.match(res.content[0].text, /^Stage Done/)
})

test('a brand kit logo is sent with isPrimary, the name the API reads', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const schema = tools.find((t) => t.name === 'update_brand_kit')?.inputSchema as { properties: { logos: { items: { properties: Record<string, unknown> } } } }
  const fields = Object.keys(schema.properties.logos.items.properties)
  assert.ok(fields.includes('isPrimary'))
  assert.equal(fields.includes('is_primary'), false)
})

test('a brand kit logo can be marked isDisplay, on create and update alike', async () => {
  const sent: Record<string, unknown> = {}
  const mcp = await connect(
    fakeClient({
      updateBrandKit: async (_id, input) => ((sent.update = input), { id: 'bk1', name: 'K', isDefault: false, brandAccounts: [], inspirationAccounts: [] }),
    }),
  )
  const { tools } = await mcp.listTools()
  for (const name of ['create_brand_kit', 'update_brand_kit']) {
    const schema = tools.find((t) => t.name === name)?.inputSchema as { properties: { logos: { items: { properties: Record<string, unknown> } } } }
    assert.ok('isDisplay' in schema.properties.logos.items.properties, `${name} offers isDisplay`)
  }
  await mcp.callTool({ name: 'update_brand_kit', arguments: { brandKitId: 'bk1', logos: [{ url: 'https://x/icon.png', isDisplay: true }] } })
  assert.deepEqual((sent.update as { logos: unknown }).logos, [{ url: 'https://x/icon.png', isDisplay: true }])
})

/** 9.9, the ordering contract: every hand-arranged list's tool takes one placement wording, and forwards it. */
test('every hand-arranged list tool takes afterId, beforeId and position, and forwards them', async () => {
  const seen: Record<string, unknown> = {}
  const card = { id: 'c1', title: 'T', platform: 'youtube', stageId: 'st1' }
  const mcp = await connect(
    fakeClient({
      createCard: async (input) => ((seen.create_card = input), card),
      updateCard: async (_id, input) => ((seen.update_card = input), card),
      createStage: async (input) => ((seen.create_stage = input), { id: 'st1', name: 'S' }),
      updateAvatar: async (_id, input) => ((seen.update_avatar = input), { avatar: { id: 'av1', name: 'A', looks: [], niche: [] }, applied: [] }),
      updateTrackedAccount: async (_id, input) => (
        (seen.update_tracked_account = input),
        { account: { id: 'ta1', platform: 'youtube', handle: 'h' }, contentCount: 0, totals: { views: 0, likes: 0, comments: 0 }, averages: { views: null, engagementRate: null, outlierScore: null }, topContent: [], recentContent: [] }
      ),
      createTemplate: async (input) => ((seen.create_template = input), { template: { id: 't1', name: 'N', kind: 'shape', category: 'c', scope: 'user', version: 1, coverage: 'full' }, warnings: [] }),
      updateTemplate: async (_id, input) => ((seen.update_template = input), { template: { id: 't1', name: 'N', kind: 'shape', category: 'c', scope: 'user', version: 1, coverage: 'full' }, warnings: [] }),
      updateFolder: async (_id, patch) => ((seen.update_folder = patch), { id: 'f1', name: 'F' }),
    }),
  )
  const { tools } = await mcp.listTools()
  for (const name of ['create_card', 'update_card', 'create_stage', 'update_stage', 'update_brand_kit', 'update_avatar', 'update_tracked_account', 'create_template', 'update_template']) {
    const props = (tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties
    assert.ok(props.afterId && props.beforeId, `${name} takes neighbors`)
    assert.deepEqual(props.position?.enum, ['top', 'bottom'], `${name} takes an end`)
  }
  await mcp.callTool({ name: 'create_card', arguments: { title: 'T', platform: 'youtube', position: 'top' } })
  await mcp.callTool({ name: 'update_card', arguments: { cardId: 'c1', stage: 'Review', afterId: 'c2' } })
  await mcp.callTool({ name: 'create_stage', arguments: { name: 'S', beforeId: 'st2' } })
  await mcp.callTool({ name: 'update_avatar', arguments: { avatarId: 'av1', position: 'bottom' } })
  await mcp.callTool({ name: 'update_tracked_account', arguments: { accountId: 'ta1', afterId: 'ta2' } })
  await mcp.callTool({ name: 'create_template', arguments: { name: 'N', category: 'c', shape: 'circle', position: 'top' } })
  await mcp.callTool({ name: 'update_template', arguments: { templateId: 't1', beforeId: 't2' } })
  await mcp.callTool({ name: 'update_folder', arguments: { folderId: 'f1', moveItem: { item: { mediaId: 'm1' }, before: { cardId: 'c1' } } } })
  const json = (v: unknown) => JSON.parse(JSON.stringify(v))
  assert.equal(json(seen.create_card).position, 'top')
  assert.equal(json(seen.update_card).afterId, 'c2')
  assert.equal(json(seen.create_stage).beforeId, 'st2')
  assert.equal(json(seen.update_avatar).position, 'bottom')
  assert.deepEqual(json(seen.update_tracked_account), { afterId: 'ta2' })
  assert.equal(json(seen.create_template).position, 'top')
  assert.equal(json(seen.update_template).beforeId, 't2')
  assert.deepEqual(json(seen.update_folder).moveItem, { item: { mediaId: 'm1' }, before: { cardId: 'c1' } })
  // The whole-list reorder is retired.
  const kit = (tools.find((t) => t.name === 'update_brand_kit')?.inputSchema as { properties: Record<string, unknown> }).properties
  assert.equal(kit.orderedIds, undefined)
})

test('one share tool, a version is created and exports are listed: the old names are gone, with no alias', async () => {
  const names = (await (await connect(fakeClient())).listTools()).tools.map((t) => t.name)
  for (const name of ['share', 'create_project_version', 'list_exports']) assert.ok(names.includes(name), name)
  const gone = ['share' + '_media', 'share' + '_project', 'save' + '_project_version', 'list_project' + '_exports']
  assert.deepEqual(names.filter((n) => gone.includes(n)), [])
})

test('share makes or revokes a project link by assetType and id, and get_project reports it', async () => {
  const calls = []
  const mcp = await connect(
    fakeClient({
      share: async (input) => {
        calls.push(input)
        return input.shared === false ? { shared: false, shareUrl: null } : { shared: true, shareUrl: 'https://share.example/t' }
      },
      getProject: async (projectId) => ({ id: projectId, type: 'editor', kind: 'editor', title: 'T', orientation: '16:9', width: 1920, height: 1080, revision: 1, state: { tracks: [] }, shareUrl: 'https://share.example/t', shareId: 't' }),
    }),
  )
  const made = await mcp.callTool({ name: 'share', arguments: { assetType: 'project', id: 'p1' } })
  assert.match(made.content[0].text, /https:\/\/share\.example\/t/)
  const revoked = await mcp.callTool({ name: 'share', arguments: { assetType: 'project', id: 'p1', shared: false } })
  assert.doesNotMatch(revoked.content[0].text, /https:/)
  assert.deepEqual(calls, [{ assetType: 'project', id: 'p1' }, { assetType: 'project', id: 'p1', shared: false }])
  const read = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1' } })
  assert.match(read.content[0].text, /Shared at https:\/\/share\.example\/t/)
})

test('share shares media ids and names any the link leaves out', async () => {
  let captured
  const mcp = await connect(
    fakeClient({
      share: async (input) => {
        captured = input
        return { shared: true, shareUrl: 'https://pages.example/s', mediaIds: ['m-1'] }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'share', arguments: { mediaIds: ['m-1', 'm-2'], title: 'Set' } })
  assert.deepEqual(captured, { mediaIds: ['m-1', 'm-2'], title: 'Set' })
  assert.match(res.content[0].text, /https:\/\/pages\.example\/s/)
  assert.match(res.content[0].text, /m-2/)
})

test('share stops a media share by a media id or by its link', async () => {
  const asked = []
  const mcp = await connect(
    fakeClient({
      share: async (input) => {
        asked.push(input)
        return { shared: false, shareUrl: null, mediaIds: [] }
      },
    }),
  )
  const byId = await mcp.callTool({ name: 'share', arguments: { mediaIds: ['m-1'], shared: false } })
  const byLink = await mcp.callTool({ name: 'share', arguments: { shareUrl: 'https://pages.example/s', shared: false } })
  assert.deepEqual(asked, [{ mediaIds: ['m-1'], shared: false }, { shared: false, shareUrl: 'https://pages.example/s' }])
  assert.match(byId.content[0].text, /Stopped sharing/)
  assert.match(byLink.content[0].text, /Stopped sharing/)
})

test("list_exports lists a project's exports with their links and status", async () => {
  let asked
  const mcp = await connect(
    fakeClient({
      listExports: async (projectId, page) => {
        asked = [projectId, page]
        return {
          exports: [
            { exportId: 'e2', shortId: 's2', appUrl: 'https://app.example/e2', status: 'rendering', exportType: 'video', title: 'Cut', outputUrl: null, thumbnailUrl: null, fileSizeBytes: null, durationSeconds: null, destination: null, shareId: 'x', shareUrl: null, createdAt: '2026-10-09' },
            { exportId: 'e1', shortId: 's1', appUrl: 'https://app.example/e1', status: 'completed', exportType: 'video', title: 'Cut', outputUrl: 'https://files.example/e1.mp4', thumbnailUrl: null, fileSizeBytes: 9, durationSeconds: 3, destination: null, shareId: 'y', shareUrl: 'https://pages.example/e1', createdAt: '2026-10-08', loudness: { target: 'off', outcome: 'off', gainDb: null, peakReductionDb: null, deliveredLufs: -20, deliveredTruePeakDbtp: -3, summary: 'Exported as mixed.' } },
          ],
          nextCursor: 'n',
        }
      },
    }),
  )
  const res = await mcp.callTool({ name: 'list_exports', arguments: { projectId: 'p1', limit: 2 } })
  assert.deepEqual(asked, ['p1', { limit: 2, cursor: undefined }])
  assert.match(res.content[0].text, /e2.*rendering/)
  assert.match(res.content[0].text, /share page: https:\/\/pages\.example\/e1 \| Exported as mixed\./)
  assert.match(res.content[0].text, /\bn\b/)
})

test("get_export gives a completed export's share page", async () => {
  const mcp = await connect(
    fakeClient({
      getExport: async (exportId) => ({ exportId, shortId: 'e', appUrl: 'https://app.example/e', status: 'completed', outputUrl: 'https://files.example/e.mp4', shareUrl: 'https://pages.example/e' }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_export', arguments: { exportId: 'e1' } })
  assert.match(res.content[0].text, /Share page: https:\/\/pages\.example\/e/)
})

/**
 * `edit_audio` operation `split` (source media phase 4): the schema offers it, a file split is followed by its
 * outputId, an in-place split lists every job and says what lands on the clips, and a finished split names each output
 * by its stem.
 */
test('edit_audio splits a file or clips in place, and its outputs name their stem', async () => {
  const sent = []
  const mcp = await connect(
    fakeClient({
      editAudio: async (req) => {
        sent.push(req)
        return req.clipIds
          ? { status: 'processing', outputId: 'j1', jobs: [{ outputId: 'j1', clipIds: ['c1'], windows: 1 }, { outputId: 'j2', clipIds: ['c2'], windows: 1 }] }
          : { status: 'processing', outputId: 'sp1' }
      },
    }),
  )
  const { tools } = await mcp.listTools()
  const editAudio = tools.find((t) => t.name === 'edit_audio')
  assert.deepEqual(editAudio.inputSchema.properties.operation.enum, ['isolate', 'enhance', 'split'])
  assert.ok(editAudio.inputSchema.properties.inPlace)
  assert.equal(editAudio.inputSchema.properties.enhanceClips, undefined)

  const file = await mcp.callTool({ name: 'edit_audio', arguments: { operation: 'split', sourceUrl: 'aB3dE5fG' } })
  assert.deepEqual(sent[0], { operation: 'split', sourceUrl: 'aB3dE5fG' })
  assert.match(file.content[0].text, /sp1/)

  const clips = await mcp.callTool({ name: 'edit_audio', arguments: { operation: 'split', projectId: 'p1', clipIds: ['c1', 'c2'] } })
  const text = clips.content[0].text
  assert.match(text, /^Splitting 2 sources/)
  assert.match(text, /get_status \{ ids: \["j1", "j2"\], kind: "output" \}/)
  assert.match(text, /its stems \(vocals, drums, bass, other\) are placed under it/)
})

/**
 * PHASE 5 ITEM 9: AN OLDER CONNECTOR NEVER CRASHES ON A NEWER SERVER'S DATA. The case measured 2026-10-12: a connector
 * built for one audio map shape read another, and its formatter threw after the server answered. Here the server
 * answers get_content with a map in a shape this connector does not know (undeclared version, so the SDK's version
 * guard passes it on) and a status enum it does not know; the MCP-wide net hands the answer over as data with the
 * update line, as a success. A server error and a network failure stay errors. Break-verified: dropping the net's
 * branch from errorResult turns the first assertions red (the raw TypeError comes back as an error).
 */
test('a formatting fault after the server answered returns the answer as data with the update line, on any tool', async () => {
  const answer = {
    id: 'c1', title: 'x', hashtags: [], analysis: { status: 'absent' },
    video: {
      copy: { status: 'ready' },
      videos: [
        { slide: 0, copy: { status: 'ready' }, audioMap: { status: 'ready', summary: { eventCount: 3 }, window: { events: [] } } },
        { slide: 1, copy: { status: 'ready' }, audioMap: { status: 'queued' } },
      ],
    },
  }
  const serving = (status, body) => new ContentHero({
    apiKey: 'ch_live_test',
    baseUrl: 'https://example.test',
    fetch: async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  })
  const mcp = await connect(serving(200, answer))
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1', audioMap: true } })
  assert.notEqual(res.isError, true)
  assert.match(res.content[0].text, /^This connector is older than the ContentHero server and could not format this answer\./)
  assert.deepEqual(JSON.parse(res.content[1].text), answer)
  assert.deepEqual(res.structuredContent, answer)

  // The server's own error is still the call's error.
  const failing = await connect(serving(500, { error: 'Something went wrong on our side.' }))
  const err = await failing.callTool({ name: 'get_content', arguments: { contentId: 'c1' } })
  assert.equal(err.isError, true)
  assert.doesNotMatch(err.content[0].text, /older than the ContentHero server/)

  // No answer at all (the network failed) is still the call's error.
  const offline = await connect(new ContentHero({ apiKey: 'ch_live_test', baseUrl: 'https://example.test', fetch: async () => { throw new TypeError('fetch failed') } }))
  const off = await offline.callTool({ name: 'get_content', arguments: { contentId: 'c1' } })
  assert.equal(off.isError, true)
  assert.equal(off.content[0].text, 'fetch failed')
})

/**
 * The edit tools describe themselves from the one catalog (gap closure D7): their descriptions name no operation, so the
 * operation list lives once, in get_schema; and the shared descriptions state no values.
 * Break-verified: listing an operation in either description, or writing a number into view's or get_project's, turns
 * this red.
 */
test('update_timeline and update_canvas list no operation; view and get_project state no values', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const description = (name: string) => tools.find((t) => t.name === name)!.description ?? ''
  const tools_named = new Set(tools.map((t) => t.name))
  for (const name of ['update_timeline', 'update_canvas']) {
    // An operation is a snake_case word that is not a tool's name; none may appear.
    const words = description(name).match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
    assert.deepEqual(words.filter((w) => !tools_named.has(w)), [], name)
    assert.doesNotMatch(description(name), /\{ op:/)
  }
  for (const name of ['view', 'get_project']) assert.doesNotMatch(description(name), /\d/, name)
})

/**
 * A view answers with the parts it names (gap closure D4), and a render says what was drawn and changed (D2), what it
 * was narrowed to (D1); it states no cost, the platform paying for renders (the cost rule, 2026-10-16).
 * Break-verified: folding the render under a live context, or dropping the adjusted or scope lines, turns this red.
 */
test('view shows a render alone with what was changed and its scope; live adds the screen context', async () => {
  const rendered = {
    renderId: 'r7', status: 'ready', since: '2026-10-13T10:00:00Z', kind: 'picture', frame: 3, width: 1920, height: 1080,
    dataUrl: 'data:image/webp;base64,QUJD',
    adjusted: [{ field: 'width', asked: 4000, used: 1920, reason: "a render is never wider than the project's own size or the plan's export ceiling" }],
    scope: { trackIds: ['t2'] }, missingIds: ['gone'],
  }
  const alone = await connect(fakeClient({ view: async () => ({ rendered }) }))
  const res = await alone.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, width: 3000, trackIds: ['t2', 'gone'] } })
  const text = res.content[0].text
  assert.doesNotMatch(text, /Live context/)
  assert.match(text, /adjusted width: asked 4000, used 1920 \(a render is never wider/)
  assert.match(text, /Only tracks t2 rendered, on the timeline's own frame numbers\. These named nothing on the timeline: gone\./)
  // A render is the platform's to pay: the answer states no cost.
  assert.doesNotMatch(text, /cost|\$/i)
  const both = await connect(fakeClient({
    view: async () => ({
      live: { context: { surface: 'editor', playheadFrame: 3 }, participant: { userId: 'u1', sessionId: 's', surface: 'editor', projectId: 'p1', cardId: null, updatedAt: '2026-10-13T10:00:00Z' }, participants: [] },
      rendered,
    }),
  }))
  const res2 = await both.callTool({ name: 'view', arguments: { projectId: 'p1', render: true, live: true } })
  assert.match(res2.content[0].text, /Live context on the editor surface/)
  assert.match(res2.content[0].text, /"live": \{/)
})

/**
 * The answer contract (2026-10-15): a read of named parts is those parts alone; a transcript says each clip once and its
 * words as rows; a source's picture says what is not ready and where the next page is; the paging inputs reach the
 * client. Break-verified: printing a parts read as a whole project, a transcript's clips again in JSON, or dropping the
 * picture's pending or more line, turns these red.
 */
test('get_project answers a read of named parts with those parts alone', async () => {
  const parts = {
    id: 'p1', shortId: 'abc', appUrl: 'https://app.contenthero.ai/editor/abc', type: 'editor', title: 'My Edit', revision: 4, fps: 30,
    parts: ['sourceTimes'], sourceTimes: [{ atSec: 843.3, frames: [{ clipId: 'c7', frame: 24648 }] }, { atSec: 1020, frames: [] }],
  }
  let asked: Record<string, unknown> = {}
  const mcp = await connect(fakeClient({ getProject: async (_id: string, o: Record<string, unknown>) => ((asked = o), parts) }))
  const res = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1', sourceAssetId: 'a1', atSec: [843.3, 1020] } })
  const body = res.content[0].text
  assert.deepEqual(asked.atSec, [843.3, 1020])
  assert.match(body, /Only what was asked for: where the seconds play\. Nothing else of the project\./)
  assert.match(body, /843\.3s: clip c7 at frame 24648/)
  assert.match(body, /1020s: nowhere \(cut out, or on no clip\)/)
  assert.doesNotMatch(body, /Layer geometry|Frame rate:|Groups:/)
})

test('get_transcript says each clip once, its words as rows in the order fields names, and the next page', async () => {
  const fields = {
    words: ['text', 'startMs', 'endMs', 'startFrame', 'endFrame', 'speakerId', 'confidence'],
    silences: ['startMs', 'endMs', 'startFrame', 'endFrame'],
    audioEvents: ['text', 'startMs', 'endMs', 'startFrame', 'endFrame', 'speakerId'],
  } as const
  const segment = {
    clipId: 'c1', disabled: false, disabledReason: null, disabledNote: null, sourceStartMs: 0, sourceEndMs: 1000, fromFrame: 0, durationFrames: 30,
    text: 'hello there', words: [['hello', 100, 400, 3, 12, 'A', 0.98], ['there', 450, 800, 13, 24, 'A', 0.97]], silences: [], audioEvents: [],
  }
  const result = { projectId: 'p1', revision: 4, fps: 30, mediaTranscribed: true, segmentCount: 2, segments: [segment], nextCursor: 'NEXT', fields, speakers: ['A'] }
  let asked: Record<string, unknown> = {}
  const mcp = await connect(fakeClient({ getTranscript: async (o: Record<string, unknown>) => ((asked = o), result) }))
  const res = await mcp.callTool({ name: 'get_transcript', arguments: { projectId: 'p1', granularity: 'word', limit: 1, cursor: 'PREV' } })
  const body = res.content[0].text
  assert.equal(asked.projectId, 'p1')
  assert.equal(asked.limit, 1)
  assert.equal(asked.cursor, 'PREV')
  assert.match(body, /1 of 2 clip segment\(s\) on this page/)
  assert.equal(body.match(/hello there/g)?.length, 1)
  assert.match(body, /\["hello",100,400,3,12,"A",0\.98\]/)
  assert.doesNotMatch(body, /"sourceStartMs"/)
  assert.match(body, /More: pass cursor "NEXT"\./)
})

test("view says what of a source's picture is not ready, and where its next page is", async () => {
  let asked: Record<string, unknown> = {}
  const picture = {
    status: 'ready', version: 1, tier: 'shots', source: { durationSec: 60, width: 1920, height: 1080, frameRate: 30, stepSec: 0.5 },
    remeasuring: { status: 'pending', since: '2026-10-15T14:00:00.000Z', expectedBy: '2026-10-15T14:10:00.000Z' },
    where: { status: 'pending', since: '2026-10-15T14:19:14.663Z', expectedBy: '2026-10-15T14:22:58.000Z' },
    find: { query: 'a button', moments: [] },
    nextCursor: 'NEXT',
  }
  const clip = { url: 'https://media.contenthero.ai/u/take.mp4', type: 'video', picture }
  const mcp = await connect(fakeClient({ view: async (input: Record<string, unknown>) => ((asked = input), { clip }) }))
  const res = await mcp.callTool({ name: 'view', arguments: { assetId: 'a1', find: 'a button', where: true, limit: 5, cursor: 'PREV' } })
  const body = res.content[0].text
  assert.equal(asked.limit, 5)
  assert.equal(asked.cursor, 'PREV')
  assert.match(body, /coarse \(one picture per shot/)
  assert.match(body, /where is still being made \(since 2026-10-15T14:19:14\.663Z, expected by 2026-10-15T14:22:58\.000Z\)/)
  assert.match(body, /More: pass cursor "NEXT"\./)
})

test('get_transcript reads a recording by mediaId in its own seconds and says its words once', async () => {
  const result = {
    mediaId: 'm1', mediaTranscribed: true, startMs: 1500, endMs: 4000, wordCount: 2, text: 'hello there', nextCursor: 'NEXT', speakers: ['A'],
    fields: { words: ['text', 'startMs', 'endMs', 'speakerId', 'confidence'], audioEvents: ['text', 'startMs', 'endMs', 'speakerId'] },
    words: [['hello', 1500, 1900, 'A', 0.98], ['there', 2000, 2400, 'A', 0.97]], audioEvents: [],
  }
  let asked: Record<string, unknown> = {}
  const mcp = await connect(fakeClient({ getTranscript: async (o: Record<string, unknown>) => ((asked = o), result) }))
  const res = await mcp.callTool({ name: 'get_transcript', arguments: { mediaId: 'm1', startSeconds: 1.5, endSeconds: 4, granularity: 'word' } })
  assert.ok(!res.isError)
  assert.equal(asked.mediaId, 'm1')
  assert.equal(asked.projectId, undefined)
  assert.equal(asked.startSeconds, 1.5)
  assert.equal(asked.endSeconds, 4)
  const body = res.content[0].text
  assert.equal(body.match(/hello there/g)?.length, 1)
  assert.match(body, /\["hello",1500,1900,"A",0\.98\]/)
  assert.match(body, /More: pass cursor "NEXT"\./)
})

test('get_project reads the modules index alone and names each module with its exact size', async () => {
  const parts = {
    id: 'p1', shortId: 'abc', appUrl: 'https://app.contenthero.ai/editor/abc', type: 'editor', title: 'My Edit', revision: 4, fps: 30,
    parts: ['modulesIndex'], modulesIndex: [{ name: 'intro', usedBy: 2, unused: false, bytes: 1234 }, { name: 'old', usedBy: 0, unused: true, bytes: 99 }],
  }
  let asked: Record<string, unknown> = {}
  const mcp = await connect(fakeClient({ getProject: async (_id: string, o: Record<string, unknown>) => ((asked = o), parts) }))
  const res = await mcp.callTool({ name: 'get_project', arguments: { projectId: 'p1', modulesIndex: true } })
  assert.equal(asked.modulesIndex, true)
  const body = res.content[0].text
  assert.match(body, /intro: 2 clips draw it, 1234 bytes/)
  assert.match(body, /old: no clip draws it, 99 bytes/)
  assert.doesNotMatch(body, /Layer geometry|Frame rate:|Groups:/)
})

test("get_media names an audio item's codec, sample rate and channels, and carries its measured facts exact", async () => {
  const audio = { sizeBytes: 480000, mimeType: 'audio/mpeg', durationSeconds: 30.123, codec: 'mp3', sampleRate: 44100, channels: 2 }
  const mcp = await connect(
    fakeClient({
      getMediaBatch: async (items) => ({
        items: [{ ok: true, input: items[0], url: 'https://cdn/a.mp3', type: 'audio', mediaId: 'Aud00001', otherMediaIds: [], durationSeconds: 30.123, audio }],
      }),
    }),
  )
  const res = await mcp.callTool({ name: 'get_media', arguments: { items: [{ mediaId: 'Aud00001' }] } })
  const text = res.content.map((c) => c.text ?? '').join('\n')
  assert.match(text, /audio: audio\/mpeg, .*30\.12s, mp3, 44100 Hz, stereo/)
  assert.match(text, /Exact values for computing are in the structured data/)
  const sc = res.structuredContent as { items: Array<Record<string, unknown>>; summary: string }
  assert.equal(sc.items[0].durationSeconds, 30.123)
  assert.deepEqual(sc.items[0].audio, audio)
  assert.match(sc.summary, /Found 1 of 1 item/)
})

/**
 * Rounding is display only: the structured result carries the API's numbers as numbers. Break-verified: mapping the
 * summary through its describe text, or rounding it, turns the exact assertions red.
 */
test('a reading keeps 1.334 and -14.237 exactly in the structured result while the text reads 1.3s and -14.2 LUFS', async () => {
  const summary = { durationSec: 6, speechSec: 1.334, soundCount: 0, music: { present: false, tempoBpm: null, key: null, mode: null }, duckingDropDb: null, integratedLufs: -14.237 }
  const video = { copy: { status: 'ready' }, videos: [{ slide: 0, copy: { status: 'ready' }, audioMap: { status: 'ready', summary } }] }
  const mcp = await connect(fakeClient({ getContent: async () => ({ title: 'x', hashtags: [], analysis: { status: 'absent' }, video }) }))
  const res = await mcp.callTool({ name: 'get_content', arguments: { contentId: 'c1' } })
  assert.match(res.content[0].text, /1\.3s of speech/)
  assert.match(res.content[0].text, /-14\.2 LUFS/)
  const sc = res.structuredContent as { videos: Array<{ audioMap: { summary: { speechSec: unknown; integratedLufs: unknown } } }> }
  assert.strictEqual(sc.videos[0].audioMap.summary.speechSec, 1.334)
  assert.strictEqual(sc.videos[0].audioMap.summary.integratedLufs, -14.237)
})

/**
 * One contract for long work: the tool texts say how a job ends and how a retry stays safe, in words, with no example value.
 * Dropping a sentence from `get_status`, a long-write tool or `view` turns this red; a digit in them turns the last check red.
 */
test('long-work tool texts: a job ends at settled or failed, a retry repeats the id, a render is read by its renderId', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const text = (name: string) => tools.find((t) => t.name === name)?.description ?? ''
  assert.match(text('get_status'), /A job is over only when its status is settled or failed\. Processing and applying mean it is still running; keep reading the same id\./)
  for (const name of ['generate_image', 'generate_board', 'generate_video', 'edit_audio', 'upscale', 'generate_lip_sync']) {
    assert.match(text(name), /A retry that repeats the same operation id or output id returns the work already started and never charges twice\. The reply names the id to read its progress\./, name)
  }
  assert.match(text('update_timeline'), /A retry that repeats the same operation id returns the revision already committed/)
  assert.match(text('view'), /A render that is not ready answers with a renderId: read it again with that id instead of rendering again\. When rendering is busy the answer says how many seconds to wait before asking again\./)
  assert.doesNotMatch(text('view'), /asking for the same render again/)
  assert.doesNotMatch(text('get_status'), /\bcompleted\b/)
})

test('get_status prints a generation in its last stretch as running, and a settled one as settled', async () => {
  const applying = { outputId: 'g1', shortId: 'Gen00001', appUrl: 'https://app/media/Gen00001', status: 'applying', contentType: 'image', modelId: 'm', outputs: [], error: null, createdAt: 't' }
  const mcp = await connect(fakeClient({ waitForGeneration: async () => applying, getGeneration: async () => applying }))
  const res = await mcp.callTool({ name: 'get_status', arguments: { ids: ['g1'] } })
  assert.match(res.content[0].text, /is still running/)
  assert.doesNotMatch(res.content[0].text, /applying/)
})

test('update_media takes mediaId, name and description, writes through the client and states the result', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const tool = tools.find((t) => t.name === 'update_media')
  assert.ok(tool, 'update_media is registered')
  const props = (tool.inputSchema as { properties: Record<string, unknown>; required?: string[] })
  assert.deepEqual(Object.keys(props.properties).sort(), ['description', 'mediaId', 'name'])
  assert.deepEqual(props.required, ['mediaId'])
  assert.match(tool.description ?? '', /library:write/)
  assert.match(tool.description ?? '', /neither is refused/)
  const res = await mcp.callTool({ name: 'update_media', arguments: { mediaId: 'a1B2c3D4', name: 'Renamed', description: 'About it' } })
  const out = (res.content as Array<{ text: string }>)[0].text
  assert.match(out, /Updated a1B2c3D4/)
  assert.match(out, /Name: Renamed/)
  assert.match(out, /Description: About it/)
})

test('list_templates states that a brand\'s own logos are added through update_brand_kit', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  assert.match(tools.find((t) => t.name === 'list_templates')?.description ?? '', /curated set.*update_brand_kit/)
})

test('update_template names the MediaRef shape its props take and refuses stored URLs by design', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const tool = tools.find((t) => t.name === 'update_template')
  assert.ok(tool)
  assert.match(tool.description ?? '', /MediaRef, an object of assetId and role/)
  assert.match(tool.description ?? '', /stored media URL is refused by design/)
  const props = (tool.inputSchema?.properties as Record<string, { description?: string }>).props
  assert.match(props?.description ?? '', /MediaRef \(\{ assetId, role \}\), never a stored URL/)
  assert.doesNotMatch(tool.description ?? '', /[–—]/)
})

/**
 * THE LISTING IS THE CONTRACT. The app declares every tool's description and input in `lib/api/contract`; the MCP lists
 * them verbatim (`x-dynamic` markers included) and a hand edit here cannot change what a host sees. The app's own
 * `agent-contract-pinned` test reads the same listing the same way, so this holds the comparison it will make.
 */
test('listTools equals the agent contract, tool by tool and field by field, and lists nothing outside it', async () => {
  const mcp = await connect(fakeClient())
  const { tools } = await mcp.listTools()
  const contractNames = AGENT_CONTRACT.tools.map((t) => t.name).sort()
  assert.deepEqual(tools.map((t) => t.name).sort(), contractNames)
  const byName = new Map(tools.map((t) => [t.name, t]))
  for (const c of AGENT_CONTRACT.tools) {
    const listed = byName.get(c.name)!
    assert.equal(listed.description, c.description.mcp, `${c.name} description`)
    const { $schema: _ignored, ...schema } = listed.inputSchema as Record<string, unknown>
    assert.deepEqual(schema, c.inputSchema, `${c.name} inputSchema`)
  }
})

test('the SDK exports the contract version, and it is the vendored file\'s', () => {
  const vendored = JSON.parse(readFileSync(new URL('../../sdk/contract/agent-contract.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(AGENT_CONTRACT_VERSION, vendored.version)
  assert.equal(AGENT_CONTRACT.version, vendored.version)
})
