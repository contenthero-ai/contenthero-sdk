import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero } from './client.js'
import {
  AuthenticationError,
  InsufficientCreditsError,
  ValidationError,
  GenerationFailedError,
  GenerationTimeoutError,
} from './errors.js'
import type { FetchLike } from './client.js'

/** Build a fetch stub that replays a queue of [status, body] responses and records calls. */
function stubFetch(
  responses: Array<{ status: number; body: unknown }>,
): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const next = responses[Math.min(i, responses.length - 1)]
    i++
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetch, calls }
}

test('constructor requires an api key', () => {
  assert.throws(() => new ContentHero({ apiKey: undefined, fetch: (async () => new Response()) as FetchLike }))
})

test('generate posts to the right path with bearer auth', async () => {
  const { fetch, calls } = stubFetch([
    { status: 202, body: { outputId: 'abc', status: 'processing', creditsEstimate: 4 } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test/' })
  const result = await client.generate({ modelId: 'nano-banana-2', prompt: 'a cat' })

  assert.equal(result.outputId, 'abc')
  assert.equal(result.status, 'processing')
  assert.equal(result.creditsEstimate, 4)
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/studio/generate')
  assert.equal(calls[0]?.init?.method, 'POST')
  const headers = calls[0]?.init?.headers as Record<string, string>
  assert.equal(headers.Authorization, 'Bearer ch_live_test')
})

test('402 maps to InsufficientCreditsError with balance and required', async () => {
  const { fetch } = stubFetch([
    { status: 402, body: { error: 'Insufficient credits', balance: 2, required: 10 } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  await assert.rejects(
    () => client.generate({ modelId: 'veo-3', prompt: 'x' }),
    (err: unknown) => {
      assert.ok(err instanceof InsufficientCreditsError)
      assert.equal(err.balance, 2)
      assert.equal(err.required, 10)
      assert.equal(err.status, 402)
      return true
    },
  )
})

test('401 maps to AuthenticationError, 400 to ValidationError', async () => {
  const auth = new ContentHero({ apiKey: 'bad', fetch: stubFetch([{ status: 401, body: { error: 'Invalid API key' } }]).fetch })
  await assert.rejects(() => auth.getBalance(), (e: unknown) => e instanceof AuthenticationError)

  const bad = new ContentHero({ apiKey: 'ch_live_test', fetch: stubFetch([{ status: 400, body: { error: 'unknown model' } }]).fetch })
  await assert.rejects(() => bad.generate({ modelId: 'nope' }), (e: unknown) => e instanceof ValidationError)
})

test('getBalance returns the parsed balance', async () => {
  const { fetch } = stubFetch([{ status: 200, body: { balance: 1234, tier: 'legend', autoTopupEnabled: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  const balance = await client.getBalance()
  assert.deepEqual(balance, { balance: 1234, tier: 'legend', autoTopupEnabled: true })
})

test('transcribe posts the audio URL and returns the transcript', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { outputId: 'tr1', transcript: 'hello there', language: 'en', wordCount: 2, durationSeconds: 1.5 } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const result = await client.transcribe({ audioUrl: 'https://cdn/clip.mp3', languageCode: 'en' })

  assert.equal(result.transcript, 'hello there')
  assert.equal(result.wordCount, 2)
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/studio/transcribe')
  assert.equal(calls[0]?.init?.method, 'POST')
})

test('listAvatars unwraps the { avatars } envelope', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { avatars: [{ id: 'av1', name: 'A', imageUrl: null, defaultVoiceId: 'v1', isDefault: true, status: 'completed' }] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const avatars = await client.listAvatars()
  assert.equal(avatars.length, 1)
  assert.equal(avatars[0].id, 'av1')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/avatars')
})

test('getVoice requests the voice path and returns detail', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { voiceId: 'v1', name: 'Voice', provider: 'elevenlabs', isFavorited: false, previewUrl: null, lastUsedAt: null, accent: 'en-american', language: 'en', gender: null, age: null, description: null, useCase: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const voice = await client.getVoice('v1')
  assert.equal(voice.accent, 'en-american')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/voices/v1')
})

test('listBrandKits unwraps { brandKits } and getBrandKit hits the id path', async () => {
  const list = stubFetch([{ status: 200, body: { brandKits: [{ id: 'bk1', name: 'CH', businessName: null, nicheDefinition: null, isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't' }] } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: list.fetch, baseUrl: 'https://example.test' })
  const kits = await c1.listBrandKits()
  assert.equal(kits[0].id, 'bk1')
  assert.equal(list.calls[0]?.url, 'https://example.test/api/v1/brand-kits')

  const get = stubFetch([{ status: 200, body: { id: 'bk1', name: 'CH', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: get.fetch, baseUrl: 'https://example.test' })
  const kit = await c2.getBrandKit('bk1')
  assert.equal(kit.id, 'bk1')
  assert.equal(get.calls[0]?.url, 'https://example.test/api/v1/brand-kits/bk1')
})

test('listMedia builds the query string and getMedia encodes the token', async () => {
  const list = stubFetch([{ status: 200, body: { media: [{ id: 'o1', type: 'image', model: 'nb2', prompt: null, status: 'completed', createdAt: 't', variationCount: 1, urls: [] }] } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: list.fetch, baseUrl: 'https://example.test' })
  const media = await c1.listMedia({ contentType: 'image', limit: 5 })
  assert.equal(media[0].id, 'o1')
  assert.equal(list.calls[0]?.url, 'https://example.test/api/v1/media?contentType=image&limit=5')

  const get = stubFetch([{ status: 200, body: { id: 'o1', type: 'image', model: 'nb2', prompt: null, status: 'completed', createdAt: 't', variationCount: 2, urls: [], script: null, aspectRatio: null, resolution: null, duration: null, creditsUsed: null, variations: [], selectedVariation: 2 } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: get.fetch, baseUrl: 'https://example.test' })
  const item = await c2.getMedia('abcd1234-2')
  assert.equal(item.selectedVariation, 2)
  assert.equal(get.calls[0]?.url, 'https://example.test/api/v1/media/abcd1234-2')
})

test('generateAndWait polls until completed', async () => {
  const { fetch } = stubFetch([
    { status: 202, body: { outputId: 'gen1', status: 'processing' } },
    { status: 200, body: { outputId: 'gen1', status: 'processing', contentType: 'image', modelId: 'nano-banana-2', outputUrls: [], error: null, createdAt: 't', completedAt: null } },
    { status: 200, body: { outputId: 'gen1', status: 'completed', contentType: 'image', modelId: 'nano-banana-2', outputUrls: ['https://cdn/x.png'], error: null, createdAt: 't', completedAt: 't2' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  const gen = await client.generateAndWait({ modelId: 'nano-banana-2', prompt: 'a cat' }, { pollIntervalMs: 1 })
  assert.equal(gen.status, 'completed')
  assert.deepEqual(gen.outputUrls, ['https://cdn/x.png'])
})

test('generateAndWait throws GenerationFailedError on a failed terminal state', async () => {
  const { fetch } = stubFetch([
    { status: 202, body: { outputId: 'gen2', status: 'processing' } },
    { status: 200, body: { outputId: 'gen2', status: 'failed', contentType: 'video', modelId: 'veo-3', outputUrls: [], error: 'provider error', createdAt: 't', completedAt: 't2' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  await assert.rejects(
    () => client.generateAndWait({ modelId: 'veo-3', prompt: 'x' }, { pollIntervalMs: 1 }),
    (err: unknown) => err instanceof GenerationFailedError && err.outputId === 'gen2',
  )
})

test('generateAndWait throws GenerationTimeoutError past the deadline', async () => {
  const { fetch } = stubFetch([
    { status: 202, body: { outputId: 'gen3', status: 'processing' } },
    { status: 200, body: { outputId: 'gen3', status: 'processing', contentType: 'video', modelId: 'veo-3', outputUrls: [], error: null, createdAt: 't', completedAt: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  await assert.rejects(
    () => client.generateAndWait({ modelId: 'veo-3', prompt: 'x' }, { pollIntervalMs: 1, timeoutMs: 0 }),
    (err: unknown) => err instanceof GenerationTimeoutError,
  )
})

test('favorite posts to /api/v1/favorite with the asset target', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { favorited: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.favorite({ assetType: 'brand_kit', id: 'bk1' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/favorite')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { assetType: 'brand_kit', id: 'bk1' })
})

test('favorite targets a studio variation slot via variationIndex', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { favorited: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.favorite({ id: 'output-uuid', variationIndex: 2 })
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { id: 'output-uuid', variationIndex: 2 })
})

test('unfavorite, archive, and unarchive hit their routes', async () => {
  const unfav = stubFetch([{ status: 200, body: { favorited: false } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: unfav.fetch, baseUrl: 'https://example.test' })
  await c1.unfavorite({ assetType: 'post', id: 'p1' })
  assert.equal(unfav.calls[0]?.url, 'https://example.test/api/v1/unfavorite')

  const arch = stubFetch([{ status: 200, body: { archived: true } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: arch.fetch, baseUrl: 'https://example.test' })
  await c2.archive({ assetType: 'brand_kit_section', id: 's1' })
  assert.equal(arch.calls[0]?.url, 'https://example.test/api/v1/archive')
  assert.deepEqual(JSON.parse(arch.calls[0]?.init?.body as string), { assetType: 'brand_kit_section', id: 's1' })

  const unarch = stubFetch([{ status: 200, body: { archived: false } }])
  const c3 = new ContentHero({ apiKey: 'ch_live_test', fetch: unarch.fetch, baseUrl: 'https://example.test' })
  await c3.unarchive({ assetType: 'project', id: 'pr1' })
  assert.equal(unarch.calls[0]?.url, 'https://example.test/api/v1/unarchive')
})

test('list filters append favorited and archived query params', async () => {
  const media = stubFetch([{ status: 200, body: { media: [] } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: media.fetch, baseUrl: 'https://example.test' })
  await c1.listMedia({ favorited: true })
  assert.equal(media.calls[0]?.url, 'https://example.test/api/v1/media?favorited=true')

  const kits = stubFetch([{ status: 200, body: { brandKits: [] } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: kits.fetch, baseUrl: 'https://example.test' })
  await c2.listBrandKits({ archived: true })
  assert.equal(kits.calls[0]?.url, 'https://example.test/api/v1/brand-kits?archived=true')

  const voices = stubFetch([{ status: 200, body: { voices: [] } }])
  const c3 = new ContentHero({ apiKey: 'ch_live_test', fetch: voices.fetch, baseUrl: 'https://example.test' })
  await c3.listVoices({ favorited: true })
  assert.equal(voices.calls[0]?.url, 'https://example.test/api/v1/voices?favorited=true')
})

test('applyEditorOps posts ops to /api/v1/editor/ops and returns the result', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { surface: 'timeline', revision: 4, results: [{ op: 'ripple_delete', ok: true }] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const out = await client.applyEditorOps({
    projectId: 'p1',
    ops: [{ op: 'ripple_delete', itemIds: ['a'] }],
    userIntent: 'remove intro',
    expectedRevision: 3,
  })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/ops')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), {
    projectId: 'p1',
    ops: [{ op: 'ripple_delete', itemIds: ['a'] }],
    userIntent: 'remove intro',
    expectedRevision: 3,
  })
  assert.equal(out.surface, 'timeline')
  assert.equal(out.revision, 4)
  assert.equal(out.results[0]?.ok, true)
})

test('getProject GETs the encoded /api/v1/projects path and unwraps { project }', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { project: { id: 'p 1', kind: 'canvas', title: 'X', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'canvas', revision: 2, state: { slides: [] }, assetReferences: [], brandKitId: null, exportedPostId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null } } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const p = await client.getProject('p 1')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects/p%201')
  assert.equal(calls[0]?.init?.method, 'GET')
  assert.equal(p.surface, 'canvas')
  assert.equal(p.revision, 2)
})

test('listProjects GETs /api/v1/projects with filters and unwraps { projects }', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { projects: [{ id: 'p1', kind: 'editor', title: 'A', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null }] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const rows = await client.listProjects({ kind: 'editor', search: 'A' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects?kind=editor&search=A')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.id, 'p1')
})

test('createProject POSTs to /api/v1/projects and unwraps { project }', async () => {
  const { fetch, calls } = stubFetch([{ status: 201, body: { project: { id: 'new1', kind: 'editor', title: 'Untitled', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'timeline', revision: 0, state: {}, assetReferences: [], brandKitId: null, exportedPostId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null } } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const p = await client.createProject({ kind: 'editor' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.equal(p.id, 'new1')
})

test('deleteProject DELETEs with the confirm=true opt-in', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { success: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.deleteProject('p 1')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects/p%201?confirm=true')
  assert.equal(calls[0]?.init?.method, 'DELETE')
})

test('importProject POSTs the source to /api/v1/projects/import and unwraps { project }', async () => {
  const { fetch, calls } = stubFetch([{ status: 201, body: { project: { id: 'imp1', kind: 'canvas', title: 'Imported deck', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'canvas', revision: 0, state: { slides: [] }, assetReferences: [], brandKitId: null, exportedPostId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null } } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const p = await client.importProject({ source: { type: 'pptx', fileUrl: 'https://x/deck.pptx' } })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects/import')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { source: { type: 'pptx', fileUrl: 'https://x/deck.pptx' } })
  assert.equal(p.id, 'imp1')
})

test('startExport POSTs to /api/v1/projects/:id/export', async () => {
  const { fetch, calls } = stubFetch([{ status: 202, body: { exportId: 'exp1', status: 'rendering' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const job = await client.startExport('p 1', { format: 'mp4', resolution: '1080p' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects/p%201/export')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.equal(job.status, 'rendering')
})

test('getExport GETs /api/v1/exports/:id', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { exportId: 'exp1', status: 'completed', outputUrl: 'https://x/o.mp4' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const job = await client.getExport('exp1')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/exports/exp1')
  assert.equal(job.outputUrl, 'https://x/o.mp4')
})

test('exportProjectAndWait returns immediately when the job is already completed', async () => {
  const { fetch } = stubFetch([{ status: 202, body: { exportId: 'exp1', status: 'completed', outputUrl: 'https://x/o.zip' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const job = await client.exportProjectAndWait('p1', { format: 'png' })
  assert.equal(job.status, 'completed')
  assert.equal(job.outputUrl, 'https://x/o.zip')
})

test('getExportFormats GETs /api/v1/export-formats', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { formats: [], resolutions: [], qualities: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getExportFormats()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/export-formats')
})

test('getLayerTypes GETs the canvas catalog', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { surface: 'canvas', description: 'd', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, layerTypes: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const cat = await client.getLayerTypes()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/layer-types')
  assert.equal(cat.surface, 'canvas')
})

test('getTimelineTypes GETs the timeline catalog', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { surface: 'timeline', description: 'd', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, clipTypes: [], trackTypes: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const cat = await client.getTimelineTypes()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/timeline-types')
  assert.equal(cat.surface, 'timeline')
})
