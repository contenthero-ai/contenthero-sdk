import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Two members of the classes the 2026-10-10 pass fixed, held where the CLI reads them, against a local server.
 *
 * 1. `content analyze` waits through the SDK's one wait (`waitForStatus`, the status route with the post's kind),
 *    not a loop of its own that re-read the post. Break-verified: the old loop over `content get` turns it red.
 * 2. `content list --account` says each id that named no account, in the server's words, beside the rows the others
 *    matched. Break-verified: dropping `describeAccountIdsNotFound` from the list's output turns it red.
 */

const exec = promisify(execFile)
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')
const POST = { contentId: '5f0c7e1a-1111-4a2b-9c3d-000000000003', shortId: 'Pst12345', appUrl: 'https://app.test/content/Pst12345' }
let server: Server
let baseUrl = ''
const requests: string[] = []
let analysisAsks = 0

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    requests.push(`${req.method} ${url.pathname}${url.search}`)
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && url.pathname.endsWith('/analysis')) {
      analysisAsks++
      // Running when first asked; asked again after the wait, it answers with the stored analysis.
      const analysis = analysisAsks === 1 ? { status: 'running' } : { status: 'complete', sections: ['hook'], data: {} }
      res.end(JSON.stringify({ ...POST, analysis }))
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/status/')) {
      res.end(JSON.stringify({ kind: 'content', id: POST.shortId, state: 'completed', reason: null, appUrl: POST.appUrl, progress: null, detail: { status: 'complete' } }))
      return
    }
    if (req.method === 'GET' && url.pathname === `/api/v1/content/${POST.shortId}`) {
      res.end(JSON.stringify({
        id: POST.contentId, shortId: POST.shortId, title: 'Post', hashtags: [], analysis: { status: 'absent' },
        video: {
          copy: { status: 'ready' },
          videos: [{
            copy: { status: 'ready' }, cuts: { boundaries: [2.5], scores: [0.8], durationSec: 9 },
            audioMap: {
              status: 'ready',
              summary: { durationSec: 9, speechSec: 4, soundCount: 0, music: { present: false, tempoBpm: null, key: null, mode: null }, duckingDropDb: null, integratedLufs: -16 },
              ...(url.searchParams.get('audioMap') === 'true'
                ? {
                    window: {
                      fromSec: 1, toSec: 9, durationSec: 9, speech: [{ fromSec: 1, toSec: 5 }], sounds: [],
                      music: { present: false, tempoBpm: null, beatsSec: [], key: null, mode: null, levelDb: null },
                      ducking: null, loudness: { integratedLufs: -16, shortTerm: [] },
                      levels: { vocalsDb: -16, drumsDb: null, bassDb: null, otherDb: null },
                    },
                  }
                : {}),
            },
          }],
        },
        ...(url.searchParams.get('scenes') === 'map'
          ? {
              scenes: {
                status: 'complete', sceneCount: 1,
                detail: { summary: null, timedTranscript: true, saidTiming: 'word', windowed: false, scenes: [{ index: 0, startMs: 0, endMs: 2500, description: 'box on a desk', said: 'Look.' }] },
              },
            }
          : {}),
      }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/content') {
      res.end(JSON.stringify({
        content: [], total: 0, nextCursor: null,
        accountIdsNotFound: [{ id: 'Nope0001', reason: "'Nope0001' names no tracked account of yours, so it matched nothing." }],
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: `no route ${req.method} ${url.pathname}` }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function printed(args: string[]): Promise<string> {
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', entry, '--human', '--api-key', 'k', '--base-url', baseUrl, ...args], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  return stdout
}

test('content analyze waits on a running analysis through the status route, then reads it once more', async () => {
  requests.length = 0
  analysisAsks = 0
  const out = await printed(['content', 'analyze', POST.shortId, '--timeout', '20'])
  // The post's short id alone names its analysis, so the wait reads it with no kind.
  assert.ok(requests.includes(`GET /api/v1/status/${POST.shortId}`), requests.join('\n'))
  assert.ok(!requests.some((r) => r.startsWith('GET /api/v1/content/')), `a second wait loop re-read the post:\n${requests.join('\n')}`)
  assert.equal(analysisAsks, 2)
  assert.match(out, /Break It Down for post Pst12345 \(https:\/\/app\.test\/content\/Pst12345\)/)
  assert.match(out, /Analysis: complete/)
})

test('content list says each account id that named nothing', async () => {
  const out = await printed(['content', 'list', '--account', 'Nope0001'])
  assert.match(out, /Not matched: 'Nope0001' names no tracked account of yours, so it matched nothing\./)
})

test("content analyze --kind video still downloading names how to follow it; a ready one prints each video's cuts and says nothing reached the library", async () => {
  const { contentVideoHuman } = await import('./content.js')
  const charge = { credits: 0, held: 0, state: 'free' as const, balanceAfter: null }
  const pending = contentVideoHuman({ contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'pending' }, videos: [{ copy: { status: 'pending' } }], charge })
  assert.match(pending, /still downloading/)
  assert.match(pending, /contenthero content analyze Con00001 --kind video/)
  const ready = contentVideoHuman({
    contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'ready' },
    videos: [{ copy: { status: 'ready' }, cuts: { boundaries: [1.5, 4.25], scores: [0.9, 0.7], durationSec: 9 } }], charge,
  })
  assert.match(ready, /Nothing was added to your library/)
  assert.match(ready, /Video:\s+ready; cut list: 2 cuts in 9\.0s, at 1\.50s, 4\.25s\./)
  assert.doesNotMatch(ready, /Next/)
})

test('content analyze --kind video on a carousel prints each video slide, by slide, with its own state and cuts', async () => {
  const { contentVideoHuman } = await import('./content.js')
  const charge = { credits: 0, held: 0, state: 'free' as const, balanceAfter: null }
  const out = contentVideoHuman({
    contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy: { status: 'pending' },
    videos: [
      { slide: 0, copy: { status: 'ready' }, cuts: { boundaries: [], scores: [], durationSec: 4 } },
      { slide: 2, copy: { status: 'pending' } },
    ],
    charge,
  })
  assert.match(out, /Slide 1 \(slide: 0\):\s+ready; cut list: no cuts in 4\.0s\./)
  assert.match(out, /Slide 3 \(slide: 2\):\s+still downloading\./)
  assert.match(out, /--kind video \(free\)/)
})

/**
 * `content get --cuts` asks for each downloaded video's cut list, and a window then narrows the lists rather than
 * asking for transcript segments; the post's videos print with their states. Break-verified: dropping postVideosText
 * from the output turns it red; letting the window imply segments with --cuts, the request assertion.
 */
test('content get --cuts asks for the cut lists, and its window does not imply transcript segments', async () => {
  requests.length = 0
  const out = await printed(['content', 'get', POST.shortId, '--cuts', '--start-ms', '1000'])
  const asked = requests.find((r) => r.startsWith(`GET /api/v1/content/${POST.shortId}`)) ?? ''
  assert.match(asked, /cuts=true/)
  assert.match(asked, /startMs=1000/)
  assert.doesNotMatch(asked, /transcript=/)
  assert.match(out, /Videos: ready/)
  assert.match(out, /Video: ready; cut list: 1 cut in 9\.0s, at 2\.50s; audio map/)
})

/**
 * `content get` always prints each video's audio map summary; `--audio-map` asks for its window, which a window then
 * narrows rather than asking for transcript segments. Break-verified: letting the window imply segments with
 * --audio-map turns the request assertion red; dropping the window lines from postVideosText, the output one.
 */
test('content get --audio-map asks for the audio map window, and its window does not imply transcript segments', async () => {
  requests.length = 0
  const out = await printed(['content', 'get', POST.shortId, '--audio-map', '--start-ms', '1000'])
  const asked = requests.find((r) => r.startsWith(`GET /api/v1/content/${POST.shortId}`)) ?? ''
  assert.match(asked, /audioMap=true/)
  assert.match(asked, /startMs=1000/)
  assert.doesNotMatch(asked, /transcript=/)
  assert.match(out, /Video: ready; cut list: 1 cut in 9\.0s, at 2\.50s; audio map: 4\.0s of speech in 9\.0s, no sound candidates, no music, mix -16 LUFS\./)
  assert.match(out, /\n {4}audio map, 1\.0s to 9\.0s of 9\.0s:\n {6}speech: 1\.0-5\.0s\n {6}sound candidates \(measured, not identified\): none\n {6}music: none\n {6}voice: not measured\n {6}loudness: mix -16 LUFS over the video\n {6}levels: vocals -16 dB, drums silent, bass silent, other silent/)
})

/**
 * Scenes are descriptions only: `content get --scenes map` prints each scene's range, what happens and what is said,
 * and names view for its frames; `--scenes frames` is refused before anything is asked, with the step that replaces
 * it. Break-verified: dropping the view line from scenesText turns the first red; accepting frames, the second.
 */
test('content get --scenes map prints the scenes in words and names view for frames; --scenes frames is refused', async () => {
  requests.length = 0
  const out = await printed(['content', 'get', POST.shortId, '--scenes', 'map'])
  assert.match(requests.find((r) => r.startsWith(`GET /api/v1/content/${POST.shortId}`)) ?? '', /scenes=map/)
  assert.match(out, /1\. \[0\.0s to 2\.5s\] box on a desk\n\s+said: Look\./)
  assert.match(out, /see a scene's frames with contenthero view --content-id Pst12345 --at-sec <seconds in its range>/)
  assert.doesNotMatch(out, /frame:/)

  requests.length = 0
  await assert.rejects(printed(['content', 'get', POST.shortId, '--scenes', 'frames']), (err: { stderr?: string }) => {
    assert.match(String(err.stderr), /Scenes are descriptions only: use --scenes map, and see a scene's frames with view --content-id <id> --at-sec/)
    return true
  })
  assert.equal(requests.length, 0)
})

test('content analyze --kind video prints each copy\'s detail, and an upgrade under way as still to follow', async () => {
  const { contentVideoHuman } = await import('./content.js')
  const copy = { status: 'ready' as const, resolution: 360, upgrading: { resolution: 1080 } }
  const out = contentVideoHuman({ contentId: 'c1', shortId: 'Con00001', appUrl: 'https://app/c/Con00001', kind: 'video', copy, videos: [{ copy }], charge: null })
  assert.match(out, /ready at 360p; a 1080p copy is downloading; the 360p copy stays readable until it lands/)
  assert.match(out, /contenthero content analyze Con00001 --kind video \(free\)/)
  const note = contentVideoHuman({ contentId: 'c1', kind: 'video', copy: { status: 'ready', resolution: 720 }, videos: [], notice: 'The stored copy is already the best this platform offers up to 1080p; nothing was downloaded.', charge: null } as never)
  assert.match(note, /nothing was downloaded/)
})
