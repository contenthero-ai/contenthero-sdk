import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ViewResult } from '@contenthero/sdk'
import { buildProgram } from '../program.js'
import { viewSummary } from './view.js'

/**
 * `view --render` reads the same as the MCP's view: a render comes back with no live tab (it works from the
 * saved project), and a render that produced no image says why.
 *
 * Break-verified: restoring `if (!c || !result.participant)` turns the first three red (each has no live tab);
 * dropping the failure line turns the second and third red; dropping the warnings line turns the fourth red; dropping
 * the `render && failure` branch from `--save` turns the fifth red (it blamed a missing snapshot instead).
 */

const noTab = (rendered: Record<string, unknown>): ViewResult => ({ context: { rendered }, participant: null, participants: [] })
const nothingSaved = { count: 0, path: '' }

test('a render with no live tab is shown, not reported as no context', () => {
  const out = viewSummary(noTab({ mode: 'image', frame: 12, dataUrl: 'data:image/webp;base64,AQID' }), nothingSaved)
  assert.match(out, /the render is from the saved project/)
  assert.doesNotMatch(out, /No live context/)
})

test('a render that produced no image says why', () => {
  const out = viewSummary(
    noTab({ mode: 'image', error: { code: 'render_unavailable', message: 'Rendering is unavailable right now.' } }),
    nothingSaved,
  )
  assert.match(out, /The render produced no image\. render_unavailable: Rendering is unavailable right now\./)
})

test('the frames of a range that did not render are named', () => {
  const out = viewSummary(
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

test("a render's code warnings are printed with where they are", () => {
  const out = viewSummary(
    noTab({
      mode: 'image',
      frame: 12,
      dataUrl: 'data:image/webp;base64,AQID',
      warnings: [{ itemId: 'g1', severity: 'warning', code: 'interpolate-repaired', message: 'interpolate was given keyframes out of order (30, 0)' }],
    }),
    nothingSaved,
  )
  assert.match(out, /Code warnings:\n  - code in g1: warning \(interpolate-repaired\): interpolate was given keyframes out of order \(30, 0\)/)
})

test('--save with a failed render reports the render, not a missing snapshot', async () => {
  body = noTab({ mode: 'image', error: { code: 'render_failed', message: 'Lambda timed out' } })
  const path = join(mkdtempSync(join(tmpdir(), 'ch-view-')), 'still.webp')
  const failure = await buildProgram()
    .parseAsync(['--api-key', 'k', '--base-url', baseUrl, 'view', '--project', 'p1', '--render', '--save', path], { from: 'user' })
    .then(() => null, (err: Error) => err)
  assert.ok(failure, 'expected the command to fail')
  assert.match(failure.message, /render_failed: Lambda timed out/)
})

/**
 * A video range comes back as frames with the sound measured beside them, read exactly as a sound render reads; a raw
 * clip says what it is, and --save writes its keyframes. Break-verified: dropping renderedLines(renderedSound) from
 * the summary turns the first red; dropping describeClip, or the clip from the "No live context" check, the second;
 * dropping the keyframes from viewImages, the third.
 */
test("a video range's sound is measured beside its frames", () => {
  const out = viewSummary(
    {
      context: {
        rendered: { kind: 'picture', frames: [{ frame: 0, dataUrl: 'data:image/webp;base64,AQID' }] },
        renderedSound: { kind: 'sound', state: 'done', loudness: { integratedLufs: -15, truePeakDbtp: -1.5 }, onsets: [], stereo: null },
      },
      participant: null,
      participants: [],
    },
    nothingSaved,
  )
  assert.match(out, /the render is from the saved project/)
  assert.match(out, /Integrated loudness -15 LUFS, true peak -1\.5 dBTP/)
})

test('a raw clip says what it is and which window was read, with no live tab', () => {
  const out = viewSummary(
    { context: { clip: { url: 'https://media.test/c.mp4', type: 'video', fromSec: 1, toSec: 3, keyframeError: 'The video service is unavailable.' } }, participant: null, participants: [] },
    nothingSaved,
  )
  assert.doesNotMatch(out, /No live context/)
  assert.match(out, /Raw source clip \(video\), from 1s to 3s: https:\/\/media\.test\/c\.mp4/)
  assert.match(out, /Keyframes not shown: The video service is unavailable\./)
})

test("--save writes a clip's keyframes, numbered in order", async () => {
  body = {
    context: { clip: { url: 'https://media.test/c.mp4', type: 'video', keyframes: [{ atSec: 0, dataUrl: 'data:image/jpeg;base64,AQ==' }, { atSec: 1, dataUrl: 'data:image/jpeg;base64,Ag==' }] } },
    participant: null,
    participants: [],
  }
  const path = join(mkdtempSync(join(tmpdir(), 'ch-view-')), 'clip.jpg')
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'view', '--asset', 'a1', '--save', path], { from: 'user' })
  assert.deepEqual([...readFileSync(path.replace('clip.jpg', 'clip-1.jpg'))], [1])
  assert.deepEqual([...readFileSync(path.replace('clip.jpg', 'clip-2.jpg'))], [2])
})
