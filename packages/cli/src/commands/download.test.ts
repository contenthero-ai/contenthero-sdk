import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveFiles, savedName } from '../save-files.js'

/** A response whose body arrives in chunks, as a save link streams it. */
function streamed(chunks: string[], headers: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers })
}

const scratch = () => mkdtempSync(join(tmpdir(), 'ch-download-'))

test('one file is written to the path named, streamed whole', async () => {
  const dir = scratch()
  const target = join(dir, 'clip.mp4')
  const saved = await saveFiles([{ name: 'cat', url: 'https://app/api/media/k?download=cat' }], target, async () => streamed(['ab', 'cd'], { 'content-type': 'video/mp4' }))
  assert.equal(saved[0]?.path, target)
  assert.equal(saved[0]?.bytes, 4)
  assert.equal(readFileSync(target, 'utf8'), 'abcd')
  assert.deepEqual(readdirSync(dir), ['clip.mp4'], 'no partial file is left beside it')
})

test('several files go into the directory named, under the names the links give', async () => {
  const dir = join(scratch(), 'out')
  const responses = [
    streamed(['1'], { 'content-disposition': `attachment; filename="cat-1.png"; filename*=UTF-8''cat%20one.png`, 'content-type': 'image/png' }),
    streamed(['22'], { 'content-type': 'image/jpeg' }),
  ]
  const saved = await saveFiles(
    [
      { mediaId: 'Abc12345-1', name: 'cat-1', url: 'https://app/1' },
      { mediaId: 'Abc12345-2', name: 'cat-2', url: 'https://app/2' },
    ],
    dir,
    async () => responses.shift() as Response,
  )
  assert.deepEqual(saved.map((f) => f.name), ['cat one.png', 'cat-2.jpg'])
  assert.deepEqual(readdirSync(dir).sort(), ['cat one.png', 'cat-2.jpg'])
  assert.equal(saved[0]?.mediaId, 'Abc12345-1')
})

test('several files refuse a target that is a file', async () => {
  const file = join(scratch(), 'taken')
  writeFileSync(file, 'x')
  await assert.rejects(
    saveFiles([{ name: 'a', url: 'https://app/a' }, { name: 'b', url: 'https://app/b' }], file, async () => streamed(['x'])),
    /is a file, and this id names 2 files/,
  )
})

test('a failed link leaves nothing behind and says which file', async () => {
  const dir = scratch()
  await assert.rejects(
    saveFiles([{ name: 'cat', url: 'https://app/x' }], dir, async () => new Response('gone', { status: 404 })),
    /cat could not be downloaded \(HTTP 404\)/,
  )
  assert.deepEqual(readdirSync(dir), [])
})

test('a saved name is a bare file name, never a path', () => {
  const r = new Response(null, { headers: { 'content-disposition': 'attachment; filename="../../etc/passwd"' } })
  assert.equal(savedName({ name: 'x', url: 'https://app/x' }, r), 'passwd')
  assert.equal(savedName({ name: 'clip', url: 'https://cdn/a/clip.webm' }, new Response(null)), 'clip.webm')
})
