/**
 * One contract for long work (connector gaps, group 2).
 *
 * - A job is over only when its status is `settled` or `failed`; `processing` and `applying` keep the wait going.
 * - One logical write carries ONE client id (`opId`, `outputId`) however many times it is sent, so a retry is a replay.
 * - `view` asks again after a busy answer's `retryAfterSeconds` within the caller's wait, and reads a pending render by
 *   its `renderId` instead of rendering again.
 *
 * ## Break-verified
 *
 * Treating `applying` as over turns case 1 red; minting a new id per attempt turns cases 2 and 3 red; sending an
 * `outputId` in place turns case 4 red; ignoring `retryAfterSeconds` turns case 5 red; starting a render for a pending
 * answer turns case 6 red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero } from './client.js'
import { GenerationFailedError } from './errors.js'
import type { FetchLike } from './client.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const client = (fetch: FetchLike) => new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://x.test' })

const generation = (outputId: string, state: string) => ({
  outputId, appUrl: 'https://app/x', status: state, contentType: 'image', modelId: 'm',
  outputs: [], error: state === 'failed' ? 'broke' : null, createdAt: 't', completedAt: null,
})
const job = (id: string, state: string) => ({
  kind: 'output', id, state, reason: state === 'failed' ? 'broke' : null, appUrl: 'https://app/x', progress: null, detail: generation(id, state),
})

test('1. a generation wait ends only on settled or failed, never on applying', async () => {
  const states = ['processing', 'applying', 'applying', 'settled']
  let reads = 0
  const fetch: FetchLike = async () => json(job('g1', states[Math.min(reads++, states.length - 1)] as string))
  const gen = await client(fetch).waitForGeneration('g1', { pollIntervalMs: 5 })
  assert.equal(gen.status, 'settled')
  assert.equal(reads, 4)

  const failing: FetchLike = async () => json(job('g2', 'failed'))
  await assert.rejects(client(failing).waitForGeneration('g2', { pollIntervalMs: 5 }), GenerationFailedError)
})

test('2. an editor op call keeps one opId across every retry, and two calls get two ids', async () => {
  const sent: Array<{ ops: Array<{ opId?: string }> }> = []
  let calls = 0
  const fetch: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)))
    if (++calls <= 2) return json({ error: 'upstream' }, 503)
    return json({ revision: 7, results: [] })
  }
  const c = client(fetch)
  await c.applyEditorOps({ projectId: 'p1', ops: [{ op: 'remove_clip', clipId: 'c1' } as never] })
  assert.equal(sent.length, 3)
  const ids = sent.map((b) => b.ops[0]?.opId)
  assert.ok(ids[0] && ids.every((id) => id === ids[0]), 'the same opId on the first attempt and each retry')

  await c.applyEditorOps({ projectId: 'p1', ops: [{ op: 'remove_clip', clipId: 'c1' } as never] })
  assert.notEqual(sent[3]?.ops[0]?.opId, ids[0], 'a second logical call is a new operation')
})

test('3. generate keeps one outputId across retries; a refusal (4xx) is final and not repeated', async () => {
  const sent: Array<{ outputId?: string }> = []
  let calls = 0
  const fetch: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)))
    if (++calls === 1) throw new TypeError('network down')
    return json({ outputId: sent[1]?.outputId, shortId: 'Gen12345', appUrl: 'https://app/x', status: 'processing', idempotentReplay: true })
  }
  const res = await client(fetch).generate({ modelId: 'm', prompt: 'a' })
  assert.equal(sent.length, 2)
  assert.ok(sent[0]?.outputId)
  assert.equal(sent[0]?.outputId, sent[1]?.outputId)
  assert.equal(res.idempotentReplay, true)

  let refused = 0
  const refusing: FetchLike = async () => { refused++; return json({ error: 'bad model' }, 400) }
  await assert.rejects(client(refusing).generate({ modelId: 'x', prompt: 'a' }))
  assert.equal(refused, 1)
})

test('4. edit_audio file mode carries an outputId; in place carries none', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return json({ status: 'processing', outputId: 'o1' })
  }
  const c = client(fetch)
  await c.editAudio({ mediaId: 'Med12345', operation: 'enhance' } as never)
  await c.editAudio({ projectId: 'p1', clipIds: ['c1'], operation: 'enhance' } as never)
  assert.ok(bodies[0]?.outputId, 'file mode names its output')
  assert.equal('outputId' in (bodies[1] ?? {}), false, 'in place needs no id')
})

test('5. view waits out a busy render within the caller wait, and returns the error untouched when the wait is spent', async () => {
  const busy = { rendered: { error: { code: 'render_busy', message: 'busy', retryAfterSeconds: 1 } } }
  const ready = { rendered: { status: 'ready', url: 'https://cdn/r.png' } }
  let calls = 0
  const waits: Array<string | null> = []
  const fetch: FetchLike = async (url) => {
    waits.push(new URL(url).searchParams.get('wait'))
    return json(++calls === 1 ? busy : ready)
  }
  const out = await client(fetch).view({ projectId: 'p1', render: true, wait: 5 })
  assert.equal(calls, 2)
  assert.deepEqual((out as { rendered: unknown }).rendered, ready.rendered)
  assert.ok(Number(waits[1]) < 5, 'the second ask carries only what is left of the wait')

  let again = 0
  const alwaysBusy: FetchLike = async () => { again++; return json(busy) }
  const spent = await client(alwaysBusy).view({ projectId: 'p1', render: true, wait: 0 })
  assert.equal(again, 1)
  assert.equal((spent as { rendered: { error: { retryAfterSeconds: number } } }).rendered.error.retryAfterSeconds, 1)
})

test('6. view continues a pending render by its renderId and never starts another render', async () => {
  const pending = { rendered: { status: 'pending', renderId: 'R1', readWith: { renderId: 'R1' } } }
  const ready = { rendered: { status: 'ready', url: 'https://cdn/r.png' } }
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    return json(urls.length === 1 ? pending : ready)
  }
  const out = await client(fetch).view({ projectId: 'p1', render: true, wait: 5 })
  assert.equal(urls.length, 2)
  assert.match(urls[1] as string, /renderId=R1/)
  assert.doesNotMatch(urls[1] as string, /render=true/)
  assert.deepEqual((out as { rendered: unknown }).rendered, ready.rendered)
})
