import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadedHuman } from './upload.js'

// An upload reads back with the name it was given, as the library lists it (phase 5 item 7: upload file names on
// every surface); an older server that sends none prints no Name row rather than an empty one.
test('an upload prints the name it was given', () => {
  const base = { outputId: 'o1', shortId: 'Abc12345', url: 'https://media.test/o1.png', kind: 'image', boardType: null, appUrl: 'https://app.test/media/Abc12345' }
  assert.match(uploadedHuman({ ...base, fileName: 'logo-final.png' } as never), /Name:\s+logo-final\.png/)
  assert.doesNotMatch(uploadedHuman(base as never), /Name:/)
})

// The command itself, against a local server that plays the API and the store.
import { before, after } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../program.js'

type Seen = { method: string; path: string; body: Record<string, unknown> | null; bytes: number; headers: Record<string, string | string[] | undefined> }
let server: Server
let baseUrl = ''
const seen: Seen[] = []
const PART_SIZE = 4
/** Parts the fake store already holds for a resumed upload, and a part whose PUT it refuses. */
let held: Array<{ partNumber: number; etag: string; sizeBytes: number }> = []
let refusePart: number | null = null

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const buf = Buffer.concat(chunks)
      const path = new URL(req.url ?? '/', 'http://x').pathname
      const isStore = path.startsWith('/store/')
      seen.push({ method: req.method ?? '', path, body: !isStore && buf.length ? JSON.parse(buf.toString()) : null, bytes: isStore ? buf.length : 0, headers: req.headers })
      res.setHeader('content-type', 'application/json')
      if (isStore && refusePart !== null && path === `/store/part-${refusePart}`) {
        res.statusCode = 400
        res.end('refused')
      } else if (isStore) {
        res.setHeader('etag', `"etag-${path.split('/').pop()}"`)
        res.end('')
      } else if (path === '/api/v1/media/uploads') {
        const size = (JSON.parse(buf.toString()) as { sizeBytes: number }).sizeBytes
        res.end(
          JSON.stringify(
            size > PART_SIZE
              ? { outputId: 'o-multi', upload: { mode: 'multipart', partSize: PART_SIZE, partCount: Math.ceil(size / PART_SIZE), expiresAt: 'e' } }
              : { outputId: 'o-single', upload: { mode: 'single', url: `${baseUrl}/store/single`, headers: { 'Content-Type': 'text/plain' }, expiresAt: 'e' } },
          ),
        )
      } else if (path.endsWith('/parts') && req.method === 'GET') {
        res.end(JSON.stringify({ partCount: 3, partSize: PART_SIZE, uploaded: held }))
      } else if (path.endsWith('/parts')) {
        const nums = (JSON.parse(buf.toString()) as { partNumbers: number[] }).partNumbers
        res.end(JSON.stringify({ parts: nums.map((n) => ({ partNumber: n, url: `${baseUrl}/store/part-${n}`, headers: {} })) }))
      } else if (path.endsWith('/complete')) {
        const id = path.split('/')[4]
        res.end(JSON.stringify({ outputId: id, shortId: 'Abc12345', url: `https://media.test/${id}`, contentType: 'text/plain', fileName: 'x.txt', appUrl: 'https://app.test/m/Abc12345' }))
      } else {
        res.statusCode = 404
        res.end('{}')
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

function fileWith(name: string, content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ch-upload-')), name)
  writeFileSync(file, content)
  return file
}

async function run(...args: string[]): Promise<void> {
  seen.length = 0
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })
}
const api = () => seen.filter((s) => !s.path.startsWith('/store/')).map((s) => `${s.method} ${s.path}`)

test('upload of a small file begins with its size and type, sends one PUT and completes with no body', async () => {
  await run('upload', fileWith('x.txt', 'abc'))
  assert.deepEqual(api(), ['POST /api/v1/media/uploads', 'POST /api/v1/media/uploads/o-single/complete'])
  assert.deepEqual(seen[0]!.body, { fileName: 'x.txt', contentType: 'text/plain', sizeBytes: 3 })
  assert.equal(seen.find((s) => s.path === '/store/single')!.bytes, 3)
  assert.equal(seen.at(-1)!.body, null)
})

test('upload of a larger file signs and sends every part, then completes with the ETags in order', async () => {
  await run('upload', fileWith('big.txt', '0123456789'))
  const stored = seen.filter((s) => s.path.startsWith('/store/part-'))
  assert.deepEqual(stored.map((s) => s.bytes).sort(), [2, 4, 4])
  assert.deepEqual(seen.at(-1)!.body, { parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: `"etag-part-${n}"` })) })
})

test('--name and --content-type override what is read from the file', async () => {
  await run('upload', fileWith('x.bin', 'abc'), '--name', 'renamed.txt', '--content-type', 'text/plain')
  assert.deepEqual(seen[0]!.body, { fileName: 'renamed.txt', contentType: 'text/plain', sizeBytes: 3 })
})

test('--name with several files is refused before anything is sent', async () => {
  seen.length = 0
  await assert.rejects(
    buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'upload', fileWith('a.txt', 'a'), fileWith('b.txt', 'b'), '--name', 'n'], { from: 'user' }),
    /one file/,
  )
  assert.equal(seen.length, 0)
})

test('a file that cannot be read fails alone and names it; the others still upload', async () => {
  const good = fileWith('good.txt', 'abc')
  await assert.rejects(
    run('upload', '/definitely/not/here.txt', good),
    /1 of 2 files did not upload: \/definitely\/not\/here\.txt/,
  )
  assert.deepEqual(api(), ['POST /api/v1/media/uploads', 'POST /api/v1/media/uploads/o-single/complete'])
})

test('one unreadable file fails with its own message', async () => {
  await assert.rejects(run('upload', '/definitely/not/here.txt'), /Cannot read file: \/definitely\/not\/here\.txt/)
  assert.equal(seen.length, 0)
})

test('media upload is gone and upload is registered', () => {
  const names = buildProgram().commands.map((c) => c.name())
  assert.ok(names.includes('upload'))
  const media = buildProgram().commands.find((c) => c.name() === 'media')!
  assert.ok(!media.commands.some((c) => c.name() === 'upload'))
})

/** What the command writes to stderr while `fn` runs. */
async function stderrOf(fn: () => Promise<void>): Promise<{ text: string; error: unknown }> {
  const real = process.stderr.write.bind(process.stderr)
  let text = ''
  process.stderr.write = ((chunk: string | Uint8Array) => {
    text += String(chunk)
    return true
  }) as typeof process.stderr.write
  let error: unknown
  try {
    await fn()
  } catch (e) {
    error = e
  } finally {
    process.stderr.write = real
  }
  return { text, error }
}

test('upload --resume asks which parts are stored, sends only the missing ones and says how many were stored', async () => {
  held = [1, 2].map((n) => ({ partNumber: n, etag: `"held-${n}"`, sizeBytes: 4 }))
  const { text, error } = await stderrOf(() => run('upload', fileWith('big.txt', '0123456789'), '--resume', 'o-multi'))
  assert.equal(error, undefined)
  assert.deepEqual(api(), ['GET /api/v1/media/uploads/o-multi/parts', 'POST /api/v1/media/uploads/o-multi/parts', 'POST /api/v1/media/uploads/o-multi/complete'])
  assert.deepEqual(seen.filter((s) => s.path.startsWith('/store/')).map((s) => s.path), ['/store/part-3'])
  assert.deepEqual(seen.at(-1)!.body, { parts: [{ partNumber: 1, etag: '"held-1"' }, { partNumber: 2, etag: '"held-2"' }, { partNumber: 3, etag: '"etag-part-3"' }] })
  assert.match(text, /Resuming big\.txt \(.*\): 2 of 3 parts already stored/)
})

test('upload --resume refuses a file of another size and sends nothing', async () => {
  held = []
  const { error } = await stderrOf(() => run('upload', fileWith('small.txt', 'abc'), '--resume', 'o-multi'))
  assert.match(String((error as Error).message), /This file is 3 bytes, but upload o-multi was begun for a file of 9 to 12 bytes/)
  assert.deepEqual(api(), ['GET /api/v1/media/uploads/o-multi/parts'])
})

test('upload --resume goes with one file', async () => {
  seen.length = 0
  await assert.rejects(
    buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'upload', fileWith('a.txt', 'a'), fileWith('b.txt', 'b'), '--resume', 'o'], { from: 'user' }),
    /--resume goes with one file/,
  )
  assert.equal(seen.length, 0)
})

test('a fresh upload that stops midway keeps its session and prints the line that finishes it', async () => {
  refusePart = 3
  try {
    const file = fileWith('big.txt', '0123456789')
    const { text, error } = await stderrOf(() => run('upload', file, '--content-type', 'text/plain'))
    assert.ok(error)
    assert.ok(!api().some((r) => r.startsWith('DELETE')), 'the session was not ended')
    assert.ok(text.includes(`contenthero upload ${file} --resume o-multi`), text)
  } finally {
    refusePart = null
  }
})
