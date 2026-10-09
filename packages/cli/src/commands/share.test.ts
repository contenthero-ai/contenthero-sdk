import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * `project share` and `media share` reach their routes with the bodies the API reads, and print the link.
 *
 * Run as real processes under --human against a local server that records each request.
 * Break-verified: sending `shared: true` for a plain `project share` turns the first red; dropping `--off` turns the
 * second red; sending the media ids as one string turns the third red; dropping `--off` or `--link` from `media share`
 * turns the fourth red.
 */

const run = promisify(execFile)
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')
let body: unknown = {}
const requests: Array<{ method: string; url: string; body: unknown }> = []
let server: Server
let baseUrl = ''

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function cli(...args: string[]): Promise<string> {
  requests.length = 0
  const { stdout } = await run(process.execPath, ['--import', 'tsx', entry, '--human', '--api-key', 'k', '--base-url', baseUrl, ...args], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  return stdout
}

test('project share makes the link and prints it', async () => {
  body = { shared: true, shareUrl: 'https://share.example/t' }
  const out = await cli('project', 'share', 'p1')
  assert.deepEqual(requests, [{ method: 'POST', url: '/api/v1/projects/p1/share', body: {} }])
  assert.match(out, /https:\/\/share\.example\/t/)
})

test('project share --off revokes it', async () => {
  body = { shared: false, shareUrl: null }
  await cli('project', 'share', 'p1', '--off')
  assert.deepEqual(requests[0]?.body, { shared: false })
})

test('media share sends every media id and names any left out', async () => {
  body = { shared: true, shareUrl: 'https://pages.example/s', mediaIds: ['m-1'] }
  const out = await cli('media', 'share', 'm-1', 'm-2', '--title', 'Set')
  assert.deepEqual(requests, [{ method: 'POST', url: '/api/v1/media/share', body: { mediaIds: ['m-1', 'm-2'], title: 'Set' } }])
  assert.match(out, /https:\/\/pages\.example\/s/)
  assert.match(out, /m-2/)
})

test('media share --off stops a share by one media id or by its link', async () => {
  body = { shared: false, shareUrl: null, mediaIds: [] }
  const byId = await cli('media', 'share', 'm-1', '--off')
  assert.deepEqual(requests[0]?.body, { mediaIds: ['m-1'], shared: false })
  assert.match(byId, /Stopped sharing/)
  await cli('media', 'share', '--off', '--link', 'https://pages.example/s')
  assert.deepEqual(requests[0]?.body, { shared: false, shareUrl: 'https://pages.example/s' })
})
