import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero, type FetchLike } from '@contenthero/sdk'
import { compact, references, runGeneration } from './generation.js'
import { EXIT } from './errors.js'
import type { Context } from './context.js'

test('compact drops undefined values only', () => {
  assert.deepEqual(compact({ a: 1, b: undefined, c: 0, d: '' }), { a: 1, c: 0, d: '' })
})

test('references builds an object from set parts, undefined when empty', () => {
  assert.deepEqual(references({ images: ['x'], startFrame: undefined }), { images: ['x'] })
  assert.equal(references({ startFrame: undefined }), undefined)
  assert.equal(references({}), undefined)
})

/** A ContentHero pointed at a fake fetch that routes on path + method. */
function fakeClient(routes: (path: string, method: string, body: unknown) => unknown): ContentHero {
  const fetchImpl: FetchLike = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const payload = routes(path, method, body)
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new ContentHero({ apiKey: 'ch_live_test', baseUrl: 'https://app.contenthero.ai', fetch: fetchImpl })
}

/** Run a body while capturing stdout, restoring it afterward. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  ;(process.stdout as { write: unknown }).write = (s: string) => {
    chunks.push(String(s))
    return true
  }
  try {
    await fn()
  } finally {
    ;(process.stdout as { write: unknown }).write = orig
  }
  return chunks.join('')
}

const jsonCtx: Context = { json: true, keySource: 'flag', apiKey: 'ch_live_test', baseUrl: undefined }

test('runGeneration --cost emits the estimate and submits nothing else', async () => {
  let submitted = false
  const client = fakeClient((path, method, body) => {
    assert.equal(path, '/api/v1/studio/generate')
    assert.equal(method, 'POST')
    if ((body as { getCost?: boolean }).getCost) {
      return { getCost: true, creditsEstimate: 7, modelId: 'm', contentType: 'image' }
    }
    submitted = true
    return { outputId: 'x', status: 'processing' }
  })
  const out = await capture(() =>
    runGeneration(client, jsonCtx, { modelId: 'm', contentType: 'image' }, { cost: true, wait: true, timeoutSec: 1 }),
  )
  assert.equal(submitted, false)
  assert.match(out, /"creditsEstimate": 7/)
})

test('runGeneration --no-wait emits the processing submission and does not poll', async () => {
  let polled = false
  const client = fakeClient((path, method) => {
    if (method === 'GET') polled = true
    return { outputId: 'abc', status: 'processing', creditsEstimate: 3 }
  })
  const out = await capture(() =>
    runGeneration(client, jsonCtx, { modelId: 'm', contentType: 'image' }, { cost: false, wait: false, timeoutSec: 1 }),
  )
  assert.equal(polled, false)
  assert.match(out, /"status": "processing"/)
  assert.match(out, /"outputId": "abc"/)
})

test('runGeneration wait-to-timeout emits a snapshot and sets exit 4', async () => {
  const client = fakeClient((path, method) => {
    if (method === 'POST') return { outputId: 'abc', status: 'processing' }
    // GET getGeneration: still processing, so the wait times out
    return {
      outputId: 'abc',
      status: 'processing',
      contentType: 'image',
      modelId: 'm',
      outputUrls: [],
      error: null,
      createdAt: 'now',
      completedAt: null,
    }
  })
  const prevExit = process.exitCode
  process.exitCode = 0
  try {
    const out = await capture(() =>
      // timeoutSec 0 makes waitForGeneration trip the deadline on the first poll
      runGeneration(client, jsonCtx, { modelId: 'm', contentType: 'image' }, { cost: false, wait: true, timeoutSec: 0 }),
    )
    assert.equal(process.exitCode, EXIT.TIMEOUT)
    assert.match(out, /"status": "processing"/)
  } finally {
    process.exitCode = prevExit
  }
})

test('runGeneration wait-to-complete emits the finished generation, exit unchanged', async () => {
  let polls = 0
  const client = fakeClient((path, method) => {
    if (method === 'POST') return { outputId: 'abc', status: 'processing' }
    polls += 1
    return {
      outputId: 'abc',
      status: 'completed',
      contentType: 'image',
      modelId: 'm',
      outputUrls: ['https://cdn/x.jpg'],
      error: null,
      createdAt: 'now',
      completedAt: 'now',
    }
  })
  const out = await capture(() =>
    runGeneration(client, jsonCtx, { modelId: 'm', contentType: 'image' }, { cost: false, wait: true, timeoutSec: 5 }),
  )
  assert.ok(polls >= 1)
  assert.match(out, /"status": "completed"/)
  assert.match(out, /x\.jpg/)
})
