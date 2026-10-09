import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero } from './client.js'
import {
  AuthenticationError,
  ContentHeroError,
  InsufficientCreditsError,
  LimitError,
  PlanLimitError,
  SpendCapReachedError,
  StorageFullError,
  ValidationError,
  GenerationFailedError,
  GenerationTimeoutError,
  GenerationInterruptedError,
  pendingOutputId,
  ConflictError,
  ServiceUnavailableError,
} from './errors.js'
import type { FetchLike } from './client.js'
import type { ListProjectsInput } from './types.js'
import { LIST_SORTS } from './types.js'

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

test('402 maps each limit refusal to its typed error, with the message, numbers and ranked actions', async () => {
  const actions = [{ id: 'auto_top_up', label: 'Turn on auto top-up', url: 'https://app.contenthero.ai/billing#auto-topup' }]
  const { fetch } = stubFetch([
    { status: 402, body: { code: 'insufficient_credits', error: "You don't have enough credits for this one.", needed: 10, available: 2, balance: 2, held: 0, actions } },
    { status: 402, body: { code: 'spend_cap_reached', error: "You've reached your monthly spend cap.", needed: 10, cap: 500, spent: 495, resetsAt: '2026-11-01T00:00:00Z', actions: [] } },
    { status: 402, body: { code: 'storage_full', error: "You've run out of storage.", fileBytes: 10, remainingBytes: 1, actions: [] } },
    { status: 402, body: { code: 'plan_limit', error: 'Having more than 1 brand kit is part of the Hero plan.', feature: 'brand_kits', current: 1, limit: 1, plan: 'hero', actions: [] } },
    { status: 402, body: { error: 'Payment required' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  const call = () => client.generate({ modelId: 'veo-3', prompt: 'x' })

  await assert.rejects(call, (err: unknown) => {
    assert.ok(err instanceof InsufficientCreditsError && err instanceof LimitError)
    assert.equal(err.code, 'insufficient_credits')
    assert.equal(err.message, "You don't have enough credits for this one.")
    assert.equal(err.needed, 10)
    assert.equal(err.available, 2)
    assert.deepEqual(err.actions, actions)
    return true
  })
  await assert.rejects(call, (err: unknown) => err instanceof SpendCapReachedError && err.cap === 500 && err.spent === 495)
  await assert.rejects(call, (err: unknown) => err instanceof StorageFullError && err.remainingBytes === 1)
  await assert.rejects(call, (err: unknown) => err instanceof PlanLimitError && err.plan === 'hero' && err.limit === 1)
  // A 402 that is not a limit refusal is a plain error, never mistaken for one.
  await assert.rejects(call, (err: unknown) => err instanceof ContentHeroError && !(err instanceof LimitError))
})

test('401 maps to AuthenticationError, 400 to ValidationError', async () => {
  const auth = new ContentHero({ apiKey: 'bad', fetch: stubFetch([{ status: 401, body: { error: 'Invalid API key' } }]).fetch })
  await assert.rejects(() => auth.getAccount(), (e: unknown) => e instanceof AuthenticationError)

  const bad = new ContentHero({ apiKey: 'ch_live_test', fetch: stubFetch([{ status: 400, body: { error: 'unknown model' } }]).fetch })
  await assert.rejects(() => bad.generate({ modelId: 'nope' }), (e: unknown) => e instanceof ValidationError)
})

test('503 maps to ServiceUnavailableError, never to AuthenticationError', async () => {
  // A lookup that could not run is not a bad key: the API answers 503, and a caller must retry, not replace the key.
  const ch = new ContentHero({
    apiKey: 'ch_live_test',
    fetch: stubFetch([{ status: 503, body: { error: 'Authentication is temporarily unavailable. Try again in a few seconds.' } }]).fetch,
  })
  const err = await ch.getAccount().then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ServiceUnavailableError)
  assert.ok(!(err instanceof AuthenticationError))
  assert.equal((err as ServiceUnavailableError).status, 503)
})

/** One raw response, as the platform sends it when no route handler answered: a page, with Vercel's request id. */
function rawFetch(status: number, text: string, headers: Record<string, string>): FetchLike {
  return async () => new Response(text, { status, headers })
}

const VERCEL_ID = 'iad1::iad1::k7xmp-1759600000000-0f3a9c2b1d4e'
const ERROR_PAGE = '<!DOCTYPE html><html><head><title>500: Internal Server Error</title></head><body><h1>500</h1></body></html>'

/**
 * A crashed route answers with Next's HTML error page, and that page used to become the error message whole. The
 * message names the status and the request id instead, the page stays on `body`, and the status still picks the type.
 * Break-verified with the two tests below: not flagging an unparsable body turns this and the third red (the page is
 * the message again), dropping the header read turns all three red, and not keeping `requestId` on the error turns
 * this and the second red.
 */
test('a non-JSON error body becomes its status and request id, never the page itself', async () => {
  const ch = new ContentHero({ apiKey: 'ch_live_test', fetch: rawFetch(500, ERROR_PAGE, { 'Content-Type': 'text/html', 'x-vercel-id': VERCEL_ID }) })
  const err = await ch.getAccount().then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ContentHeroError)
  assert.equal(err.message, `ContentHero returned HTTP 500 with no readable error. Request id ${VERCEL_ID}.`)
  assert.equal(err.requestId, VERCEL_ID)
  assert.equal(err.status, 500)
  assert.equal(err.body, ERROR_PAGE)

  const busy = new ContentHero({ apiKey: 'ch_live_test', fetch: rawFetch(503, 'Service Unavailable', { 'Content-Type': 'text/plain', 'x-vercel-id': VERCEL_ID }) })
  const unavailable = await busy.getAccount().then(() => null, (e: unknown) => e)
  assert.ok(unavailable instanceof ServiceUnavailableError)
  assert.equal(unavailable.message, `ContentHero returned HTTP 503 with no readable error. Request id ${VERCEL_ID}.`)
})

test('a JSON error keeps the server message and still carries the request id', async () => {
  const ch = new ContentHero({
    apiKey: 'ch_live_test',
    fetch: rawFetch(400, JSON.stringify({ error: 'unknown model' }), { 'Content-Type': 'application/json', 'x-vercel-id': VERCEL_ID }),
  })
  const err = await ch.generate({ modelId: 'nope' }).then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ValidationError)
  assert.equal(err.message, 'unknown model')
  assert.equal(err.requestId, VERCEL_ID)
})

test('without a request id the message says only the status', async () => {
  const ch = new ContentHero({ apiKey: 'ch_live_test', fetch: rawFetch(502, '<html>Bad Gateway</html>', { 'Content-Type': 'text/html' }) })
  const err = await ch.getAccount().then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ContentHeroError)
  assert.equal(err.message, 'ContentHero returned HTTP 502 with no readable error.')
  assert.equal(err.requestId, undefined)

  const empty = new ContentHero({ apiKey: 'ch_live_test', fetch: rawFetch(500, '', { 'x-vercel-id': VERCEL_ID }) })
  const blank = await empty.getAccount().then(() => null, (e: unknown) => e)
  assert.ok(blank instanceof ContentHeroError)
  assert.equal(blank.message, `ContentHero returned HTTP 500 with no readable error. Request id ${VERCEL_ID}.`)
})

test('getAccount reads your own account', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { balance: 1234, tier: 'legend', autoTopupEnabled: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const account = await client.getAccount()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/account')
  assert.deepEqual(account, { balance: 1234, tier: 'legend', autoTopupEnabled: true })
})

test('updateAccount patches only the fields passed, null included, and returns the account', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { balance: 10, spendCap: { limit: 25000, remaining: 24000, resetsAt: '2026-10-01T00:00:00Z' } } },
    { status: 200, body: { balance: 10, spendCap: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const set = await client.updateAccount({ spendCap: 25000 })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/account')
  assert.equal(calls[0]?.init?.method, 'PATCH')
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { spendCap: 25000 })
  assert.equal(set.spendCap?.limit, 25000)
  await client.updateAccount({ spendCap: null })
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { spendCap: null })
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

test('listAvatars returns the { avatars, nextCursor } page', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { avatars: [{ id: 'av1', name: 'A', imageUrl: null, defaultVoiceId: 'v1', isDefault: true, status: 'completed' }], nextCursor: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const { avatars } = await client.listAvatars()
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

test('listBrandKits returns the { brandKits, nextCursor } page and getBrandKit hits the id path', async () => {
  const list = stubFetch([{ status: 200, body: { brandKits: [{ id: 'bk1', name: 'CH', isDefault: true, isActive: true, isFavorited: false, isArchived: false, createdAt: 't' }], nextCursor: null } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: list.fetch, baseUrl: 'https://example.test' })
  const { brandKits } = await c1.listBrandKits()
  assert.equal(brandKits[0].id, 'bk1')
  assert.equal(list.calls[0]?.url, 'https://example.test/api/v1/brand-kits')

  const get = stubFetch([{ status: 200, body: { id: 'bk1', name: 'CH', sections: [], brandAccounts: [], inspirationAccounts: [], knowledge: [] } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: get.fetch, baseUrl: 'https://example.test' })
  const kit = await c2.getBrandKit('bk1')
  assert.equal(kit.id, 'bk1')
  assert.equal(get.calls[0]?.url, 'https://example.test/api/v1/brand-kits/bk1')
})

test('getBrandKit reads three ways on one path, and updateBrandKit carries section writes', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { id: 'bk1', name: 'CH', sections: [{ key: 'about', charCount: 12, outline: ['Who We Are'] }] } },
    { status: 200, body: { id: 'bk1', name: 'CH', sections: [] } },
    { status: 200, body: { id: 'bk1', name: 'CH', sections: [] } },
  ])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })

  assert.deepEqual((await c.getBrandKit('bk1', { detail: 'summary' })).sections[0]?.outline, ['Who We Are'])
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/brand-kits/bk1?detail=summary')

  await c.getBrandKit('bk1', { tabs: ['voice'], roles: ['voice_and_tone', 'writing_style'], keys: [], history: true })
  // Lists are comma-joined; an empty list is left off rather than sent as an empty filter.
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/brand-kits/bk1?roles=voice_and_tone%2Cwriting_style&tabs=voice&history=true')

  await c.updateBrandKit('bk1', {
    sections: [{ key: 'about', body: '## Who We Are', expectedVersion: 1 }, { key: 'offer', revertTo: 2 }, { sectionName: 'Hooks', tab: 'voice' }],
  })
  assert.equal(calls[2]?.init?.method, 'PATCH')
  assert.deepEqual(JSON.parse(calls[2]?.init?.body as string), {
    sections: [{ key: 'about', body: '## Who We Are', expectedVersion: 1 }, { key: 'offer', revertTo: 2 }, { sectionName: 'Hooks', tab: 'voice' }],
  })
})

test('a 409 is a ConflictError carrying each stale section', async () => {
  const { fetch } = stubFetch([
    { status: 409, body: { error: 'stale', conflicts: [{ key: 'about', version: 4, body: 'current' }] } },
  ])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await assert.rejects(c.updateBrandKit('bk1', { sections: [{ key: 'about', body: 'x', expectedVersion: 3 }] }), (err: unknown) => {
    assert.ok(err instanceof ConflictError)
    assert.deepEqual(err.conflicts, [{ key: 'about', version: 4, body: 'current' }])
    return true
  })
})

test('listMedia builds the query string and getMedia encodes the token', async () => {
  const list = stubFetch([{ status: 200, body: { media: [{ id: 'o1', type: 'image', model: 'nb2', prompt: null, status: 'completed', createdAt: 't', variant: 0, url: null, generationSize: 1, isFavorited: false }], nextCursor: null } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: list.fetch, baseUrl: 'https://example.test' })
  const page = await c1.listMedia({ contentType: 'image', limit: 5 })
  assert.equal(page.media[0]?.id, 'o1')
  assert.equal(list.calls[0]?.url, 'https://example.test/api/v1/media?contentType=image&limit=5')

  const get = stubFetch([{ status: 200, body: { id: 'o1', type: 'image', model: 'nb2', prompt: null, status: 'completed', createdAt: 't', variant: 1, url: null, generationSize: 2, isFavorited: false, script: null, aspectRatio: null, resolution: null, duration: null, creditsUsed: null, variations: [], selectedVariation: 2, thumbnailUrl: null } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: get.fetch, baseUrl: 'https://example.test' })
  const item = await c2.getMedia('abcd1234-2')
  assert.equal(item.selectedVariation, 2)
  assert.equal(get.calls[0]?.url, 'https://example.test/api/v1/media/abcd1234-2')
})

test('getMediaBatch POSTs the items to /api/v1/media/batch', async () => {
  const batch = stubFetch([
    {
      status: 200,
      body: {
        items: [
          { ok: true, input: { mediaId: 'abcd1234' }, url: 'https://cdn/1.png', imageUrl: 'https://cdn/1.png', type: 'image', model: 'nb2', prompt: null, mediaId: 'abcd1234-1', otherMediaIds: ['abcd1234-2'] },
          { ok: true, input: { url: 'https://cdn/x.png' }, url: 'https://cdn/x.png', imageUrl: 'https://cdn/x.png', type: 'image', model: null, prompt: null, mediaId: null, otherMediaIds: [] },
        ],
      },
    },
  ])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch: batch.fetch, baseUrl: 'https://example.test' })
  const items = [{ mediaId: 'abcd1234' }, { url: 'https://cdn/x.png' }]
  const res = await c.getMediaBatch(items)
  assert.equal(res.items.length, 2)
  assert.equal(res.items[0].mediaId, 'abcd1234-1')
  assert.deepEqual(res.items[0].otherMediaIds, ['abcd1234-2'])
  assert.equal(batch.calls[0]?.url, 'https://example.test/api/v1/media/batch')
  assert.equal(batch.calls[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(batch.calls[0]?.init?.body)), { items })
})

test('generateAndWait polls until completed', async () => {
  const { fetch } = stubFetch([
    { status: 202, body: { outputId: 'gen1', status: 'processing' } },
    { status: 200, body: { outputId: 'gen1', status: 'processing', contentType: 'image', modelId: 'nano-banana-2', outputs: [], error: null, createdAt: 't', completedAt: null } },
    { status: 200, body: { outputId: 'gen1', status: 'completed', contentType: 'image', modelId: 'nano-banana-2', outputs: [{ mediaId: 'Gen00001', status: 'succeeded', url: 'https://cdn/x.png', appUrl: 'https://app/media/Gen00001' }], error: null, createdAt: 't', completedAt: 't2' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  const gen = await client.generateAndWait({ modelId: 'nano-banana-2', prompt: 'a cat' }, { pollIntervalMs: 1 })
  assert.equal(gen.status, 'completed')
  assert.deepEqual(gen.outputs.map((o) => o.url), ['https://cdn/x.png'])
})

test('generateAndWait throws GenerationFailedError on a failed terminal state', async () => {
  const { fetch } = stubFetch([
    { status: 202, body: { outputId: 'gen2', status: 'processing' } },
    { status: 200, body: { outputId: 'gen2', status: 'failed', contentType: 'video', modelId: 'veo-3', outputs: [], error: 'provider error', createdAt: 't', completedAt: 't2' } },
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
    { status: 200, body: { outputId: 'gen3', status: 'processing', contentType: 'video', modelId: 'veo-3', outputs: [], error: null, createdAt: 't', completedAt: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  await assert.rejects(
    () => client.generateAndWait({ modelId: 'veo-3', prompt: 'x' }, { pollIntervalMs: 1, timeoutMs: 0 }),
    (err: unknown) => err instanceof GenerationTimeoutError,
  )
})

test('importMedia waits for the import job and returns the new item', async () => {
  const { fetch, calls } = stubFetch([
    { status: 202, body: { outputId: 'imp1', status: 'processing', shortId: 'Imp00001', appUrl: 'https://app/media/Imp00001', url: null, alreadyExisted: false } },
    { status: 200, body: { outputId: 'imp1', appUrl: 'https://app/media/Imp00001', status: 'processing', contentType: 'image', modelId: 'import', outputs: [], error: null, createdAt: 't', completedAt: null } },
    { status: 200, body: { outputId: 'imp1', appUrl: 'https://app/media/Imp00001', status: 'completed', contentType: 'video', modelId: 'import', outputs: [{ mediaId: 'Imp00001', status: 'succeeded', url: 'https://cdn/a.mp4', appUrl: 'https://app/media/Imp00001' }], error: null, createdAt: 't', completedAt: 't2' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  const m = await client.importMedia({ url: 'https://example.com/a.mp4' }, { pollIntervalMs: 1 })
  assert.deepEqual(m, { outputId: 'imp1', url: 'https://cdn/a.mp4', appUrl: 'https://app/media/Imp00001', shortId: 'Imp00001', alreadyExisted: false, contentType: 'video' })
  assert.ok(calls[0].url.endsWith('/api/v1/media/imports'))
  assert.ok(calls[1].url.endsWith('/api/v1/studio/generate/imp1'))
})

test('importMedia: an import whose bytes were already there settles abandoned and names the item holding them', async () => {
  const dup = { outputId: 'old1', shortId: 'Old00001', appUrl: 'https://app/media/Old00001', url: 'https://cdn/old.png', objectName: 'u/old.png', role: 'original', ownedBy: 'studio_outputs' }
  const { fetch } = stubFetch([
    { status: 202, body: { outputId: 'imp2', status: 'processing', shortId: 'Imp00002', appUrl: 'https://app/media/Imp00002', url: null, alreadyExisted: false } },
    { status: 200, body: { outputId: 'imp2', appUrl: 'https://app/media/Imp00002', status: 'abandoned', settled: true, contentType: 'image', modelId: 'import', outputs: [], error: null, alreadyExisted: dup, createdAt: 't', completedAt: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch })
  const m = await client.importMedia({ url: 'https://example.com/old.png' }, { pollIntervalMs: 1 })
  assert.deepEqual(m, {
    outputId: 'old1', url: 'https://cdn/old.png', appUrl: 'https://app/media/Old00001', shortId: 'Old00001', alreadyExisted: true,
    existing: { objectName: 'u/old.png', role: 'original', ownedBy: 'studio_outputs' },
  })
})

test('importMedia: a refused url fails, and an unfinished one times out carrying its outputId', async () => {
  const started = { status: 202, body: { outputId: 'imp3', status: 'processing', shortId: 'Imp00003', appUrl: 'a', url: null, alreadyExisted: false } }
  const failed = stubFetch([started, { status: 200, body: { outputId: 'imp3', status: 'failed', contentType: 'image', modelId: 'import', outputs: [], error: 'Import failed: not a public address', createdAt: 't', completedAt: 't2' } }])
  await assert.rejects(
    () => new ContentHero({ apiKey: 'ch_live_test', fetch: failed.fetch }).importMedia({ url: 'https://x' }, { pollIntervalMs: 1 }),
    (err: unknown) => err instanceof GenerationFailedError && /public address/.test(err.message),
  )
  const slow = stubFetch([started, { status: 200, body: { outputId: 'imp3', status: 'processing', contentType: 'image', modelId: 'import', outputs: [], error: null, createdAt: 't', completedAt: null } }])
  await assert.rejects(
    () => new ContentHero({ apiKey: 'ch_live_test', fetch: slow.fetch }).importMedia({ url: 'https://x' }, { pollIntervalMs: 1, timeoutMs: 0 }),
    (err: unknown) => err instanceof GenerationTimeoutError && err.outputId === 'imp3',
  )
})

test('importMedia returns an older server\'s finished answer as is', async () => {
  const finished = { outputId: 'imp4', url: 'https://cdn/b.png', appUrl: 'a', shortId: 'Imp00004', alreadyExisted: false, contentType: 'image' }
  const { fetch, calls } = stubFetch([{ status: 200, body: finished }])
  assert.deepEqual(await new ContentHero({ apiKey: 'ch_live_test', fetch }).importMedia({ url: 'https://x' }), finished)
  assert.equal(calls.length, 1)
})

test('favorite posts to /api/v1/favorite with the asset target', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { favorited: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.favorite({ assetType: 'brand_kit', id: 'bk1' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/favorite')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { assetType: 'brand_kit', id: 'bk1' })
})

test('favorite names one output by its media reference', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { favorited: true } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.favorite({ mediaId: 'Abc12345-2' })
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { mediaId: 'Abc12345-2' })
})

test('favorite and archive carry their direction in the body, not the route', async () => {
  // /api/v1/unfavorite and /api/v1/unarchive are gone. They were their positive twins with one boolean
  // flipped, so the direction lived in the URL and every layer carried two of everything for one operation.
  const unfav = stubFetch([{ status: 200, body: { favorited: false } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: unfav.fetch, baseUrl: 'https://example.test' })
  await c1.favorite({ assetType: 'post', id: 'p1', favorited: false })
  assert.equal(unfav.calls[0]?.url, 'https://example.test/api/v1/favorite')
  assert.deepEqual(JSON.parse(unfav.calls[0]?.init?.body as string), { assetType: 'post', id: 'p1', favorited: false })

  const arch = stubFetch([{ status: 200, body: { archived: true } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: arch.fetch, baseUrl: 'https://example.test' })
  await c2.archive({ assetType: 'brand_kit_section', id: 's1' })
  assert.equal(arch.calls[0]?.url, 'https://example.test/api/v1/archive')
  // No `archived` in the body: the server defaults it to true, so omitting it still archives.
  assert.deepEqual(JSON.parse(arch.calls[0]?.init?.body as string), { assetType: 'brand_kit_section', id: 's1' })

  const unarch = stubFetch([{ status: 200, body: { archived: false } }])
  const c3 = new ContentHero({ apiKey: 'ch_live_test', fetch: unarch.fetch, baseUrl: 'https://example.test' })
  await c3.archive({ assetType: 'project', id: 'pr1', archived: false })
  assert.equal(unarch.calls[0]?.url, 'https://example.test/api/v1/archive')
  assert.deepEqual(JSON.parse(unarch.calls[0]?.init?.body as string), { assetType: 'project', id: 'pr1', archived: false })
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

/**
 * The defect this guards: `/api/v1/cards` and `/api/v1/stages` have always accepted
 * `space_id`, and the SDK never sent it. `listCards` is `.eq('space_id', ...)`
 * server-side, so it silently returned ONE space's cards while looking like the
 * whole account, and `search` missed every other board. Nothing failed; the answer
 * was just quietly incomplete.
 *
 * Asserting the URL is the only thing that catches this class, because a response
 * shape test passes whether or not the param was ever sent.
 */
test('spaceId reaches the wire for cards and stages, under its camelCase name', async () => {
  const cards = stubFetch([{ status: 200, body: { cards: [], total: 0, nextCursor: null } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: cards.fetch, baseUrl: 'https://example.test' })
  await c1.listCards({ spaceId: 'sp1', search: 'lesson' })
  const sent = new URL(cards.calls[0]!.url).searchParams
  assert.equal(sent.get('spaceId'), 'sp1', 'listCards must send spaceId')
  // The API refuses the old spelling with a 400, so it must never go out.
  assert.equal(sent.has('space_id'), false)
  assert.equal(sent.get('search'), 'lesson', 'listCards must keep its other filters')

  const stages = stubFetch([{ status: 200, body: { stages: [] } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: stages.fetch, baseUrl: 'https://example.test' })
  await c2.listStages({ spaceId: 'sp 2' })
  assert.equal(stages.calls[0]?.url, 'https://example.test/api/v1/stages?spaceId=sp+2')
})

test('listCards sends every filter under the name the API reads, and its sort', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { cards: [], total: 0, nextCursor: null, space: null } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const result = await client.listCards({ spaceId: 'all', isFavorite: true, tag: 'launch', archived: true, sort: 'scheduledAt', order: 'asc' })
  const sent = new URL(calls[0]!.url).searchParams
  assert.deepEqual(Object.fromEntries(sent), { spaceId: 'all', archived: 'true', isFavorite: 'true', tag: 'launch', sort: 'scheduledAt', order: 'asc' })
  // Every space was asked for, so no one space answered.
  assert.equal(result.space, null)
})

test('omitting spaceId sends no spaceId, so the server picks the default space', async () => {
  const cards = stubFetch([{ status: 200, body: { cards: [], total: 0, nextCursor: null } }])
  const c1 = new ContentHero({ apiKey: 'ch_live_test', fetch: cards.fetch, baseUrl: 'https://example.test' })
  await c1.listCards()
  assert.equal(cards.calls[0]?.url, 'https://example.test/api/v1/cards')

  const stages = stubFetch([{ status: 200, body: { stages: [] } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: stages.fetch, baseUrl: 'https://example.test' })
  await c2.listStages()
  assert.equal(stages.calls[0]?.url, 'https://example.test/api/v1/stages')
})

test('applyEditorOps posts ops to /api/v1/editor/ops and returns the result', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { surface: 'editor', revision: 4, results: [{ op: 'delete_clip', ok: true }] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const out = await client.applyEditorOps({
    projectId: 'p1',
    ops: [{ op: 'delete_clip', clipIds: ['a'] }],
    userIntent: 'remove intro',
    expectedRevision: 3,
  })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/ops')
  assert.equal(calls[0]?.init?.method, 'POST')
  const sent = JSON.parse(calls[0]?.init?.body as string)
  assert.equal(sent.projectId, 'p1')
  assert.equal(sent.userIntent, 'remove intro')
  assert.equal(sent.expectedRevision, 3)
  assert.equal(sent.ops.length, 1)
  assert.equal(sent.ops[0].op, 'delete_clip')
  assert.deepEqual(sent.ops[0].clipIds, ['a'])
  // A client opId (uuid) is generated for the op when the caller does not supply one; the API refuses op_id by name.
  assert.equal(sent.ops[0].op_id, undefined)
  assert.match(sent.ops[0].opId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  assert.equal(out.surface, 'editor')
  assert.equal(out.revision, 4)
  assert.equal(out.results[0]?.ok, true)
})

test('applyEditorOps preserves a caller-supplied opId (idempotency key)', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { surface: 'editor', revision: 4, results: [{ op: 'delete_clip', opId: 'mine-1', ok: true }] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.applyEditorOps({ projectId: 'p1', ops: [{ op: 'delete_clip', opId: 'mine-1', clipIds: ['a'] }] })
  const sent = JSON.parse(calls[0]?.init?.body as string)
  assert.equal(sent.ops[0].opId, 'mine-1')
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

test('getContext GETs /api/v1/context and returns the envelope', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { context: { surface: 'canvas', focusedSlideId: 's1', snapshotUrl: 'https://x/s.webp' }, participant: { userId: 'u1', sessionId: 'sess', surface: 'canvas', projectId: 'p1', cardId: null, updatedAt: '2026-07-12T00:00:00Z' }, participants: [] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const r = await client.getContext()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/context')
  assert.equal(calls[0]?.init?.method, 'GET')
  assert.equal((r.context as Record<string, unknown>)?.surface, 'canvas')
  assert.equal(r.participant?.userId, 'u1')
})

test('getContext with projectId appends the query param', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { context: null, participant: null, participants: [] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContext({ projectId: 'p 1' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/context?projectId=p%201')
})

test('getContext with render options appends render/frame/slide query params', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { context: null, participant: null, participants: [] } },
    { status: 200, body: { context: null, participant: null, participants: [] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContext({ projectId: 'p1', render: true, frame: 34 })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/context?projectId=p1&render=true&frame=34')
  await client.getContext({ projectId: 'p1', render: true, slideIndex: 2 })
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/context?projectId=p1&render=true&slideIndex=2')
})

test('getContext forwards an explicit render width', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { context: null, participant: null, participants: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContext({ projectId: 'p1', render: true, slideIndex: 1, width: 273 })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/context?projectId=p1&render=true&slideIndex=1&width=273')
})

// A render is a job with an id (the review loop). Break-verified: dropping any of the new params from getContext turns
// this red.
test('getContext sends the frames, the rate, the layout, a sound, a render to read and how long to wait', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { context: null, participant: null, participants: [] } },
    { status: 200, body: { context: null, participant: null, participants: [] } },
    { status: 200, body: { context: null, participant: null, participants: [] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContext({ projectId: 'p1', render: true, frames: [30, 5, 90], layout: 'sheets', wait: 20 })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/context?projectId=p1&render=true&frames=30%2C5%2C90&layout=sheets&wait=20')
  await client.getContext({ projectId: 'p1', sound: true, fromFrame: 0, toFrame: 300, perSecond: 4 })
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/context?projectId=p1&fromFrame=0&toFrame=300&perSecond=4&sound=true')
  await client.getContext({ renderId: 'r1', page: 3 })
  assert.equal(calls[2]?.url, 'https://example.test/api/v1/context?renderId=r1&page=3')
})

// Break-verified: dropping the region block from getContext turns this red.
test('getContext sends a region as x,y,width,height', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { context: null, participant: null, participants: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContext({ projectId: 'p1', render: true, width: 1920, region: { x: 480, y: 270, width: 240, height: 135 } })
  assert.equal(
    calls[0]?.url,
    'https://example.test/api/v1/context?projectId=p1&render=true&width=1920&region=480%2C270%2C240%2C135',
  )
})

// `includeRenderUrl` was retired (a read must not render and save a cover). A JavaScript caller still passing it
// must not make the read render. Break-verified: restoring the `params.set('includeRenderUrl', ...)` line turns this red.
test('getProject never asks the server to render, even when an old caller passes includeRenderUrl', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { project: { id: 'p1' } } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getProject('p1', { includeRenderUrl: true, detail: 'full' } as never)
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects/p1?detail=full')
})

test('listProjects GETs /api/v1/projects with filters and returns its page', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { projects: [{ id: 'p1', type: 'editor', surface: 'editor', kind: 'editor', title: 'A', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null }] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const page = await client.listProjects({ type: 'editor', search: 'A' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/projects?type=editor&search=A')
  assert.equal(page.projects.length, 1)
  assert.equal(page.projects[0]?.id, 'p1')
})

test('createProject POSTs to /api/v1/projects and unwraps { project }', async () => {
  const { fetch, calls } = stubFetch([{ status: 201, body: { project: { id: 'new1', type: 'editor', kind: 'editor', title: 'Untitled', orientation: '16:9', width: 1920, height: 1080, thumbnailUrl: null, isArchived: false, isFavorited: false, createdAt: null, updatedAt: null, surface: 'editor', revision: 0, state: {}, assetReferences: [], brandKitId: null, exportedPostId: null, exportedUrl: null, shareId: null, favoritedAt: null, archivedAt: null } } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const p = await client.createProject({ type: 'editor' })
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
  const { fetch, calls } = stubFetch([{ status: 200, body: { surface: 'editor', description: 'd', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, clipTypes: [], trackTypes: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const cat = await client.getTimelineTypes()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/timeline-types')
  assert.equal(cat.surface, 'editor')
})

test('getCodeGuide GETs the code authoring guide', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { version: 'abc12345', markdown: "# Writing a clip's code\n" } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const guide = await client.getCodeGuide()
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/code-guide')
  assert.equal(calls[0]?.init?.method ?? 'GET', 'GET')
  assert.equal(guide.version, 'abc12345')
})

test('listEffects and getEffect read the effect catalog, one effect by its name', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { effects: [{ name: 'glow', group: 'Blur & Shadow', description: 'd', importPath: '@remotion/effects/glow', onClips: true }], codeHosts: ['Solid'] } },
    { status: 200, body: { name: 'light leak', params: {} } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const list = await client.listEffects()
  await client.getEffect('light leak')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/effects')
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/editor/effects?name=light%20leak')
  assert.equal(list.effects[0]?.name, 'glow')
})

// The timeline schema reads in two steps (2026-10-09): the index by default, one entry by name, or the whole on request.
test('getTimelineTypes reads the index, one entry by name, or the whole schema', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getTimelineTypes()
  await client.getTimelineTypes({ name: 'update_clip' })
  await client.getTimelineTypes({ name: 'video', jsonSchema: true })
  await client.getTimelineTypes({ detail: 'full' })
  assert.deepEqual(calls.map((c) => c.url), [
    'https://example.test/api/v1/editor/timeline-types',
    'https://example.test/api/v1/editor/timeline-types?name=update_clip',
    'https://example.test/api/v1/editor/timeline-types?include=jsonSchema&name=video',
    'https://example.test/api/v1/editor/timeline-types?detail=full',
  ])
})

// The JSON Schema is opt-in on the server (most of the catalog's size), so the SDK asks for it only when told to.
test('a type catalog asks for the JSON Schema only when told to', async () => {
  const body = { surface: 'editor', description: 'd', sharedProps: { base: [], transform: [], decoration: [], adjust: [] }, clipTypes: [], trackTypes: [], layerTypes: [] }
  const { fetch, calls } = stubFetch([{ status: 200, body }, { status: 200, body }, { status: 200, body }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getTimelineTypes({ jsonSchema: true })
  await client.getLayerTypes({ jsonSchema: true })
  await client.getTimelineTypes({ jsonSchema: false })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/editor/timeline-types?include=jsonSchema')
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/editor/layer-types?include=jsonSchema')
  assert.equal(calls[2]?.url, 'https://example.test/api/v1/editor/timeline-types')
})

test('listMedia forwards source=uploads to the query', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { media: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.listMedia({ source: 'uploads' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/media?source=uploads')
  assert.equal(calls[0]?.init?.method, 'GET')
})

test('listMedia omits source when defaulting to creations', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { media: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.listMedia({})
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/media')
})

test('getMedia forwards source=uploads to the query', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { id: 'u1', type: 'video', source: 'uploads' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getMedia('u1', { source: 'uploads' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/media/u1?source=uploads')
})

test('listMedia forwards source=all and source=stock to the query (P2e)', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { media: [] } },
    { status: 200, body: { media: [] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.listMedia({ source: 'all' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/media?source=all')
  await client.listMedia({ source: 'stock' })
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/media?source=stock')
})

test('getMedia forwards source=stock to the query (P2e)', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { id: 's1', type: 'video', source: 'stock' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getMedia('s1', { source: 'stock' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/media/s1?source=stock')
})

test('searchMedia forwards query, kinds, and limit (P5)', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { results: [] } },
    { status: 200, body: { results: [] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.searchMedia('a red car at sunset')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/media/search?query=a+red+car+at+sunset')
  assert.equal(calls[0]?.init?.method, 'GET')
  await client.searchMedia('waves', { kinds: ['video', 'image'], limit: 5 })
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/media/search?query=waves&kinds=video%2Cimage&limit=5')
})

test('searchMedia returns a page of results and the next cursor', async () => {
  const { fetch } = stubFetch([
    { status: 200, body: { results: [{ id: 'x1', sourceTable: 'studio_outputs', kind: 'video', url: 'u', summary: 's', tags: [], relevance: 0.9, scenes: [] }], nextCursor: 'n1' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const page = await client.searchMedia('x')
  assert.equal(page.results.length, 1)
  assert.equal(page.results[0]?.id, 'x1')
  assert.equal(page.nextCursor, 'n1')
})

/**
 * ONE paging shape for every paged listing (9.7b): `limit` and `cursor` go out, `offset` never does, and the page
 * comes back with its items key and `nextCursor`. Table-driven, so a listing that drifts back to its own shape fails
 * here by name.
 */
test('every paged listing sends limit and cursor, never offset, and returns nextCursor', async () => {
  const page = { limit: 7, cursor: 'c-1' }
  const listings: Array<{ name: string; path: string; body: Record<string, unknown>; call: (c: ContentHero) => Promise<{ nextCursor: string | null }> }> = [
    { name: 'listMedia', path: '/api/v1/media', body: { media: [] }, call: (c) => c.listMedia(page) },
    { name: 'searchMedia', path: '/api/v1/media/search', body: { results: [] }, call: (c) => c.searchMedia('q', page) },
    { name: 'getFolder', path: '/api/v1/library/folders/f1', body: { folder: null, items: [] }, call: (c) => c.getFolder('f1', page) },
    { name: 'listCards', path: '/api/v1/cards', body: { cards: [], total: 0, space: { id: 's', name: 'S' } }, call: (c) => c.listCards(page) },
    { name: 'listContent', path: '/api/v1/content', body: { content: [], total: 0 }, call: (c) => c.listContent(page) },
    { name: 'listBrandKnowledge', path: '/api/v1/brand-kits/k1/knowledge', body: { items: [], total: 0 }, call: (c) => c.listBrandKnowledge('k1', page) },
    { name: 'listTemplates', path: '/api/v1/templates', body: { templates: [] }, call: (c) => c.listTemplates(page) },
    { name: 'listProjects', path: '/api/v1/projects', body: { projects: [] }, call: (c) => c.listProjects(page) },
    // Paged in 9.9 (every growable list pages).
    { name: 'listTags', path: '/api/v1/tags', body: { tags: [] }, call: (c) => c.listTags(page) },
    { name: 'listAvatars', path: '/api/v1/avatars', body: { avatars: [] }, call: (c) => c.listAvatars(page) },
    { name: 'listVoices', path: '/api/v1/voices', body: { voices: [] }, call: (c) => c.listVoices(page) },
    { name: 'listBrandKits', path: '/api/v1/brand-kits', body: { brandKits: [] }, call: (c) => c.listBrandKits(page) },
    { name: 'listTrackedAccounts', path: '/api/v1/accounts', body: { trackedAccounts: [] }, call: (c) => c.listTrackedAccounts(page) },
    { name: 'listConnectedAccounts', path: '/api/v1/connected-accounts', body: { connectedAccounts: [] }, call: (c) => c.listConnectedAccounts(page) },
    { name: 'listKlingElements', path: '/api/v1/kling-elements', body: { klingElements: [] }, call: (c) => c.listKlingElements(page) },
    { name: 'listStages', path: '/api/v1/stages', body: { stages: [], space: { id: 's', name: 'S' } }, call: (c) => c.listStages(page) },
    { name: 'listSpaces', path: '/api/v1/spaces', body: { spaces: [] }, call: (c) => c.listSpaces(page) },
    { name: 'listFolders', path: '/api/v1/library/folders', body: { folders: [], derived: [] }, call: (c) => c.listFolders(page) },
    { name: 'listTemplateCategories', path: '/api/v1/templates/categories', body: { categories: [] }, call: (c) => c.listTemplateCategories(page) },
    { name: 'listProjectVersions', path: '/api/v1/projects/p1/versions', body: { versions: [] }, call: (c) => c.listProjectVersions('p1', page) },
  ]
  for (const l of listings) {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ...l.body, nextCursor: 'next-1' } }])
    const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
    const result = await l.call(client)
    const url = new URL(calls[0]!.url)
    assert.equal(url.pathname, l.path, l.name)
    assert.equal(url.searchParams.get('limit'), '7', `${l.name} must send limit`)
    assert.equal(url.searchParams.get('cursor'), 'c-1', `${l.name} must send cursor`)
    assert.equal(url.searchParams.has('offset'), false, `${l.name} must not send offset`)
    assert.equal(result.nextCursor, 'next-1', `${l.name} must return nextCursor`)
  }
})

// --- A submitted generation must never lose its outputId -------------------------
// Once the POST succeeds the job is running and CHARGED. If a poll then fails, dropping
// the id leaves the caller no way to resume, and the natural retry pays for the same
// generation twice. This is what turned a transient dev-server 404 into a "failed"
// board that had in fact rendered.

test('generateAndWait surfaces the outputId when polling fails transiently', async () => {
  const { fetch } = stubFetch([
    { status: 200, body: { outputId: 'out_1', status: 'processing' } }, // submit OK
    { status: 500, body: { error: 'upstream blip' } },                  // poll blows up
  ])
  const client = new ContentHero({ apiKey: 'k', fetch })
  await assert.rejects(
    () => client.generateAndWait({ modelId: 'gpt-image-2', prompt: 'x' }, { timeoutMs: 5_000 }),
    (err: unknown) => {
      assert.ok(err instanceof GenerationInterruptedError)
      assert.equal(err.outputId, 'out_1')
      return true
    },
  )
})

test('generateBoardAndWait surfaces the outputId too', async () => {
  const { fetch } = stubFetch([
    { status: 200, body: { outputId: 'board_1', status: 'processing' } },
    { status: 404, body: { error: 'not found' } },
  ])
  const client = new ContentHero({ apiKey: 'k', fetch })
  await assert.rejects(
    () => client.generateBoardAndWait({ boardType: 'object', prompt: 'mug' }, { timeoutMs: 5_000 }),
    (err: unknown) => err instanceof GenerationInterruptedError && err.outputId === 'board_1',
  )
})

test('a genuinely FAILED generation stays terminal, not interrupted', async () => {
  const { fetch } = stubFetch([
    { status: 200, body: { outputId: 'out_2', status: 'processing' } },
    { status: 200, body: { outputId: 'out_2', status: 'failed', error: 'model rejected it' } },
  ])
  const client = new ContentHero({ apiKey: 'k', fetch })
  await assert.rejects(
    () => client.generateAndWait({ modelId: 'gpt-image-2', prompt: 'x' }, { timeoutMs: 5_000 }),
    (err: unknown) => err instanceof GenerationFailedError,
  )
})

test('pendingOutputId marks resumable errors and only those', () => {
  assert.equal(pendingOutputId(new GenerationTimeoutError('a')), 'a')
  assert.equal(pendingOutputId(new GenerationInterruptedError('b', new Error('blip'))), 'b')
  // Terminal: the generation failed, so resuming is wrong and retrying is the caller's call.
  assert.equal(pendingOutputId(new GenerationFailedError('c', 'nope')), undefined)
  assert.equal(pendingOutputId(new Error('unrelated')), undefined)
})

// ── uploadMedia sends the headers the SERVER dictates ─────────────────────────────────────────────────
//
// The PUT goes straight to object storage. While that was Supabase, `Content-Type` alone sufficed. R2 signs
// the owner into the presigned URL as `x-amz-meta-user_id`, and a PUT missing it is refused with
// SignatureDoesNotMatch (verified against real R2: 403 with Content-Type alone, 200 with both). So the client
// must send what it is told rather than what it assumes, or every CLI and MCP upload breaks at the cutover.

test('uploadMedia sends the uploadHeaders the API returned', async () => {
  const { fetch, calls } = stubFetch([
    {
      status: 201,
      body: {
        outputId: 'out_1',
        uploadUrl: 'https://store.example/put',
        uploadHeaders: { 'Content-Type': 'image/png', 'x-amz-meta-user_id': 'user_9' },
        storagePath: 'asset_1/original.png',
        expiresAt: '2026-01-01T00:00:00Z',
      },
    },
    { status: 200, body: {} },
    { status: 200, body: { outputId: 'out_1', url: 'https://media.example/asset_1/original.png' } },
  ])
  const ch = new ContentHero({ apiKey: 'k', fetch })
  await ch.uploadMedia(new Blob([new Uint8Array([1, 2, 3])]), {
    fileName: 'a.png',
    contentType: 'image/png',
  })

  const put = calls.find((c) => c.url === 'https://store.example/put')
  assert.ok(put, 'the PUT went to the URL the server gave')
  assert.deepEqual(put?.init?.headers, { 'Content-Type': 'image/png', 'x-amz-meta-user_id': 'user_9' })
})

test('uploadMedia falls back to Content-Type when the API omits uploadHeaders', async () => {
  // An older API deployment returns no uploadHeaders. The two must be deployable in either order, so the
  // client keeps working rather than sending `undefined` headers and failing on a store that needs none.
  const { fetch, calls } = stubFetch([
    {
      status: 201,
      body: {
        outputId: 'out_2',
        uploadUrl: 'https://store.example/put2',
        storagePath: 'legacy/path.png',
        expiresAt: '2026-01-01T00:00:00Z',
      },
    },
    { status: 200, body: {} },
    { status: 200, body: { outputId: 'out_2', url: 'https://media.example/legacy/path.png' } },
  ])
  const ch = new ContentHero({ apiKey: 'k', fetch })
  await ch.uploadMedia(new Blob([new Uint8Array([1])]), { fileName: 'b.png', contentType: 'image/png' })

  const put = calls.find((c) => c.url === 'https://store.example/put2')
  assert.deepEqual(put?.init?.headers, { 'Content-Type': 'image/png' })
})

/**
 * Stage WRITES. `/api/v1/stages` was read-only until now: an agent could see a board's columns and
 * never change them, so it could file a card into Review but could not create Review.
 */
test('createStage posts the camelCase body the v1 route reads', async () => {
  const { fetch, calls } = stubFetch([
    { status: 201, body: { stage: { id: 'st1', name: 'In Review', slug: 'in-review', color: null } } },
  ])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const stage = await c.createStage({ name: 'In Review', spaceId: 'sp1', afterId: 'st0' })

  assert.equal(calls[0]?.url, 'https://example.test/api/v1/stages')
  assert.equal(calls[0]?.init?.method, 'POST')
  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.name, 'In Review')
  assert.equal(body.spaceId, 'sp1')
  // The route refuses the old snake_case names with a 400, so only the camelCase ones may go out.
  assert.equal(body.afterId, 'st0')
  assert.equal('after_id' in body || 'space_id' in body, false)
  assert.equal(stage.slug, 'in-review')
})

test('createStage may omit the space, and every other stage write may not', async () => {
  const { fetch, calls } = stubFetch([{ status: 201, body: { stage: { id: 'st1', name: 'X', slug: 'x', color: null } } }])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await c.createStage({ name: 'X' })
  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.spaceId, undefined, 'an absent space means the account default, deliberately')
})

/**
 * A rename must never move the column: a placement that is not named is not sent. An end is `position`, never a null
 * neighbor (the ordering contract).
 */
test('updateStage sends only the fields given, and moves only when a placement is named', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { stage: { id: 'st1', name: 'Done', slug: 'done', color: null } } },
  ])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await c.updateStage('st1', { spaceId: 'sp1', name: 'Done' })

  assert.equal(calls[0]?.url, 'https://example.test/api/v1/stages/st1')
  assert.equal(calls[0]?.init?.method, 'PATCH')
  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.name, 'Done')
  assert.equal(body.spaceId, 'sp1')
  assert.ok(!('afterId' in body), 'omitting the anchors must not move the column')
  assert.ok(!('color' in body), 'a PATCH leaves an omitted field alone')

  const edge = stubFetch([{ status: 200, body: { stage: { id: 'st1', name: 'Done', slug: 'done', color: null } } }])
  const c2 = new ContentHero({ apiKey: 'ch_live_test', fetch: edge.fetch, baseUrl: 'https://example.test' })
  const moved = await c2.updateStage('st1', { spaceId: 'sp1', position: 'top' })
  const edgeBody = JSON.parse(String(edge.calls[0]?.init?.body))
  assert.deepEqual(edgeBody, { spaceId: 'sp1', position: 'top' })
  // The stage itself comes back, with no position: the list is the board's order.
  assert.equal(moved.id, 'st1')
  assert.equal('sortOrder' in moved, false)
})

test('updateStage encodes the id, so a stage id is never pasted raw into the path', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { stage: { id: 'a/b', name: 'X', slug: 'x', color: null } } }])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await c.updateStage('a/b', { spaceId: 'sp1', name: 'X' })
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/stages/a%2Fb')
})

test('deleteStage sends the board and the target in its body, and reads movedCards', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { success: true, id: 'st1', movedCards: 4, stages: [{ id: 'st2', name: 'Ideation', slug: 'ideation', color: null }] } },
  ])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const result = await c.deleteStage('st1', { spaceId: 'sp1', targetStageId: 'st2' })

  assert.equal(calls[0]?.init?.method, 'DELETE')
  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.spaceId, 'sp1')
  assert.equal(body.targetStageId, 'st2')
  assert.equal(result.movedCards, 4)
  assert.equal(result.stages.length, 1)
})

test('deleteStage sends an explicit null target, so the server can refuse a non-empty column', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { success: true, id: 'st1', movedCards: 0, stages: [] } }])
  const c = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await c.deleteStage('st1', { spaceId: 'sp1' })
  const body = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(body.targetStageId, null)
})

test('getContent sends analysisSections camelCase, the one spelling the API accepts', async () => {
  // 🚨 0.4.11 and 0.4.12 sent `analysis_sections`, the API's one snake_case newcomer, and the app's wire check
  // failed CI for a day over it. The API now refuses that spelling, so this is the name that must go out.
  const { fetch, calls } = stubFetch([{ status: 200, body: { id: 'c1' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test/' })
  await client.getContent('c1', { analysisSections: ['hook', 'structure'] })
  const url = new URL(calls[0]!.url)
  assert.equal(url.searchParams.get('analysisSections'), 'hook,structure')
  assert.equal(url.searchParams.has('analysis_sections'), false)
})

test('analyzeContent posts to the analysis route, and its price check sends getCost', async () => {
  const { fetch, calls } = stubFetch([
    { status: 202, body: { contentId: 'c1', analysis: { status: 'running' } } },
    { status: 200, body: { getCost: true, creditsEstimate: 10, contentId: 'c1' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const started = await client.analyzeContent('c1')
  assert.equal(started.analysis.status, 'running')
  const cost = await client.estimateAnalysisCost('c1')
  assert.equal(cost.creditsEstimate, 10)
  assert.equal(new URL(calls[0]!.url).pathname, '/api/v1/content/c1/analysis')
  assert.equal(calls[0]!.init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { getCost: true })
})

test('analyzeContent and its price check carry kind scenes when asked, and nothing when not', async () => {
  const { fetch, calls } = stubFetch([
    { status: 202, body: { contentId: 'c1', kind: 'scenes', scenes: { status: 'running' } } },
    { status: 200, body: { getCost: true, creditsEstimate: 5, contentId: 'c1', kind: 'scenes' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const started = await client.analyzeContent('c1', { kind: 'scenes' })
  assert.equal(started.scenes.status, 'running')
  await client.estimateAnalysisCost('c1', { kind: 'scenes' })
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { kind: 'scenes' })
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { getCost: true, kind: 'scenes' })
})

test('getContent asks for scenes on the wire only when a grain is named', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: {} }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContent('c1', { scenes: 'frames', startMs: 2000 })
  await client.getContent('c1', { scenes: 'none' })
  assert.equal(new URL(calls[0]!.url).search, '?startMs=2000&scenes=frames')
  assert.equal(new URL(calls[1]!.url).search, '')
})

test('every listProjects filter reaches the request, aliases included', async () => {
  // `Required<>` makes a new ListProjectsInput field a compile error here until it is covered. Until sdk 0.4.16 the
  // client sent only `kind`, so `surface` (the documented field) was silently dropped and every caller got both
  // project types back (found by a Cowork test, 2026-09-27).
  const every: Required<ListProjectsInput> = { filter: 'archived', type: 'canvas', surface: 'canvas', kind: 'canvas', search: 'deck', sort: 'title', order: 'asc', limit: 10, cursor: 'c9' }
  for (const key of Object.keys(every) as Array<keyof ListProjectsInput>) {
    const { fetch, calls } = stubFetch([{ status: 200, body: { projects: [] } }])
    const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
    await client.listProjects({ [key]: every[key] } as ListProjectsInput)
    const params = new URL(calls[0]!.url).searchParams
    const sent = [...params.values()]
    assert.ok(sent.includes(String(every[key])), `${key} did not reach the request: ${calls[0]!.url}`)
  }
})

test('listProjects sends one type field, and type wins over its aliases', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { projects: [] } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.listProjects({ type: 'editor', surface: 'canvas', kind: 'canvas' })
  const params = new URL(calls[0]!.url).searchParams
  assert.equal(params.get('type'), 'editor')
  assert.equal(params.get('surface'), null)
  assert.equal(params.get('kind'), null)
})

const KLING_ELEMENT = {
  id: '11111111-1111-4111-8111-111111111111',
  shortId: 'Kling001',
  appUrl: 'https://app.contenthero.ai/kling-element/Kling001',
  name: 'hero',
  category: 'character',
  description: 'the subject',
  inputUrls: ['https://media.contenthero.ai/a.jpg', 'https://media.contenthero.ai/b.jpg'],
  inputVideoUrl: null,
  previewUrl: 'https://media.contenthero.ai/a.jpg',
  createdAt: 't',
}

test('Kling elements live at /api/v1/kling-elements, and the list reads klingElements', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { klingElements: [KLING_ELEMENT], nextCursor: null } },
    { status: 200, body: KLING_ELEMENT },
    { status: 201, body: KLING_ELEMENT },
    { status: 200, body: KLING_ELEMENT },
    { status: 200, body: { deleted: true, id: KLING_ELEMENT.id } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  assert.deepEqual(await client.listKlingElements(), { klingElements: [KLING_ELEMENT], nextCursor: null })
  assert.deepEqual(await client.getKlingElement('Kling 001'), KLING_ELEMENT)
  await client.createKlingElement({ name: 'hero', description: 'the subject', images: KLING_ELEMENT.inputUrls })
  await client.updateKlingElement('Kling001', { name: 'villain' })
  assert.deepEqual(await client.deleteKlingElement('Kling001'), { deleted: true, id: KLING_ELEMENT.id })
  assert.deepEqual(
    calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`),
    [
      'GET /api/v1/kling-elements',
      'GET /api/v1/kling-elements/Kling%20001',
      'POST /api/v1/kling-elements',
      'PATCH /api/v1/kling-elements/Kling001',
      'DELETE /api/v1/kling-elements/Kling001',
    ],
  )
  assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), { name: 'villain' })
})

test('the pre-rename element methods call their Kling twins, so there is one implementation', async () => {
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: stubFetch([{ status: 500, body: {} }]).fetch })
  const seen: string[] = []
  const twin = client as unknown as Record<string, unknown>
  for (const name of ['listKlingElements', 'getKlingElement', 'createKlingElement', 'updateKlingElement', 'deleteKlingElement']) {
    twin[name] = async (...args: unknown[]) => {
      seen.push(`${name} ${JSON.stringify(args)}`)
      return name
    }
  }
  assert.equal(await client.listElements(), 'listKlingElements')
  assert.equal(await client.getElement('k1'), 'getKlingElement')
  assert.equal(await client.createElement({ name: 'n', description: 'd', video: 'v' }), 'createKlingElement')
  assert.equal(await client.updateElement('k1', { category: 'prop' }), 'updateKlingElement')
  assert.equal(await client.deleteElement('k1'), 'deleteKlingElement')
  assert.deepEqual(seen, [
    'listKlingElements [{}]',
    'getKlingElement ["k1"]',
    'createKlingElement [{"name":"n","description":"d","video":"v"}]',
    'updateKlingElement ["k1",{"category":"prop"}]',
    'deleteKlingElement ["k1"]',
  ])
})

test('templates live at /api/v1/templates: a list pages with a cursor, reads unwrap template, writes keep their warnings', async () => {
  const TEMPLATE = { id: '22222222-2222-4222-8222-222222222222', name: 'Lower third', version: 3, code: 'export default () => null' }
  const { fetch, calls } = stubFetch([
    { status: 200, body: { templates: [TEMPLATE], nextCursor: 'eyJvZmZzZXQiOjF9' } },
    { status: 200, body: { categories: [{ category: 'lower-thirds', count: 4 }], nextCursor: null } },
    { status: 200, body: { template: TEMPLATE } },
    { status: 201, body: { template: TEMPLATE, warnings: ['interpolate needs two different keyframes'] } },
    { status: 200, body: { template: TEMPLATE, warnings: [] } },
    { status: 200, body: { deleted: true, id: TEMPLATE.id } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const page = await client.listTemplates({ scope: 'user', kind: 'code', category: ['lower-thirds', 'cta'], search: '100% sale', cursor: 'c1', limit: 50 })
  assert.deepEqual(page, { templates: [TEMPLATE], nextCursor: 'eyJvZmZzZXQiOjF9' })
  assert.deepEqual(await client.listTemplateCategories({ scope: 'all' }), { categories: [{ category: 'lower-thirds', count: 4 }], nextCursor: null })
  assert.deepEqual(await client.getTemplate(TEMPLATE.id), TEMPLATE)
  const created = await client.createTemplate({ fromItem: { projectId: 'p1', itemId: 'g1' }, category: 'lower-thirds' })
  assert.deepEqual(created.warnings, ['interpolate needs two different keyframes'])
  await client.updateTemplate(TEMPLATE.id, { props: { title: 'Hi' } }, { expectedVersion: 3 })
  assert.deepEqual(await client.deleteTemplate(TEMPLATE.id), { deleted: true, id: TEMPLATE.id })

  assert.deepEqual(
    calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`),
    [
      'GET /api/v1/templates',
      'GET /api/v1/templates/categories',
      `GET /api/v1/templates/${TEMPLATE.id}`,
      'POST /api/v1/templates',
      `PATCH /api/v1/templates/${TEMPLATE.id}`,
      `DELETE /api/v1/templates/${TEMPLATE.id}`,
    ],
  )
  const params = new URL(calls[0]!.url).searchParams
  assert.deepEqual(
    { scope: params.get('scope'), kind: params.get('kind'), category: params.getAll('category'), search: params.get('search'), cursor: params.get('cursor'), limit: params.get('limit') },
    { scope: 'user', kind: 'code', category: ['lower-thirds', 'cta'], search: '100% sale', cursor: 'c1', limit: '50' },
  )
  assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), { fromItem: { projectId: 'p1', itemId: 'g1' }, category: 'lower-thirds' })
  // The version read rides the body, where the route reads it.
  assert.deepEqual(JSON.parse(String(calls[4]?.init?.body)), { props: { title: 'Hi' }, expectedVersion: 3 })
})

/**
 * ONE sort shape for every sortable listing (9.9, the app's "API Lists"): `sort` names a field of that list and `order`
 * is asc or desc. Table-driven over `LIST_SORTS`, so a listing that drifts to its own spelling (content's retired
 * `sort_by` / `sort_order`) fails here by name.
 */
test('every sortable listing sends sort and order, and only those names', async () => {
  const listings: Array<{ name: string; path: string; body: Record<string, unknown>; call: (c: ContentHero) => Promise<unknown> }> = [
    { name: 'listCards', path: '/api/v1/cards', body: { cards: [], total: 0, space: null }, call: (c) => c.listCards({ sort: LIST_SORTS.cards[3], order: 'asc' }) },
    { name: 'listProjects', path: '/api/v1/projects', body: { projects: [] }, call: (c) => c.listProjects({ sort: LIST_SORTS.projects[2], order: 'asc' }) },
    { name: 'listSpaces', path: '/api/v1/spaces', body: { spaces: [] }, call: (c) => c.listSpaces({ sort: LIST_SORTS.spaces[2], order: 'asc' }) },
    { name: 'listContent', path: '/api/v1/content', body: { content: [], total: 0 }, call: (c) => c.listContent({ sort: LIST_SORTS.content[2], order: 'asc' }) },
    { name: 'listMedia', path: '/api/v1/media', body: { media: [] }, call: (c) => c.listMedia({ sort: LIST_SORTS.media[2], order: 'asc' }) },
  ]
  const expected: Record<string, string> = { listCards: 'title', listProjects: 'title', listSpaces: 'cardCount', listContent: 'publishedAt', listMedia: 'sizeBytes' }
  for (const l of listings) {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ...l.body, nextCursor: null } }])
    await l.call(new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' }))
    const url = new URL(calls[0]!.url)
    assert.equal(url.pathname, l.path, l.name)
    assert.equal(url.searchParams.get('sort'), expected[l.name], `${l.name} must send sort`)
    assert.equal(url.searchParams.get('order'), 'asc', `${l.name} must send order`)
    for (const old of ['sort_by', 'sort_order', 'sortBy', 'sortOrder']) assert.equal(url.searchParams.has(old), false, `${l.name} sent ${old}`)
  }
})

test('listContent sends every filter camelCase and reads its items under content', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { content: [{ id: 'c1' }], total: 1, nextCursor: null } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const result = await client.listContent({
    contentType: 'short', outlierScoreMin: 1, outlierScoreMax: 2, viewsMin: 3, viewsMax: 4, durationMin: 5, durationMax: 6,
    subscribersMin: 7, subscribersMax: 8, publishedAfter: 'a', publishedBefore: 'b', publicationDate: 'month',
    accountIds: ['x', 'y'], addedByYou: true, brandKitId: 'bk', favorited: true, search: 'hooks', sort: 'relevance',
  })
  assert.deepEqual(Object.fromEntries(new URL(calls[0]!.url).searchParams), {
    contentType: 'short', outlierScoreMin: '1', outlierScoreMax: '2', viewsMin: '3', viewsMax: '4', durationMin: '5', durationMax: '6',
    subscribersMin: '7', subscribersMax: '8', publishedAfter: 'a', publishedBefore: 'b', publicationDate: 'month', search: 'hooks',
    accountIds: 'x,y', addedByYou: 'true', brandKitId: 'bk', favorited: 'true', sort: 'relevance',
  })
  assert.equal(result.content[0]?.id, 'c1')
})

test('getContent sends the transcript window and search camelCase', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { id: 'c1' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.getContent('c1', { startMs: 1, endMs: 2, transcriptSearch: 'hook' })
  assert.deepEqual(Object.fromEntries(new URL(calls[0]!.url).searchParams), { startMs: '1', endMs: '2', transcriptSearch: 'hook' })
})

test('listSpaces sends its filters, and spaces carry cardCount', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { spaces: [{ id: 's1', cardCount: 3 }], nextCursor: null } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const { spaces } = await client.listSpaces({ archived: true, favorited: true, search: 'client', sort: 'name', order: 'asc' })
  assert.deepEqual(Object.fromEntries(new URL(calls[0]!.url).searchParams), { archived: 'true', favorited: 'true', search: 'client', sort: 'name', order: 'asc' })
  assert.equal(spaces[0]?.cardCount, 3)
})

test('space writes send camelCase bodies', async () => {
  const { fetch, calls } = stubFetch([{ status: 201, body: { space: { id: 's1' } } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.createSpace({ name: 'N', coverUrl: 'u', coverPosition: { x: 1, y: 2 }, duplicateFrom: 's0' })
  await client.updateSpace('s1', { coverUrl: null, coverPosition: null })
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { name: 'N', coverUrl: 'u', coverPosition: { x: 1, y: 2 }, duplicateFrom: 's0' })
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { coverUrl: null, coverPosition: null })
})

test('listTrackedAccounts sends camelCase filters and reads trackedAccounts; listConnectedAccounts reads connectedAccounts', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { trackedAccounts: [{ id: 't1' }], nextCursor: null } },
    { status: 200, body: { connectedAccounts: [{ id: 'c1' }], nextCursor: null } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const tracked = await client.listTrackedAccounts({ accountType: 'brand', brandKitId: 'bk' })
  assert.deepEqual(Object.fromEntries(new URL(calls[0]!.url).searchParams), { accountType: 'brand', brandKitId: 'bk' })
  assert.equal(tracked.trackedAccounts[0]?.id, 't1')
  const connected = await client.listConnectedAccounts()
  assert.equal(connected.connectedAccounts[0]?.id, 'c1')
})

test('project fields, copies and timeline settings reach their routes', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { project: { id: 'p1', title: 'T' } } },
    { status: 201, body: { project: { id: 'p2' } } },
    { status: 200, body: { settings: { snapping: true } } },
    { status: 200, body: { settings: { snapping: false } } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const updated = await client.updateProject('p1', { title: 'T', brandKitId: null, coverPosition: { x: 50, y: 40 }, cover: { frame: 12 } })
  assert.equal(updated.id, 'p1')
  assert.equal((await client.duplicateProject('p1')).id, 'p2')
  assert.equal((await client.getTimelineSettings('p1')).snapping, true)
  assert.equal((await client.updateTimelineSettings('p1', { snapping: false, linkedTracks: { audio: false } })).snapping, false)
  assert.deepEqual(
    calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`),
    ['PATCH /api/v1/projects/p1', 'POST /api/v1/projects/p1/duplicate', 'GET /api/v1/projects/p1/settings', 'PATCH /api/v1/projects/p1/settings'],
  )
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { title: 'T', brandKitId: null, coverPosition: { x: 50, y: 40 }, cover: { frame: 12 } })
  assert.deepEqual(JSON.parse(String(calls[3]!.init?.body)), { snapping: false, linkedTracks: { audio: false } })
})

test("a project's exports are read a page at a time", async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { exports: [{ exportId: 'e1', status: 'completed' }], nextCursor: 'n' } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const page = await client.listProjectExports('p 1', { limit: 5, cursor: 'c' })
  assert.equal(page.exports[0]?.exportId, 'e1')
  assert.equal(page.nextCursor, 'n')
  const url = new URL(calls[0]!.url)
  assert.equal(`${calls[0]!.init?.method} ${url.pathname}`, 'GET /api/v1/projects/p%201/exports')
  assert.equal(url.searchParams.get('limit'), '5')
  assert.equal(url.searchParams.get('cursor'), 'c')
})

test('share links reach their routes: a project by its id, media by their media ids', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { shared: true, shareUrl: 'https://share.example/p' } },
    { status: 200, body: { shared: false, shareUrl: null } },
    { status: 200, body: { shareUrl: 'https://pages.example/s', mediaIds: ['m-1', 'm-2'] } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  assert.deepEqual(await client.shareProject('p 1'), { shared: true, shareUrl: 'https://share.example/p' })
  assert.equal((await client.shareProject('p 1', { shared: false })).shareUrl, null)
  assert.deepEqual((await client.shareMedia({ mediaIds: ['m-1', 'm-2'], title: 'Set' })).mediaIds, ['m-1', 'm-2'])
  assert.deepEqual(
    calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`),
    ['POST /api/v1/projects/p%201/share', 'POST /api/v1/projects/p%201/share', 'POST /api/v1/media/share'],
  )
  // No `shared` when sharing: the server defaults it to true.
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {})
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { shared: false })
  assert.deepEqual(JSON.parse(String(calls[2]!.init?.body)), { mediaIds: ['m-1', 'm-2'], title: 'Set' })
})

test('version history, undo and redo reach their routes with the bodies the API reads', async () => {
  const { fetch, calls } = stubFetch([
    { status: 200, body: { versions: [{ id: 'v1' }], nextCursor: null } },
    { status: 201, body: { version: { id: 'v2', label: 'Before' } } },
    { status: 200, body: { revision: 9, kind: 'tracks' } },
    { status: 201, body: { project: { id: 'p2' } } },
    { status: 200, body: { version: { id: 'v1', label: 'Final' } } },
    { status: 200, body: { deleted: true } },
    { status: 200, body: { revision: 10, undidRevision: 8, label: 'Undid revision 8' } },
    { status: 200, body: { revision: 11, undidRevision: 10, label: 'Undid revision 10' } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  assert.equal((await client.listProjectVersions('p1')).versions[0]?.id, 'v1')
  assert.equal((await client.saveProjectVersion('p1', { label: 'Before' })).id, 'v2')
  assert.deepEqual(await client.restoreProjectVersion('p1', 'v1'), { revision: 9, kind: 'tracks' })
  assert.equal((await client.copyProjectVersion('p1', 'v1')).id, 'p2')
  assert.deepEqual(await client.renameProjectVersion('p1', 'v1', 'Final'), { id: 'v1', label: 'Final' })
  await client.deleteProjectVersion('p1', 'v1')
  assert.equal((await client.undo('p1', { expectedRevision: 9 })).undidRevision, 8)
  assert.equal((await client.redo('p1', { expectedRevision: 10 })).revision, 11)
  assert.deepEqual(
    calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname} ${c.init?.body ?? ''}`.trim()),
    [
      'GET /api/v1/projects/p1/versions',
      'POST /api/v1/projects/p1/versions {"label":"Before"}',
      'POST /api/v1/projects/p1/versions/v1 {"action":"restore"}',
      'POST /api/v1/projects/p1/versions/v1 {"action":"copy"}',
      'PATCH /api/v1/projects/p1/versions/v1 {"label":"Final"}',
      'DELETE /api/v1/projects/p1/versions/v1',
      'POST /api/v1/projects/p1/undo {"expectedRevision":9}',
      'POST /api/v1/projects/p1/redo {"expectedRevision":10}',
    ],
  )
})

test('listMedia sends the library contract: a source partition, several types, and only completed', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { media: [{ mediaId: 'm1', fileName: 'a.mp4', sizeBytes: 2048, assetId: 'as1' }], nextCursor: null } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const page = await client.listMedia({ source: 'exports', contentType: ['video', 'doc'], status: 'completed', favorited: true, sort: 'fileName', order: 'asc' })
  assert.deepEqual(Object.fromEntries(new URL(calls[0]!.url).searchParams), {
    source: 'exports', contentType: 'video,doc', status: 'completed', favorited: 'true', sort: 'fileName', order: 'asc',
  })
  assert.equal(page.media[0]?.sizeBytes, 2048)
  assert.equal(page.media[0]?.assetId, 'as1')
})

test('responses are read camelCase: templates, brand kit media, versions', async () => {
  const { fetch } = stubFetch([
    { status: 200, body: { template: { id: 't1', propsSchema: null, durationFrames: 90, artboard: { width: 1920, height: 1080, content: { x: 0, y: 0, width: 960, height: 540 } }, codeMd5: 'abc' } } },
    { status: 200, body: { id: 'bk1', logos: [{ url: 'u', isPrimary: true, aspectRatio: '1:1' }], assets: [{ url: 'a', aspectRatio: '16:9' }], socialAccounts: [{ platform: 'instagram', avatarUrl: 'p' }] } },
    { status: 201, body: { version: { id: 'v1', kind: 'tracks', createdBy: 'u', authorName: 'T', label: null, triggerReason: 'manual', sizeBytes: 1, revision: 2, createdAt: 't' } } },
  ])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  const t = await client.getTemplate('t1')
  assert.equal(t.artboard?.content.width, 960)
  assert.equal(t.durationFrames, 90)
  const kit = await client.getBrandKit('bk1')
  assert.equal(kit.logos[0]?.isPrimary, true)
  assert.equal(kit.socialAccounts[0]?.avatarUrl, 'p')
  const v = await client.saveProjectVersion('p1')
  assert.equal(v.triggerReason, 'manual')
})

/** The ordering contract: every hand-arranged list moves by neighbor or end, with the same three names. */
test('every hand-arranged list takes afterId, beforeId and position, on the route that moves it', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { post: { id: 'c' }, stage: { id: 's' }, template: { id: 't' }, warnings: [], account: { id: 'a' }, folder: { id: 'f' } } }])
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://example.test' })
  await client.createCard({ title: 'T', platform: 'youtube', position: 'top' })
  await client.updateCard('c1', { stage: 'Review', afterId: 'c2' })
  await client.createStage({ name: 'S', position: 'bottom' })
  await client.updateBrandKit('bk1', { beforeId: 'bk2' })
  await client.updateBrandKit('bk1', { sections: [{ key: 'about', afterId: 's2' }] })
  await client.updateAvatar('av1', { position: 'top' })
  await client.updateTrackedAccount('ta1', { afterId: 'ta2' })
  await client.updateFolder('f1', { moveItem: { item: { mediaId: 'm1' }, after: { cardId: 'c1' } } })
  await client.createTemplate({ name: 'N', category: 'c', code: 'x', position: 'top' })
  await client.updateTemplate('t1', { beforeId: 't2' })
  const sent = calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname} ${c.init?.body}`)
  assert.deepEqual(sent, [
    'POST /api/v1/cards {"title":"T","platform":"youtube","position":"top"}',
    'PATCH /api/v1/cards/c1 {"stage":"Review","afterId":"c2"}',
    'POST /api/v1/stages {"name":"S","position":"bottom"}',
    'PATCH /api/v1/brand-kits/bk1 {"beforeId":"bk2"}',
    'PATCH /api/v1/brand-kits/bk1 {"sections":[{"key":"about","afterId":"s2"}]}',
    'PATCH /api/v1/avatars/av1 {"position":"top"}',
    'PATCH /api/v1/accounts/ta1 {"afterId":"ta2"}',
    'PATCH /api/v1/library/folders/f1 {"moveItem":{"item":{"mediaId":"m1"},"after":{"cardId":"c1"}}}',
    'POST /api/v1/templates {"name":"N","category":"c","code":"x","position":"top"}',
    'PATCH /api/v1/templates/t1 {"beforeId":"t2"}',
  ])
  // The whole-list reorder is retired: no method sends orderedIds.
  assert.equal('reorderBrandKits' in client, false)
})
