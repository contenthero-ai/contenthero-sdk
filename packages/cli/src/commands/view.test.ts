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

// A render comes back alone: the parts a view named (gap closure D4).
const noTab = (rendered: Record<string, unknown>): ViewResult => ({ rendered })
const nothingSaved = { count: 0, path: '' }

test('a render with no live tab is shown, not reported as no context', () => {
  const out = viewSummary(noTab({ mode: 'image', frame: 12, dataUrl: 'data:image/webp;base64,AQID' }), nothingSaved)
  assert.doesNotMatch(out, /No live context/)
  assert.doesNotMatch(out, /Live context/)
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
let lastUrl = ''
let server: Server
let baseUrl = ''

before(async () => {
  server = createServer((req, res) => {
    lastUrl = req.url ?? ''
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
      rendered: { kind: 'picture', frames: [{ frame: 0, dataUrl: 'data:image/webp;base64,AQID' }] },
      renderedSound: { kind: 'sound', status: 'ready', loudness: { integratedLufs: -15, truePeakDbtp: -1.5 }, onsets: [], stereo: null },
    },
    nothingSaved,
  )
  assert.match(out, /Integrated loudness -15 LUFS, true peak -1\.5 dBTP/)
})

test('a raw clip says what it is and which window was read, with no live tab', () => {
  const out = viewSummary(
    { clip: { url: 'https://media.test/c.mp4', type: 'video', fromSec: 1, toSec: 3, keyframeError: 'The video service is unavailable.' } },
    nothingSaved,
  )
  assert.doesNotMatch(out, /No live context/)
  assert.match(out, /Raw source clip \(video\), from 1s to 3s: https:\/\/media\.test\/c\.mp4/)
  assert.match(out, /Keyframes not shown: The video service is unavailable\./)
})

/** A post's video carries its audio map for the window read. Break-verified: dropping describeAudioMap from viewSummary turns this red. */
test("a post's video says its audio map for the window, or that it is being measured", () => {
  const window = {
    fromSec: 0, toSec: 3, durationSec: 9, speech: [],
    sounds: [{
      atSec: 0.5, endSec: 1, stem: 'other', levelDb: -20, riseDb: 12, vsVoiceDb: null,
      descriptors: { attackMs: 6, decayMs: 240, peakDb: -11, centroidHz: { start: 3000, peak: 2500, end: 900 }, bandwidthHz: 2000, flatness: 0.7, pitchHz: null, lowBandShare: 0.1, stereoWidth: 0.5 },
    }],
    music: { present: true, tempoBpm: 120, beatsSec: [0.5], key: 'C', mode: 'major', levelDb: -22 }, ducking: null,
    loudness: { integratedLufs: -15, shortTerm: [] },
    levels: { vocalsDb: null, drumsDb: -22, bassDb: -26, otherDb: -20 },
  }
  const ready = viewSummary({ clip: { contentId: 'post-1', type: 'video', audioMap: { status: 'ready', window } } }, nothingSaved)
  assert.match(ready, /audio map, 0\.0s to 3\.0s:\n  speech: none\n  sound candidates \(measured, not identified\): 1\n    1\. 0\.5s to 1\.0s on other: -20 dB, \+12 over its floor; attack 6 ms/)
  assert.match(ready, /  music: 120 BPM, C major, 1 beat in this window/)
  const pending = viewSummary({ clip: { contentId: 'post-1', type: 'video', audioMap: { status: 'pending' } } }, nothingSaved)
  assert.match(pending, /audio map: the sound analysis is still being made: read it again with the same inputs/)
})

/**
 * A heard post window says how to read its evidence sheet, and --save writes the sheet after the keyframes and before
 * the sound's picture. Break-verified: dropping the sheet from viewImages, or describeEvidenceSheet from viewSummary,
 * turns this red.
 */
test("a post's heard window says how to read its evidence sheet, and --save writes it", async () => {
  const sheet = {
    status: 'ready', fromSec: 1, toSec: 3, width: 1292, height: 610, dataUrl: 'data:image/webp;base64,BQ==',
    frames: [{ atSec: 2 }], words: [], stems: ['vocals', 'drums', 'bass', 'other'], frequencyHz: { min: 20, max: 20000 }, soundsMarked: 0,
  }
  const summary = viewSummary({ clip: { contentId: 'post-1', type: 'video', sheet } }, nothingSaved)
  assert.match(summary, /evidence sheet, 1\.0s to 3\.0s: frames along the top, the spoken words under them, then one spectrogram strip per stem/)
  body = {
    clip: { contentId: 'post-1', type: 'video', keyframes: [{ atSec: 2, dataUrl: 'data:image/jpeg;base64,AQ==' }], sheet },
  }
  const path = join(mkdtempSync(join(tmpdir(), 'ch-view-')), 'sheet.webp')
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'view', '--content-id', 'post-1', '--sound', '--from-sec', '1', '--to-sec', '3', '--save', path], { from: 'user' })
  assert.deepEqual([...readFileSync(path.replace('sheet.webp', 'sheet-1.webp'))], [1])
  assert.deepEqual([...readFileSync(path.replace('sheet.webp', 'sheet-2.webp'))], [5])
})

test("--save writes a clip's keyframes, numbered in order", async () => {
  body = {
    clip: { url: 'https://media.test/c.mp4', type: 'video', keyframes: [{ atSec: 0, dataUrl: 'data:image/jpeg;base64,AQ==' }, { atSec: 1, dataUrl: 'data:image/jpeg;base64,Ag==' }] },
  }
  const path = join(mkdtempSync(join(tmpdir(), 'ch-view-')), 'clip.jpg')
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'view', '--asset', 'a1', '--save', path], { from: 'user' })
  assert.deepEqual([...readFileSync(path.replace('clip.jpg', 'clip-1.jpg'))], [1])
  assert.deepEqual([...readFileSync(path.replace('clip.jpg', 'clip-2.jpg'))], [2])
})

/**
 * A tracked post is a source: --content-id names it and --slide, beside it, its carousel's video slide (not a canvas
 * slide), --at-sec names the seconds, and --sound measures the window beside the frames; the summary names the post
 * rather than an address, reads its sound, and --save writes its keyframes then its sound's picture. Break-verified:
 * sending --slide as slideId with a post turns the first red; dropping sourceSoundLines from the summary, the second;
 * dropping the sound's picture from viewImages, the third.
 */
test('--content-id and --slide name a post, --at-sec the seconds, and --sound comes beside the frames', async () => {
  body = { live: { context: null, participant: null, participants: [] } }
  await buildProgram().parseAsync(
    ['--api-key', 'k', '--base-url', baseUrl, '--json', 'view', '--content-id', 'post-1', '--slide', '4', '--at-sec', '1,3.5', '--sound'],
    { from: 'user' },
  )
  const q = new URL(lastUrl, 'http://x').searchParams
  assert.equal(q.get('contentId'), 'post-1')
  assert.equal(q.get('slide'), '4')
  assert.equal(q.get('slideId'), null)
  assert.equal(q.get('atSec'), '1,3.5')
  assert.equal(q.get('sound'), 'true')
  assert.equal(q.get('render'), null)
  await buildProgram().parseAsync(
    ['--api-key', 'k', '--base-url', baseUrl, '--json', 'view', '--asset', 'a1', '--from-sec', '2', '--to-sec', '4', '--per-second', '2'],
    { from: 'user' },
  )
  const r = new URL(lastUrl, 'http://x').searchParams
  assert.deepEqual([r.get('assetId'), r.get('perSecond'), r.get('render')], ['a1', '2', null])
})

test("a post's summary names it and reads its sound, or says why it could not be heard", () => {
  const out = viewSummary(
    {
      clip: {
          contentId: 'post-1', slide: 4, type: 'video', fromSec: 2, toSec: 4,
          sound: {
            kind: 'sound', fromSec: 2, toSec: 4, loudness: { integratedLufs: -14, truePeakDbtp: -1 }, onsets: [{ seconds: 2.5 }],
            stereo: null, audioUrl: 'https://media.test/w.wav',
          },
        },
    },
    nothingSaved,
  )
  assert.match(out, /Tracked post post-1, its video \(slide 4\), from 2s to 4s/)
  assert.doesNotMatch(out, /undefined/)
  assert.match(out, /Its sound from 2s to 4s, as it is: Integrated loudness -14 LUFS/)
  assert.match(out, /Sounds start at 2\.5s, in the source's own seconds\./)
  assert.match(out, /The audio, for a short while: https:\/\/media\.test\/w\.wav/)
  const silent = viewSummary(
    { clip: { contentId: 'post-1', type: 'video', sound: { kind: 'sound', error: { code: 'no_sound', message: 'This video has no sound.' } } } },
    nothingSaved,
  )
  assert.match(silent, /The sound could not be heard\. no_sound: This video has no sound\./)
})

test("--save writes a source's keyframes, then its sound's picture", async () => {
  body = {
    clip: {
        contentId: 'post-1', type: 'video',
        keyframes: [{ atSec: 0, dataUrl: 'data:image/jpeg;base64,AQ==' }],
        sound: { kind: 'sound', loudness: {}, onsets: [], stereo: null, picture: { width: 2, height: 2, dataUrl: 'data:image/webp;base64,Aw==' } },
      },
  }
  const path = join(mkdtempSync(join(tmpdir(), 'ch-view-')), 'post.jpg')
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'view', '--content-id', 'post-1', '--count', '1', '--sound', '--save', path], { from: 'user' })
  assert.deepEqual([...readFileSync(path.replace('post.jpg', 'post-1.jpg'))], [1])
  assert.deepEqual([...readFileSync(path.replace('post.jpg', 'post-2.jpg'))], [3])
})
