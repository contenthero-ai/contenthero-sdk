import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * `project exports` reads a project's exports a page at a time and prints each one's share page.
 *
 * Run as a real process under --human against a local server that records each request.
 * Break-verified: dropping the page flags turns it red; printing no share page turns it red.
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

test('project exports reads a page and prints each share page', async () => {
  body = {
    exports: [{ exportId: 'e1', status: 'completed', exportType: 'video', title: 'Cut', createdAt: '2026-10-09', shareUrl: 'https://pages.example/e1' }],
    nextCursor: 'n',
  }
  const out = await cli('project', 'exports', 'p1', '--limit', '5', '--cursor', 'c')
  assert.equal(requests[0]?.method, 'GET')
  const url = new URL(requests[0]!.url, 'http://x')
  assert.equal(url.pathname, '/api/v1/projects/p1/exports')
  assert.equal(url.searchParams.get('limit'), '5')
  assert.equal(url.searchParams.get('cursor'), 'c')
  assert.match(out, /https:\/\/pages\.example\/e1/)
})

test("export-status and a waited export print how the export's loudness came out; the project prints its own", async () => {
  const loudness = { target: -16, outcome: 'leveled', gainDb: 2, peakReductionDb: null, deliveredLufs: -16, deliveredTruePeakDbtp: -1.5, summary: 'Leveled to the project loudness.' }
  body = { exportId: 'e1', status: 'completed', outputUrl: 'https://files.example/e1.mp4', shareUrl: 'https://pages.example/e1', loudness }
  const polled = await cli('project', 'export-status', 'e1')
  assert.match(polled, /completed: https:\/\/files\.example\/e1\.mp4\nShare page: https:\/\/pages\.example\/e1\nLeveled to the project loudness\./)
  const started = await cli('project', 'export', 'p1', '--loudness', '-16')
  assert.deepEqual(requests[0]?.body, { loudness: -16 })
  assert.match(started, /\nLeveled to the project loudness\./)
  body = { exportId: 'e2', status: 'completed', outputUrl: 'https://files.example/e2.png', loudness: null }
  assert.doesNotMatch(await cli('project', 'export-status', 'e2'), /loudness/i)
  // The project's settings print with the project: `project get` reads them, `project update` changes them.
  body = { project: { id: 'p1', title: 'Cut', type: 'editor', revision: 3, state: {}, groups: [], fps: 30, loudness: 'off', magneticTrack: false, linkage: true, linkedTracks: { media: true, audio: false, text: true } } }
  const read = await cli('project', 'get', 'p1')
  assert.match(read, /Delivery loudness: off/)
  assert.match(read, /Editing: magnetic main track off, linkage on, reaching media, text tracks/)
  const updated = await cli('project', 'update', 'p1', '--loudness', 'off')
  assert.deepEqual(requests[0]?.body, { loudness: 'off' })
  assert.match(updated, /Delivery loudness: off/)
})
