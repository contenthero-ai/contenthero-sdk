import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentHero } from './client.js'
import { ContentHeroError } from './errors.js'
import type { FetchLike } from './client.js'
import { UploadFailedError } from './errors.js'
import type { CompletedUploadPart, UploadProgress } from './types.js'

/**
 * A fake server for the upload session contract: the API (create, parts, complete, abort) and the store (PUT of a
 * whole file or of a part). It records what it was asked, answers the way the app's routes do, and can be told to
 * fail a part's PUT or to answer slowly.
 */
interface FakeOptions {
  /** Files larger than this are begun as multipart, in parts of this size (the fake server's own choice). */
  partSize?: number
  /** Answer the create call in the older shape: top-level uploadUrl only. */
  olderAnswer?: { withHeaders: boolean }
  /** Fail a part's PUT: [partNumber, how many times, how]. */
  failPut?: Array<{ part: number; times: number; how: 'throw' | 500 | 403 | 400 }>
  /** Delay a part's PUT, in milliseconds. */
  delayPut?: Record<number, number>
  /** Fail signing a part with this status, always. */
  failSign?: number
  /** Leave the ETag off a part's answer. */
  noEtag?: boolean
  /** Fail the completion with this status this many times. */
  failComplete?: { status: number; times: number }
  /** Answer the parts listing with this status. */
  listStatus?: number
  /** The plan the listing states when this server never began the upload itself (a resume from a fresh process). */
  knownPlan?: { partSize: number; partCount: number }
}

function fakeServer(options: FakeOptions = {}) {
  const base = 'https://app.contenthero.ai'
  const log = {
    created: [] as Array<{ fileName: string; contentType: string; sizeBytes: number }>,
    signed: [] as number[][],
    puts: [] as Array<{ url: string; headers: Record<string, string>; bytes: Uint8Array }>,
    completed: [] as Array<{ outputId: string; body: unknown }>,
    aborted: [] as string[],
    listed: [] as string[],
    inFlight: 0,
    maxInFlight: 0,
    putOrder: [] as number[],
  }
  const failures = (options.failPut ?? []).map((f) => ({ ...f }))
  let signCount = 0
  let completeFailures = options.failComplete?.times ?? 0
  const etagOf = (part: number, bytes: Uint8Array) => `"etag-${part}-${bytes.reduce((a, b) => a + b, 0)}"`
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const stored = new Map<number, string>()
  const storedSizes = new Map<number, number>()
  let plan: { partSize: number; partCount: number } | undefined

  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body
    if (url === `${base}/api/v1/media/uploads` && method === 'POST') {
      const input = JSON.parse(body as string)
      log.created.push(input)
      if (options.olderAnswer) {
        return json(201, {
          outputId: 'out_1',
          uploadUrl: 'https://store.example/put',
          ...(options.olderAnswer.withHeaders ? { uploadHeaders: { 'Content-Type': input.contentType, 'x-amz-meta-user_id': 'u1' } } : {}),
          storagePath: 'a/b',
          expiresAt: 'later',
        })
      }
      if (options.partSize && input.sizeBytes > options.partSize) {
        plan = { partSize: options.partSize, partCount: Math.ceil(input.sizeBytes / options.partSize) }
        return json(201, {
          outputId: 'out_1',
          upload: { mode: 'multipart', partSize: options.partSize, partCount: Math.ceil(input.sizeBytes / options.partSize), expiresAt: 'later' },
        })
      }
      return json(201, {
        outputId: 'out_1',
        upload: { mode: 'single', url: 'https://store.example/put', headers: { 'Content-Type': input.contentType, 'x-amz-meta-user_id': 'u1' }, expiresAt: 'later' },
        uploadUrl: 'https://store.example/put',
        uploadHeaders: { 'Content-Type': input.contentType, 'x-amz-meta-user_id': 'u1' },
        storagePath: 'a/b',
        expiresAt: 'later',
      })
    }
    if (url.endsWith('/parts') && method === 'GET') {
      log.listed.push(decodeURIComponent(/uploads\/([^/]+)\/parts/.exec(url)![1]!))
      if (options.listStatus) return json(options.listStatus, { error: 'Refused.' })
      const p = plan ?? options.knownPlan!
      return json(200, {
        ...p,
        uploaded: [...stored.entries()].sort((a, b) => a[0] - b[0]).map(([partNumber, etag]) => ({ partNumber, etag, sizeBytes: storedSizes.get(partNumber)! })),
      })
    }
    if (url.endsWith('/parts') && method === 'POST') {
      const { partNumbers } = JSON.parse(body as string) as { partNumbers: number[] }
      log.signed.push(partNumbers)
      if (options.failSign) return json(options.failSign, { error: 'Not allowed.' })
      return json(200, {
        parts: partNumbers.map((n) => ({ partNumber: n, url: `https://store.example/part/${n}?sig=${++signCount}`, headers: {} })),
      })
    }
    if (url.startsWith('https://store.example/part/') && method === 'PUT') {
      const part = Number(/part\/(\d+)/.exec(url)![1])
      const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer())
      log.inFlight++
      log.maxInFlight = Math.max(log.maxInFlight, log.inFlight)
      try {
        const wait = options.delayPut?.[part]
        if (wait) await new Promise((r) => setTimeout(r, wait))
        const f = failures.find((x) => x.part === part && x.times > 0)
        if (f) {
          f.times--
          if (f.how === 'throw') throw new TypeError('fetch failed')
          return new Response('nope', { status: f.how })
        }
        log.puts.push({ url, headers: init?.headers as Record<string, string>, bytes })
        log.putOrder.push(part)
        const etag = etagOf(part, bytes)
        stored.set(part, etag)
        storedSizes.set(part, bytes.length)
        return new Response(null, { status: 200, headers: options.noEtag ? {} : { ETag: etag } })
      } finally {
        log.inFlight--
      }
    }
    if (url === 'https://store.example/put' && method === 'PUT') {
      const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer())
      log.puts.push({ url, headers: init?.headers as Record<string, string>, bytes })
      return new Response(null, { status: 200 })
    }
    if (url.endsWith('/complete') && method === 'POST') {
      const outputId = decodeURIComponent(/uploads\/([^/]+)\/complete/.exec(url)![1]!)
      if (completeFailures > 0) {
        completeFailures--
        return json(options.failComplete!.status, { error: 'Busy.' })
      }
      log.completed.push({ outputId, body: body === undefined ? undefined : JSON.parse(body as string) })
      return json(200, { outputId, shortId: 'Abc12345', url: 'https://media.example/x', appUrl: 'https://app/x', contentType: 'image' })
    }
    if (url.includes('/api/v1/media/uploads/') && method === 'DELETE') {
      log.aborted.push(decodeURIComponent(url.split('/').pop()!))
      return json(200, { aborted: true })
    }
    throw new Error(`unexpected request ${method} ${url}`)
  }
  return { fetch, log, stored, failures }
}

/** A file whose bytes tell their position, so a wrongly cut part is caught. */
function bytesOf(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * 7 + 1) % 251)
}

const opts = { fileName: 'a.png', contentType: 'image/png', retryDelayMs: 1 }

function joined(log: ReturnType<typeof fakeServer>['log']): Uint8Array {
  const byPart = new Map<number, Uint8Array>()
  for (const p of log.puts) byPart.set(Number(/part\/(\d+)/.exec(p.url)![1]), p.bytes)
  const all = [...byPart.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, b]) => [...b])
  return Uint8Array.from(all)
}

test('upload: a single target is one PUT with exactly the headers the server gave, then a bodyless completion', async () => {
  const server = fakeServer()
  const progress: UploadProgress[] = []
  const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
  const media = await ch.upload(new Blob([bytesOf(5)]), { ...opts, onProgress: (p) => progress.push(p) })

  assert.deepEqual(server.log.created, [{ fileName: 'a.png', contentType: 'image/png', sizeBytes: 5 }])
  assert.equal(server.log.puts.length, 1)
  assert.deepEqual(server.log.puts[0]!.headers, { 'Content-Type': 'image/png', 'x-amz-meta-user_id': 'u1' })
  assert.deepEqual([...server.log.puts[0]!.bytes], [...bytesOf(5)])
  assert.deepEqual(server.log.completed, [{ outputId: 'out_1', body: undefined }])
  assert.equal(media.outputId, 'out_1')
  assert.deepEqual(progress.map((p) => p.uploadedBytes), [0, 5])
  assert.ok(progress.every((p) => p.outputId === 'out_1' && p.totalBytes === 5))
})

test('upload: a multipart target sends the parts the server planned, sliced exactly, for every kind of input', async () => {
  const file = bytesOf(10)
  const inputs: Array<[string, Blob | ArrayBuffer | ArrayBufferView]> = [
    ['Blob', new Blob([file])],
    ['Uint8Array', file],
    ['ArrayBuffer', file.buffer.slice(0) as ArrayBuffer],
    // A Buffer is a view into a larger pool: its offset must be honored.
    ['Buffer with an offset', Buffer.concat([Buffer.from([9, 9, 9]), Buffer.from(file)]).subarray(3)],
  ]
  for (const [name, data] of inputs) {
    const server = fakeServer({ partSize: 4 })
    const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
    await ch.upload(data, opts)
    assert.deepEqual([...joined(server.log)], [...file], `${name}: the parts add up to the file`)
    assert.deepEqual(server.log.puts.map((p) => p.bytes.length).sort(), [2, 4, 4], `${name}: the last part is the remainder`)
  }
})

test('upload: the completion carries every part with the ETag the store answered, in part order, whatever order they finished', async () => {
  // Part 1 answers last, so the parts finish 2, 3, 1.
  const server = fakeServer({ partSize: 4, delayPut: { 1: 40 } })
  const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
  await ch.upload(bytesOf(10), { ...opts, concurrency: 3 })

  assert.deepEqual(server.log.putOrder, [2, 3, 1], 'the parts did finish out of order')
  const body = server.log.completed[0]!.body as { parts: CompletedUploadPart[] }
  assert.deepEqual(body.parts.map((p) => p.partNumber), [1, 2, 3])
  for (const p of body.parts) assert.equal(p.etag, server.stored.get(p.partNumber), `part ${p.partNumber} carries its own etag`)
})

test('upload: parts are sent at most `concurrency` at a time, and that many at once', async () => {
  const delays = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 15]))
  const server = fakeServer({ partSize: 1, delayPut: delays })
  const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
  await ch.upload(bytesOf(10), { ...opts, concurrency: 3 })
  assert.equal(server.log.maxInFlight, 3)
  assert.equal(server.log.puts.length, 10)
})

test('upload: each part is signed alone, just before it is sent', async () => {
  const server = fakeServer({ partSize: 4 })
  await new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), { ...opts, concurrency: 1 })
  assert.deepEqual(server.log.signed, [[1], [2], [3]])
})

test('upload: a part that fails is signed again and sent again, and the others are not repeated', async () => {
  for (const how of ['throw', 500, 403] as const) {
    const server = fakeServer({ partSize: 4, failPut: [{ part: 2, times: 2, how }] })
    const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
    await ch.upload(bytesOf(10), { ...opts, concurrency: 1 })
    assert.deepEqual(server.log.signed.flat(), [1, 2, 2, 2, 3], `${how}: part 2 asked for a fresh URL on each try`)
    assert.deepEqual([...joined(server.log)], [...bytesOf(10)])
    assert.equal(server.log.aborted.length, 0)
  }
})

test('upload: a part that keeps failing fails the upload after the tries, and aborts it at the server', async () => {
  const server = fakeServer({ partSize: 4, failPut: [{ part: 2, times: 99, how: 500 }] })
  const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
  const events: string[] = []
  ch.observeResponses((e) => events.push(e.type))
  await assert.rejects(
    () => ch.upload(bytesOf(10), { ...opts, concurrency: 1, attempts: 3 }),
    (err: unknown) => err instanceof ContentHeroError && err.status === 500 && /Upload PUT failed/.test(err.message),
  )
  assert.equal(server.log.signed.flat().filter((n) => n === 2).length, 3, 'three tries, no more')
  assert.deepEqual(server.log.aborted, ['out_1'])
  assert.equal(server.log.completed.length, 0)
  assert.ok(events.includes('failed'), 'response listeners hear the failure')
})

test('upload: a refusal that retrying cannot fix is not retried, and aborts', async () => {
  const bad = fakeServer({ partSize: 4, failPut: [{ part: 1, times: 99, how: 400 }] })
  await assert.rejects(() => new ContentHero({ apiKey: 'k', fetch: bad.fetch }).upload(bytesOf(10), { ...opts, concurrency: 1 }))
  assert.equal(bad.log.signed.flat().filter((n) => n === 1).length, 1)
  assert.deepEqual(bad.log.aborted, ['out_1'])

  const denied = fakeServer({ partSize: 4, failSign: 403 })
  await assert.rejects(() => new ContentHero({ apiKey: 'k', fetch: denied.fetch }).upload(bytesOf(10), { ...opts, concurrency: 1 }))
  assert.equal(denied.log.signed.length, 1, 'a key that may not upload is not asked again')
  assert.deepEqual(denied.log.aborted, ['out_1'])
})

test('upload: abortOnFailure false keeps the session', async () => {
  const server = fakeServer({ partSize: 4, failPut: [{ part: 2, times: 99, how: 400 }] })
  await assert.rejects(() => new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), { ...opts, abortOnFailure: false }))
  assert.deepEqual(server.log.aborted, [])
})

test('upload: a part answered without an ETag fails with what to do', async () => {
  const server = fakeServer({ partSize: 4, noEtag: true })
  await assert.rejects(
    () => new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), opts),
    (err: unknown) => err instanceof ContentHeroError && /without an ETag/.test(err.message),
  )
  assert.deepEqual(server.log.aborted, ['out_1'])
})

test('upload: resume asks the server which parts are stored and sends only the missing ones, completing in part order', async () => {
  const file = bytesOf(10)
  // First run: part 3 never gets through, so the upload stops with parts 1 and 2 stored; the session is kept.
  const server = fakeServer({ partSize: 4, failPut: [{ part: 3, times: 99, how: 400 }] })
  let failure: unknown
  await new ContentHero({ apiKey: 'k', fetch: server.fetch })
    .upload(file, { ...opts, concurrency: 1, abortOnFailure: false })
    .catch((e) => (failure = e))
  assert.ok(failure instanceof UploadFailedError)
  assert.equal(failure.outputId, 'out_1')
  assert.equal(failure.resumable, true)
  assert.match(failure.message, /resume set to that id/)
  assert.deepEqual([...server.stored.keys()].sort(), [1, 2])

  // Second run, a fresh client holding nothing: only the output id. Nothing is begun, only part 3 is signed and sent.
  server.failures.length = 0
  server.log.signed.length = 0
  server.log.puts.length = 0
  const media = await new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(file, { ...opts, resume: 'out_1' })
  assert.equal(server.log.created.length, 1, 'no new upload was begun')
  assert.deepEqual(server.log.listed, ['out_1'])
  assert.deepEqual(server.log.signed, [[3]], 'only the missing part was asked for')
  assert.deepEqual(server.log.puts.map((p) => p.bytes.length), [2])
  assert.equal(media.outputId, 'out_1')
  const body = server.log.completed[0]!.body as { parts: CompletedUploadPart[] }
  assert.deepEqual(body.parts, [1, 2, 3].map((n) => ({ partNumber: n, etag: server.stored.get(n)! })))
})

test('upload: resume refuses a file that cannot be the one the upload was begun with, and touches nothing', async () => {
  const server = fakeServer({ knownPlan: { partSize: 4, partCount: 3 } })
  const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
  for (const size of [8, 13]) {
    await assert.rejects(
      () => ch.upload(bytesOf(size), { ...opts, resume: 'out_1' }),
      (err: unknown) =>
        err instanceof ContentHeroError &&
        !(err instanceof UploadFailedError) &&
        err.message.includes(`This file is ${size} bytes`) &&
        err.message.includes('9 to 12 bytes') &&
        /same file/.test(err.message),
    )
  }
  assert.deepEqual(server.log.aborted, [], 'the session was not ended')
  assert.deepEqual(server.log.signed, [])
  assert.equal(server.log.puts.length, 0)
})

test('upload: resume refuses a stored part whose size does not fit the file', async () => {
  // 10 bytes in parts of 4 are stored as 4, 4, 2; the completion then fails, so the session stays.
  const server = fakeServer({ partSize: 4, failComplete: { status: 400, times: 99 } })
  await new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), { ...opts, abortOnFailure: false }).catch(() => undefined)
  // A 12 byte file has the same plan (3 parts of 4) but its last part would hold 4 bytes, not the stored 2.
  server.log.puts.length = 0
  await assert.rejects(
    () => new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(12), { ...opts, resume: 'out_1' }),
    (err: unknown) => err instanceof ContentHeroError && /Part 3 of upload out_1 holds 2 bytes/.test(err.message),
  )
  assert.equal(server.log.puts.length, 0)
})

test('upload: a refusal of the listing is told as it is, and the session is left alone', async () => {
  for (const status of [404, 410, 400]) {
    const server = fakeServer({ listStatus: status })
    await assert.rejects(
      () => new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), { ...opts, resume: 'out_1' }),
      (err: unknown) => err instanceof ContentHeroError && err.status === status && !(err instanceof UploadFailedError),
    )
    assert.deepEqual(server.log.aborted, [])
  }
})

test('upload: a fresh upload that fails midway reports its output id, and says whether it can be resumed', async () => {
  const kept = fakeServer({ partSize: 4, failPut: [{ part: 2, times: 99, how: 400 }] })
  const keptErr = await new ContentHero({ apiKey: 'k', fetch: kept.fetch }).upload(bytesOf(10), { ...opts, abortOnFailure: false }).catch((e) => e)
  assert.ok(keptErr instanceof UploadFailedError)
  assert.equal(keptErr.outputId, 'out_1')
  assert.equal(keptErr.resumable, true)
  assert.equal(keptErr.status, 400)
  assert.deepEqual(kept.log.aborted, [])

  const ended = fakeServer({ partSize: 4, failPut: [{ part: 2, times: 99, how: 400 }] })
  const endedErr = await new ContentHero({ apiKey: 'k', fetch: ended.fetch }).upload(bytesOf(10), opts).catch((e) => e)
  assert.ok(endedErr instanceof UploadFailedError)
  assert.equal(endedErr.outputId, 'out_1')
  assert.equal(endedErr.resumable, false)
  assert.match(endedErr.message, /ended at the server/)
  assert.deepEqual(ended.log.aborted, ['out_1'])
})

test('upload: the signal cuts the upload and it is aborted', async () => {
  const server = fakeServer({ partSize: 4, delayPut: { 1: 30, 2: 30, 3: 30 } })
  const controller = new AbortController()
  const ch = new ContentHero({ apiKey: 'k', fetch: server.fetch })
  const run = ch.upload(bytesOf(10), { ...opts, concurrency: 1, signal: controller.signal, onProgress: (p) => p.part && controller.abort() })
  await assert.rejects(run)
  assert.deepEqual(server.log.aborted, ['out_1'])
  assert.equal(server.log.completed.length, 0)
})

test('upload: a plan that does not fit the file is refused before any bytes are sent', async () => {
  const fetch: FetchLike = async (url, init) => {
    if (url.endsWith('/api/v1/media/uploads') && init?.method === 'POST') {
      return new Response(JSON.stringify({ outputId: 'o', upload: { mode: 'multipart', partSize: 4, partCount: 1, expiresAt: 'x' } }), { status: 201 })
    }
    return new Response(JSON.stringify({ aborted: true }), { status: 200 })
  }
  await assert.rejects(
    () => new ContentHero({ apiKey: 'k', fetch }).upload(bytesOf(10), opts),
    (err: unknown) => err instanceof ContentHeroError && /do not fit each other/.test(err.message),
  )
})

test('upload: a completion that the server could not answer is tried again, since completing twice is safe', async () => {
  const server = fakeServer({ failComplete: { status: 503, times: 2 } })
  const media = await new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(3), opts)
  assert.equal(media.outputId, 'out_1')
  assert.equal(server.log.aborted.length, 0)
})

test('upload: an older answer with only the top-level uploadUrl is read as a single target', async () => {
  const withHeaders = fakeServer({ olderAnswer: { withHeaders: true } })
  await new ContentHero({ apiKey: 'k', fetch: withHeaders.fetch }).upload(bytesOf(3), opts)
  assert.deepEqual(withHeaders.log.puts[0]!.headers, { 'Content-Type': 'image/png', 'x-amz-meta-user_id': 'u1' })

  // An API from before the headers were returned needs the content type alone.
  const bare = fakeServer({ olderAnswer: { withHeaders: false } })
  await new ContentHero({ apiKey: 'k', fetch: bare.fetch }).upload(bytesOf(3), opts)
  assert.deepEqual(bare.log.puts[0]!.headers, { 'Content-Type': 'image/png' })
})

test('createUpload reads the new answer and ignores the deprecated fields beside it', async () => {
  const server = fakeServer()
  const created = await new ContentHero({ apiKey: 'k', fetch: server.fetch }).createUpload({ fileName: 'a.png', contentType: 'image/png', sizeBytes: 5 })
  assert.deepEqual(created, {
    outputId: 'out_1',
    upload: { mode: 'single', url: 'https://store.example/put', headers: { 'Content-Type': 'image/png', 'x-amz-meta-user_id': 'u1' }, expiresAt: 'later' },
  })
})

test('signUploadParts, completeUpload and abortUpload speak the routes of the contract', async () => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) })
    if (url.endsWith('/parts')) return new Response(JSON.stringify({ parts: [{ partNumber: 2, url: 'u', headers: {} }] }), { status: 200 })
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ aborted: true }), { status: 200 })
    return new Response(JSON.stringify({ outputId: 'o/1' }), { status: 200 })
  }
  const ch = new ContentHero({ apiKey: 'k', fetch, baseUrl: 'https://x.test' })
  assert.deepEqual(await ch.signUploadParts('o/1', [2]), [{ partNumber: 2, url: 'u', headers: {} }])
  await ch.completeUpload('o/1', [{ partNumber: 1, etag: '"e"' }])
  await ch.completeUpload('o/1')
  assert.deepEqual(await ch.abortUpload('o/1'), { aborted: true })
  assert.deepEqual(calls, [
    { url: 'https://x.test/api/v1/media/uploads/o%2F1/parts', method: 'POST', body: { partNumbers: [2] } },
    { url: 'https://x.test/api/v1/media/uploads/o%2F1/complete', method: 'POST', body: { parts: [{ partNumber: 1, etag: '"e"' }] } },
    { url: 'https://x.test/api/v1/media/uploads/o%2F1/complete', method: 'POST', body: undefined },
    { url: 'https://x.test/api/v1/media/uploads/o%2F1', method: 'DELETE', body: undefined },
  ])
})

test('listUploadParts reads the parts the store holds from the route of the contract', async () => {
  const seen: Array<[string, string | undefined]> = []
  const fetch: FetchLike = async (url, init) => {
    seen.push([url, init?.method])
    return new Response(JSON.stringify({ partCount: 3, partSize: 4, uploaded: [{ partNumber: 1, etag: '"a"', sizeBytes: 4 }] }), { status: 200 })
  }
  const listing = await new ContentHero({ apiKey: 'k', fetch }).listUploadParts('out 1')
  assert.deepEqual(seen, [['https://app.contenthero.ai/api/v1/media/uploads/out%201/parts', 'GET']])
  assert.deepEqual(listing, { partCount: 3, partSize: 4, uploaded: [{ partNumber: 1, etag: '"a"', sizeBytes: 4 }] })
})

test('upload: progress of a resumed upload names how many parts the store already holds', async () => {
  const server = fakeServer({ partSize: 4, failPut: [{ part: 3, times: 99, how: 400 }] })
  await new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), { ...opts, concurrency: 1, abortOnFailure: false }).catch(() => undefined)
  server.failures.length = 0
  const seen: UploadProgress[] = []
  await new ContentHero({ apiKey: 'k', fetch: server.fetch }).upload(bytesOf(10), { ...opts, resume: 'out_1', onProgress: (p) => seen.push(p) })
  assert.deepEqual([seen[0]!.storedParts, seen[0]!.partCount, seen[0]!.uploadedBytes], [2, 3, 8])
  assert.deepEqual([seen.at(-1)!.storedParts, seen.at(-1)!.uploadedBytes], [3, 10])
})
