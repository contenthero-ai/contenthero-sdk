import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LiveContextResult } from '@contenthero/sdk'
import { buildProgram } from '../program.js'
import { contextSummary } from './context.js'

/**
 * `context --render` reads the same as the MCP's get_context: a render comes back with no live tab (it works from the
 * saved project), and a render that produced no image says why.
 *
 * Break-verified: restoring `if (!c || !result.participant)` turns the first three red (each has no live tab);
 * dropping the failure line turns the second and third red; dropping the warnings line turns the fourth red; dropping
 * the `render && failure` branch from `--save` turns the fifth red (it blamed a missing snapshot instead).
 */

const noTab = (rendered: Record<string, unknown>): LiveContextResult => ({ context: { rendered }, participant: null, participants: [] })
const nothingSaved = { count: 0, path: '' }

test('a render with no live tab is shown, not reported as no context', () => {
  const out = contextSummary(noTab({ mode: 'image', frame: 12, dataUrl: 'data:image/webp;base64,AQID' }), nothingSaved)
  assert.match(out, /the render is from the saved project/)
  assert.doesNotMatch(out, /No live context/)
})

test('a render that produced no image says why', () => {
  const out = contextSummary(
    noTab({ mode: 'image', error: { code: 'render_unavailable', message: 'Rendering is unavailable right now.' } }),
    nothingSaved,
  )
  assert.match(out, /The render produced no image\. render_unavailable: Rendering is unavailable right now\./)
})

test('the frames of a range that did not render are named', () => {
  const out = contextSummary(
    noTab({ mode: 'image', frames: [], missingFrames: [30, 60], error: { code: 'render_failed', message: 'Lambda timed out' } }),
    nothingSaved,
  )
  assert.match(out, /2 frames could not be rendered \(frames 30, 60\)\. render_failed: Lambda timed out/)
})

let body: unknown = {}
let server: Server
let baseUrl = ''

before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

test("a render's graphic warnings are printed with where they are", () => {
  const out = contextSummary(
    noTab({
      mode: 'image',
      frame: 12,
      dataUrl: 'data:image/webp;base64,AQID',
      warnings: [{ itemId: 'g1', severity: 'warning', code: 'interpolate-repaired', message: 'interpolate was given keyframes out of order (30, 0)' }],
    }),
    nothingSaved,
  )
  assert.match(out, /Graphic warnings:\n  - graphic g1: warning \(interpolate-repaired\): interpolate was given keyframes out of order \(30, 0\)/)
})

test('--save with a failed render reports the render, not a missing snapshot', async () => {
  body = noTab({ mode: 'image', error: { code: 'render_failed', message: 'Lambda timed out' } })
  const path = join(mkdtempSync(join(tmpdir(), 'ch-context-')), 'still.webp')
  const failure = await buildProgram()
    .parseAsync(['--api-key', 'k', '--base-url', baseUrl, 'context', '--project', 'p1', '--render', '--save', path], { from: 'user' })
    .then(() => null, (err: Error) => err)
  assert.ok(failure, 'expected the command to fail')
  assert.match(failure.message, /render_failed: Lambda timed out/)
})
