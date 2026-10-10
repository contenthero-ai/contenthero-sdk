/**
 * A wait never runs past its deadline, and hands back what it last read.
 *
 * ## The defect this encodes (7.49, 2026-10-05)
 *
 * `waitForGeneration` checked its deadline only after each status read, then paused a full interval, and the read
 * itself had no limit. A 50 second wait could run past a minute, and the MCP's status tool, which waited and then read
 * again for the current status, went past its host's 60 second ceiling. The wait now cuts a read still in flight at
 * the deadline, shortens its last pause to fit, and its timeout error carries the last status read, so no second read
 * is needed.
 *
 * ## Break-verified
 *
 * Reading without the deadline's signal turns case 1 red; pausing a full interval turns case 2 red; dropping the last
 * status from the error turns case 3 red; letting one failure throw out of `waitForStatus` turns case 4 red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero } from './client.js'
import { GenerationFailedError, GenerationTimeoutError } from './errors.js'
import type { FetchLike } from './client.js'

const processing = (outputId: string) => ({
  outputId, appUrl: 'https://app/x', status: 'processing', contentType: 'image', modelId: 'm',
  outputs: [{ mediaId: 'Abc12345-1', status: 'succeeded', url: 'https://cdn/1.png', appUrl: 'https://app/1' }],
  error: null, createdAt: 't', completedAt: null,
})

/** A job status as `GET /api/v1/status/{id}` answers it; a generation's wait reads the same route. */
const status = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  kind: 'output', id, state, reason: null, appUrl: 'https://app/x', progress: null, detail: processing(id), ...extra,
})

/** The id a status read named: the last path segment, without the query. */
const idOf = (url: string) => (url.split('/').pop() as string).split('?')[0] as string

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** A fetch that answers the first `answered` reads, then hangs until aborted. */
function hangsAfter(answered: number, body: (url: string) => unknown): FetchLike {
  let reads = 0
  return (url, init) => {
    reads++
    if (reads <= answered) return Promise.resolve(json(body(url)))
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }
}

test('1. a status read still in flight at the deadline is cut, and the wait ends on time', async () => {
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: hangsAfter(1, () => status('g1', 'processing')), baseUrl: 'https://x.test' })
  const started = Date.now()
  await assert.rejects(client.waitForGeneration('g1', { timeoutMs: 300, pollIntervalMs: 50 }), GenerationTimeoutError)
  assert.ok(Date.now() - started < 600, `took ${Date.now() - started}ms against a 300ms deadline`)
})

test('2. the last pause is shortened to fit, never a full interval past the deadline', async () => {
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: async () => json(status('g2', 'processing')), baseUrl: 'https://x.test' })
  const started = Date.now()
  await assert.rejects(client.waitForGeneration('g2', { timeoutMs: 200, pollIntervalMs: 5_000 }), GenerationTimeoutError)
  assert.ok(Date.now() - started < 1_000, `took ${Date.now() - started}ms against a 200ms deadline and a 5s interval`)
})

test('3. the timeout carries the last status read, and every read is reported', async () => {
  const seen: string[] = []
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: async () => json(status('g3', 'processing')), baseUrl: 'https://x.test' })
  const err = await client
    .waitForGeneration('g3', { timeoutMs: 150, pollIntervalMs: 40, onPoll: (g) => seen.push(g.status) })
    .then(() => null, (e: unknown) => e)
  assert.ok(err instanceof GenerationTimeoutError)
  assert.equal(err.lastStatus?.outputs[0]?.mediaId, 'Abc12345-1')
  assert.ok(seen.length >= 2 && seen.every((s) => s === 'processing'))
})

test('4. waitForStatus hands back every job: completed, failed, or as last read, under one deadline', async () => {
  const bodies: Record<string, unknown> = {
    done: status('done', 'completed', { kind: 'export', progress: 1, detail: { exportId: 'done', status: 'completed' } }),
    bad: status('bad', 'failed', { reason: 'provider error' }),
    slow: status('slow', 'processing', { kind: 'brand_kit', steps: [{ name: 'website', state: 'completed', reason: null }, { name: 'analysis', state: 'processing', reason: null }] }),
  }
  const reads: Record<string, number> = {}
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    const id = idOf(url)
    reads[id] = (reads[id] ?? 0) + 1
    return json(bodies[id])
  }
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://x.test' })
  const started = Date.now()
  const got = await client.waitForStatus(['done', { id: 'bad', kind: 'output' }, 'slow'], { timeoutMs: 150, pollIntervalMs: 40 })
  assert.ok(Date.now() - started < 600, 'one deadline for every target')
  assert.deepEqual(got.map((s) => [s.id, s.kind, s.state]), [['done', 'export', 'completed'], ['bad', 'output', 'failed'], ['slow', 'brand_kit', 'processing']])
  // From what the wait already read: no second read for a finished one.
  assert.equal(reads.done, 1)
  assert.equal(reads.bad, 1)
  assert.ok(reads.slow >= 2)
  // The kind travels only where the caller named it.
  assert.ok(urls.includes('https://x.test/api/v1/status/bad?kind=output'))
  assert.ok(urls.includes('https://x.test/api/v1/status/done'))
})

test('5. getStatus reads one job at once, by id alone or with its kind', async () => {
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    return json(status('Med12345', 'completed', { kind: 'transcript', detail: { status: 'ready', mediaId: 'Med12345' } }))
  }
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://x.test' })
  const s = await client.getStatus('Med12345', { kind: 'transcript' })
  assert.equal(urls[0], 'https://x.test/api/v1/status/Med12345?kind=transcript')
  assert.equal(s.kind, 'transcript')
  if (s.kind === 'transcript') assert.equal(s.detail.mediaId, 'Med12345')
  await client.getStatus('Abc12345-2')
  assert.equal(urls[1], 'https://x.test/api/v1/status/Abc12345-2')
})

test('6. waitForGeneration reads the status route as an output and keeps its own errors', async () => {
  const failed: FetchLike = async () => json(status('g6', 'failed', { reason: 'provider error', detail: { ...processing('g6'), status: 'failed', error: 'provider error' } }))
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: failed, baseUrl: 'https://x.test' })
  await assert.rejects(client.waitForGeneration('g6', { pollIntervalMs: 10 }), (e: unknown) => e instanceof GenerationFailedError && e.outputId === 'g6' && /provider error/.test(e.message))
  // An abandoned output is terminal without being a failure, whichever state the server files it under.
  const abandoned: FetchLike = async () => json(status('g7', 'failed', { detail: { ...processing('g7'), status: 'abandoned' } }))
  const gen = await new ContentHero({ apiKey: 'ch_live_test', fetch: abandoned, baseUrl: 'https://x.test' }).waitForGeneration('g7', { pollIntervalMs: 10 })
  assert.equal(gen.status, 'abandoned')
})
