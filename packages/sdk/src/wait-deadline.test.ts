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
 * status from the error turns case 3 red; letting one failure throw out of `waitForGenerations` turns case 4 red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero } from './client.js'
import { GenerationTimeoutError } from './errors.js'
import type { FetchLike } from './client.js'

const processing = (outputId: string) => ({
  outputId, appUrl: 'https://app/x', status: 'processing', contentType: 'image', modelId: 'm',
  outputs: [{ mediaId: 'Abc12345-1', status: 'succeeded', url: 'https://cdn/1.png', appUrl: 'https://app/1' }],
  error: null, createdAt: 't', completedAt: null,
})

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
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: hangsAfter(1, () => processing('g1')), baseUrl: 'https://x.test' })
  const started = Date.now()
  await assert.rejects(client.waitForGeneration('g1', { timeoutMs: 300, pollIntervalMs: 50 }), GenerationTimeoutError)
  assert.ok(Date.now() - started < 600, `took ${Date.now() - started}ms against a 300ms deadline`)
})

test('2. the last pause is shortened to fit, never a full interval past the deadline', async () => {
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: async () => json(processing('g2')), baseUrl: 'https://x.test' })
  const started = Date.now()
  await assert.rejects(client.waitForGeneration('g2', { timeoutMs: 200, pollIntervalMs: 5_000 }), GenerationTimeoutError)
  assert.ok(Date.now() - started < 1_000, `took ${Date.now() - started}ms against a 200ms deadline and a 5s interval`)
})

test('3. the timeout carries the last status read, and every read is reported', async () => {
  const seen: string[] = []
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch: async () => json(processing('g3')), baseUrl: 'https://x.test' })
  const err = await client
    .waitForGeneration('g3', { timeoutMs: 150, pollIntervalMs: 40, onPoll: (g) => seen.push(g.status) })
    .then(() => null, (e: unknown) => e)
  assert.ok(err instanceof GenerationTimeoutError)
  assert.equal(err.lastStatus?.outputs[0]?.mediaId, 'Abc12345-1')
  assert.ok(seen.length >= 2 && seen.every((s) => s === 'processing'))
})

test('4. waitForGenerations hands back every generation: settled, failed, or as last read', async () => {
  const bodies: Record<string, unknown> = {
    done: { ...processing('done'), status: 'completed', completedAt: 't2' },
    bad: { ...processing('bad'), status: 'failed', error: 'provider error', outputs: [] },
    slow: processing('slow'),
  }
  const reads: Record<string, number> = {}
  const fetch: FetchLike = async (url) => {
    const id = url.split('/').pop() as string
    reads[id] = (reads[id] ?? 0) + 1
    return json(bodies[id])
  }
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://x.test' })
  const gens = await client.waitForGenerations(['done', 'bad', 'slow'], { timeoutMs: 150, pollIntervalMs: 40 })
  assert.deepEqual(gens.map((g) => [g.outputId, g.status]), [['done', 'completed'], ['bad', 'failed'], ['slow', 'processing']])
  // From what the wait already read: no second read for a settled or failed one.
  assert.equal(reads.done, 1)
  assert.equal(reads.bad, 1)
})
