import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/**
 * The flags that closed the MCP/CLI parity gaps (see `packages/mcp/src/cli-parity.test.ts`) must reach the WIRE.
 * The parity test proves a flag exists; only a request proves the value is sent. Each case runs the real
 * command against a local server and asserts the request body or query it received.
 */

type Seen = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }
let server: Server
let baseUrl = ''
const seen: Seen[] = []

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      seen.push({ method: req.method ?? '', path: url.pathname, query: url.searchParams, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 'x', results: [], revision: 1, brandKit: { id: 'bk', name: 'n' } }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function run(...args: string[]): Promise<Seen> {
  seen.length = 0
  // --json output goes to stdout alongside the test report; harmless, and silencing stdout would hide the report.
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })
  assert.equal(seen.length, 1, `expected one request for: ${args.join(' ')}`)
  return seen[0]
}

test('brand-kit create sends accounts and section content', async () => {
  const sections = [{ key: 'about', body: '## Who We Are' }]
  const r = await run(
    'brand-kit', 'create', '--name', 'Acme',
    '--brand-account', 'instagram:acme',
    '--inspiration-account', 'https://youtube.com/@rival',
    '--sections', JSON.stringify(sections),
  )
  assert.equal(r.method, 'POST')
  assert.deepEqual(r.body?.brandAccounts, [{ platform: 'instagram', handleOrUrl: 'acme' }])
  assert.deepEqual(r.body?.inspirationAccounts, [{ handleOrUrl: 'https://youtube.com/@rival' }])
  assert.deepEqual(r.body?.sections, sections)
})

test('brand-kit get sends the summary detail, or the section filter with history, as query parameters', async () => {
  const summary = await run('brand-kit', 'get', 'bk1', '--detail', 'summary')
  assert.equal(summary.path, '/api/v1/brand-kits/bk1')
  assert.equal(summary.query.get('detail'), 'summary')

  const scoped = await run('brand-kit', 'get', 'bk1', '--tabs', 'voice', '--roles', 'voice_and_tone,writing_style', '--history')
  assert.equal(scoped.query.get('tabs'), 'voice')
  assert.equal(scoped.query.get('roles'), 'voice_and_tone,writing_style')
  assert.equal(scoped.query.get('history'), 'true')
})

test('brand-kit update --sections sends section writes, all in one patch', async () => {
  const sections = [{ key: 'offer', body: '## What We Sell', expectedVersion: 2 }, { key: 'about', revertTo: 1 }, { sectionName: 'Hooks', tab: 'voice' }]
  const r = await run('brand-kit', 'update', 'bk1', '--sections', JSON.stringify(sections))
  assert.equal(r.method, 'PATCH')
  assert.deepEqual(r.body?.sections, sections)
})

test('brand-kit create from a social profile alone is accepted (the flag its handler already read now exists)', async () => {
  const r = await run('brand-kit', 'create', '--brand-account', 'instagram:acme')
  assert.deepEqual(r.body?.brandAccounts, [{ platform: 'instagram', handleOrUrl: 'acme' }])
})

test('media list, media search and folder get send --small-copies (8.5)', async () => {
  assert.equal((await run('media', 'list', '--small-copies')).query.get('smallCopies'), 'true')
  assert.equal((await run('media', 'search', 'serum', '--small-copies')).query.get('smallCopies'), 'true')
  assert.equal((await run('folder', 'get', 'f1', '--small-copies')).query.get('smallCopies'), 'true')
  assert.equal((await run('media', 'list')).query.get('smallCopies'), null)
})

test('folder update --text re-queries a smart folder', async () => {
  const r = await run('folder', 'update', 'f1', '--text', 'sunsets')
  assert.deepEqual(r.body?.query, { text: 'sunsets' })
})

test('project create and import --card link the new project to that card', async () => {
  const created = await run('project', 'create', '--card', 'c1')
  assert.equal(created.body?.cardId, 'c1')
  const imported = await run('project', 'import', '--source-type', 'pptx', '--file-url', 'https://x/d.pptx', '--card', 'c1')
  assert.equal(imported.body?.cardId, 'c1')
})

test('project create --brand-kit associates the kit', async () => {
  const r = await run('project', 'create', '--brand-kit', 'bk1')
  assert.equal(r.body?.brandKitId, 'bk1')
})

// `--include-render-url` is retired (a read or an edit must not render and save a cover; `context --render` shows a
// project). Break-verified: restoring the flag on either command turns this red.
test('project get and project apply no longer take --include-render-url', async () => {
  for (const args of [
    ['project', 'get', 'p1', '--include-render-url'],
    ['project', 'apply', 'p1', '--ops', '[{"op":"delete_clip","clipId":"c1"}]', '--include-render-url'],
  ]) {
    seen.length = 0
    const failure = await buildProgram()
      .parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })
      .then(() => null, (err: { code?: string }) => err)
    assert.equal(failure?.code, 'commander.unknownOption', `${args.slice(0, 2).join(' ')} still accepts the flag`)
    assert.equal(seen.length, 0, 'nothing is sent for a refused command')
  }
})

// view's region reaches the wire (motion graphics foundation, item 1.2).
// Break-verified: dropping `region:` from the view call turns its case red.
test('view --region asks for a crop in composition units', async () => {
  const r = await run('view', '--project', 'p1', '--region', '480,270,240,135')
  assert.equal(r.query.get('render'), 'true')
  assert.equal(r.query.get('region'), '480,270,240,135')
})

// A render is a job with an id (the review loop). Break-verified: dropping any of these from the view call turns
// its assertion red.
test('view asks for exact frames, a rate, a layout, a sound, a render by its id and a wait', async () => {
  const frames = await run('view', '--project', 'p1', '--frames', '30,5,90', '--layout', 'sheets', '--wait', '20')
  assert.equal(frames.query.get('render'), 'true')
  assert.equal(frames.query.get('frames'), '30,5,90')
  assert.equal(frames.query.get('layout'), 'sheets')
  assert.equal(frames.query.get('wait'), '20')
  const rate = await run('view', '--project', 'p1', '--from-frame', '0', '--to-frame', '90', '--per-second', '6')
  assert.equal(rate.query.get('perSecond'), '6')
  const sound = await run('view', '--project', 'p1', '--sound', '--from-frame', '0', '--to-frame', '300')
  assert.equal(sound.query.get('sound'), 'true')
  // The server honors a sound on its own, so a range shaping it no longer asks for a picture too.
  assert.equal(sound.query.get('render'), null)
  const read = await run('view', '--render-id', 'r1', '--page', '2')
  assert.equal(read.query.get('renderId'), 'r1')
  assert.equal(read.query.get('page'), '2')
  assert.equal(read.query.get('render'), null)
})

// video, and a raw clip with its window, reach the wire; a clip's count and width do not turn it into a render.
// Break-verified: dropping `video:` or any clip field from the view call, or the clip exemption from the implied
// render, turns its assertion red.
test('view asks for a video range, and a raw clip by asset or media URL with its window', async () => {
  const video = await run('view', '--project', 'p1', '--video', '--from-frame', '0', '--to-frame', '90')
  assert.equal(video.query.get('video'), 'true')
  assert.equal(video.query.get('render'), null)
  const asset = await run('view', '--asset', 'a1', '--from-sec', '1.5', '--to-sec', '4', '--count', '6', '--width', '480')
  assert.equal(asset.query.get('assetId'), 'a1')
  assert.equal(asset.query.get('fromSec'), '1.5')
  assert.equal(asset.query.get('toSec'), '4')
  assert.equal(asset.query.get('count'), '6')
  assert.equal(asset.query.get('width'), '480')
  assert.equal(asset.query.get('render'), null)
  const url = await run('view', '--media-url', 'https://media.contenthero.ai/c.mp4')
  assert.equal(url.query.get('mediaUrl'), 'https://media.contenthero.ai/c.mp4')
})

// get_media reads no clip frames: `view --asset` or `view --media-url` sees a clip, and a region on it cuts each frame.
// Break-verified: restoring `media watch` turns the first red; dropping `region:` from the view call turns the second
// red; dropping the clip sentence from --region's help turns the third red; a zoom description that names any media
// file rather than an image turns the last red.
test('media watch is gone, and view cuts a clip to a region', async () => {
  seen.length = 0
  const failure = await buildProgram()
    .parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'media', 'watch', 'https://media.contenthero.ai/a/original.mp4'], { from: 'user' })
    .then(() => null, (err: { code?: string }) => err)
  assert.equal(failure?.code, 'commander.unknownCommand')
  assert.equal(seen.length, 0, 'nothing is sent for a removed command')
  const clip = await run('view', '--asset', 'a1', '--region', '960,540,960,540')
  assert.equal(clip.query.get('region'), '960,540,960,540')
  assert.equal(clip.query.get('render'), null)
  const view = buildProgram().commands.find((c) => c.name() === 'view')
  const region = view?.options.find((o) => o.long === '--region')
  assert.match(region?.description ?? '', /For a source clip, the rectangle is in the clip's own pixels, and each of its frames is cut to it\.$/)
  const zoom = buildProgram().commands.find((c) => c.name() === 'media')?.commands.find((c) => c.name() === 'zoom')
  assert.match(zoom?.description() ?? '', /^Cut a region from an image's original/)
})

test('card update --notes-edits sends the edits in order, with no revision required', async () => {
  const edits = [{ append: '\n\nNew paragraph' }, { find: 'draft', replace: 'ready' }]
  const r = await run('card', 'update', 'c1', '--notes-edits', JSON.stringify(edits))
  assert.equal(r.method, 'PATCH')
  assert.equal(r.path, '/api/v1/cards/c1')
  assert.deepEqual(r.body?.notesEdits, edits)
  // The point of the field: an edit is not a whole write, so the CLI must not demand the revision.
  assert.equal(r.body && 'expectedRevision' in r.body, false)
  assert.equal(r.body && 'notes' in r.body, false)
})

test('generate video --keep-input-length sends keepInputLength and no duration', async () => {
  const r = await run('generate', 'video', 'make it night', '-m', 'wan-2.7', '--ref-video', 'https://cdn/s.mp4',
    '--keep-input-length', '--cost')
  assert.equal(r.body?.keepInputLength, true)
  assert.equal(r.body?.duration, undefined)
})

test('generate video help describes --keep-input-length in the approved words', () => {
  const video = buildProgram().commands.find((c) => c.name() === 'generate')!.commands.find((c) => c.name() === 'video')!
  const flag = video.options.find((o) => o.long === '--keep-input-length')
  assert.equal(flag?.description, "keep the input video's full length (video edit only)")
})

// 9.9: every list, setting and project action reaches the API. Each case asserts the wire, not just the flag.
test('card list sends spaceId, isFavorite and tag under the names the API reads', async () => {
  const r = await run('card', 'list', '--space', 'all', '--favorite', '--tag', 'launch')
  assert.equal(r.query.get('spaceId'), 'all')
  assert.equal(r.query.get('isFavorite'), 'true')
  assert.equal(r.query.get('tag'), 'launch')
  assert.equal(r.query.has('space_id') || r.query.has('is_favorite'), false)
})

test('space list sends archived, favorited and search', async () => {
  const r = await run('space', 'list', '--archived', '--favorite', '--search', 'client')
  assert.equal(r.query.get('archived'), 'true')
  assert.equal(r.query.get('favorited'), 'true')
  assert.equal(r.query.get('search'), 'client')
})

test('tracked-account list sends accountType and brandKitId', async () => {
  const r = await run('tracked-account', 'list', '--kind', 'brand', '--brand-kit', 'bk1')
  assert.equal(r.query.get('accountType'), 'brand')
  assert.equal(r.query.get('brandKitId'), 'bk1')
})

test('project update sends its fields, and none clears the brand kit and the cover framing', async () => {
  const set = await run('project', 'update', 'p1', '--title', 'T', '--width', '1080', '--brand-kit', 'bk1', '--cover', 'frame:12', '--cover-position', '50,40')
  assert.equal(set.method, 'PATCH')
  assert.equal(set.path, '/api/v1/projects/p1')
  assert.deepEqual(set.body, { title: 'T', width: 1080, brandKitId: 'bk1', cover: { frame: 12 }, coverPosition: { x: 50, y: 40 } })
  const cleared = await run('project', 'update', 'p1', '--brand-kit', 'none', '--cover-position', 'none', '--cover', 'media:m1')
  assert.deepEqual(cleared.body, { brandKitId: null, cover: { mediaId: 'm1' }, coverPosition: null })
})

test('project duplicate, edit undo and edit redo reach their routes', async () => {
  const dup = await run('project', 'duplicate', 'p1')
  assert.equal(`${dup.method} ${dup.path}`, 'POST /api/v1/projects/p1/duplicate')
  assert.equal(dup.body, null)
  // A copy from a saved version names it. Break-verified: dropping the versionId from the duplicate call turns this red.
  const fromVersion = await run('project', 'duplicate', 'p1', 'v1')
  assert.equal(`${fromVersion.method} ${fromVersion.path}`, 'POST /api/v1/projects/p1/duplicate')
  assert.deepEqual(fromVersion.body, { versionId: 'v1' })
  const undo = await run('project', 'edit', 'undo', 'p1', '--expected-revision', '9', '--revision', '7')
  assert.equal(`${undo.method} ${undo.path}`, 'POST /api/v1/projects/p1/undo')
  assert.deepEqual(undo.body, { expectedRevision: 9, revision: 7 })
  const redo = await run('project', 'edit', 'redo', 'p1', '--expected-revision', '10')
  assert.equal(`${redo.method} ${redo.path}`, 'POST /api/v1/projects/p1/redo')
  assert.deepEqual(redo.body, { expectedRevision: 10 })
})

test('project update sends the settings named, on and off, to the project', async () => {
  const r = await run('project', 'update', 'p1', '--no-magnetic-track', '--linkage', '--linked-tracks', '{"audio":false}', '--fps', '25', '--loudness', '-16')
  assert.equal(`${r.method} ${r.path}`, 'PATCH /api/v1/projects/p1')
  assert.deepEqual(r.body, { fps: 25, loudness: -16, magneticTrack: false, linkage: true, linkedTracks: { audio: false } })
  assert.deepEqual((await run('project', 'update', 'p1', '--loudness', 'off')).body, { loudness: 'off' })
  assert.deepEqual((await run('project', 'update', 'p1', '--orientation', '9:16')).body, { orientation: '9:16' })
  // The timeline settings commands are gone: a project setting has one reader and one writer.
  await assert.rejects(run('project', 'settings', 'get', 'p1'))
})

/**
 * `project export` runs an export AND parents `get` and `list` (get_export, list_project_exports). Commander
 * dispatches to a subcommand when the first operand names one, and otherwise runs the export with it as the project
 * id. Break-verified: renaming the `get` subcommand turns this red (the export then ran with `get` as its project id).
 */
test('project export runs an export, and dispatches get and list to their own commands', async () => {
  const started = await run('project', 'export', 'p1', '--format', 'mp4')
  assert.equal(`${started.method} ${started.path}`, 'POST /api/v1/projects/p1/export')
  assert.equal(started.body?.format, 'mp4')
  const polled = await run('project', 'export', 'get', 'e1')
  assert.equal(`${polled.method} ${polled.path}`, 'GET /api/v1/exports/e1')
  const listed = await run('project', 'export', 'list', 'p1', '--limit', '5')
  assert.equal(`${listed.method} ${listed.path}`, 'GET /api/v1/projects/p1/exports')
  assert.equal(listed.query.get('limit'), '5')
})

test("project export sends this export's loudness only when it is named", async () => {
  const leveled = await run('project', 'export', 'p1', '--loudness', '-16')
  assert.equal(`${leveled.method} ${leveled.path}`, 'POST /api/v1/projects/p1/export')
  assert.equal(leveled.body?.loudness, -16)
  assert.equal((await run('project', 'export', 'p1', '--loudness', 'OFF')).body?.loudness, 'off')
  assert.equal('loudness' in ((await run('project', 'export', 'p1')).body ?? {}), false)
  await assert.rejects(run('project', 'export', 'p1', '--loudness', 'loud'), /Expected a loudness in LUFS or "off"/)
})

test('project version commands reach the version routes with the bodies the API reads', async () => {
  const cases: Array<[string[], string, unknown]> = [
    [['project', 'version', 'save', 'p1', '--label', 'Before'], 'POST /api/v1/projects/p1/versions', { label: 'Before' }],
    [['project', 'version', 'restore', 'p1', 'v1'], 'POST /api/v1/projects/p1/versions/v1', null],
    [['project', 'version', 'update', 'p1', 'v1', '--label', 'Final'], 'PATCH /api/v1/projects/p1/versions/v1', { label: 'Final' }],
    [['project', 'version', 'update', 'p1', 'v1', '--label', ''], 'PATCH /api/v1/projects/p1/versions/v1', { label: '' }],
    [['project', 'version', 'delete', 'p1', 'v1'], 'DELETE /api/v1/projects/p1/versions/v1', null],
  ]
  for (const [args, route, body] of cases) {
    const r = await run(...args)
    assert.equal(`${r.method} ${r.path}`, route, args.join(' '))
    assert.deepEqual(r.body, body, args.join(' '))
  }
})

test('media list sends the library contract: a source partition, several types, and no status', async () => {
  const r = await run('media', 'list', '--source', 'exports', '--type', 'video,doc', '--kind', 'board', '--favorite')
  assert.equal(r.query.get('source'), 'exports')
  assert.equal(r.query.get('contentType'), 'video,doc')
  assert.equal(r.query.get('kind'), 'board')
  assert.equal(r.query.get('favorited'), 'true')
  assert.equal(r.query.has('status'), false)
})

test('media list refuses the sources and types the API refuses', async () => {
  for (const bad of [['--source', 'stock'], ['--source', 'files'], ['--type', 'transcript'], ['--kind', 'upload']]) {
    seen.length = 0
    const failure = await buildProgram()
      .parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'media', 'list', ...bad], { from: 'user' })
      .then(() => null, (err: unknown) => err)
    assert.ok(failure, `media list ${bad.join(' ')} is refused`)
    assert.equal(seen.length, 0, 'nothing is sent for a refused command')
  }
})

test('brand-kit create sends logos camelCase, the first one primary, and assets with no primary', async () => {
  const r = await run('brand-kit', 'create', '--name', 'Acme', '--logo', 'https://x/logo.png', '--logo', 'Gen12345', '--asset', 'https://x/a.png')
  assert.deepEqual(r.body?.logos, [{ url: 'https://x/logo.png', isPrimary: true }, { outputId: 'Gen12345' }])
  assert.deepEqual(r.body?.assets, [{ url: 'https://x/a.png' }])
})

test('stage update moves by naming a neighbor or an end, never a number', async () => {
  const r = await run('stage', 'update', 'st1', '--space', 'sp1', '--position', 'top')
  assert.equal(r.method, 'PATCH')
  assert.deepEqual(r.body, { spaceId: 'sp1', position: 'top' })
})

// 9.9, the ordering contract: every hand-arranged list moves by --after, --before or --position, sent as the API reads.
test('every hand-arranged list sends its placement as afterId, beforeId and position', async () => {
  const cases: Array<[string[], string, Record<string, unknown>]> = [
    [['card', 'create', 'T', '--platform', 'youtube', '--position', 'top'], 'POST /api/v1/cards', { position: 'top' }],
    [['card', 'update', 'c1', '--stage', 'Review', '--after', 'c2'], 'PATCH /api/v1/cards/c1', { afterId: 'c2' }],
    [['stage', 'create', 'S', '--before', 'st2'], 'POST /api/v1/stages', { beforeId: 'st2' }],
    [['brand-kit', 'update', 'bk1', '--after', 'bk2'], 'PATCH /api/v1/brand-kits/bk1', { afterId: 'bk2' }],
    [['avatar', 'update', 'av1', '--position', 'bottom'], 'PATCH /api/v1/avatars/av1', { position: 'bottom' }],
    [['tracked-account', 'update', 'ta1', '--before', 'ta2'], 'PATCH /api/v1/accounts/ta1', { beforeId: 'ta2' }],
    [['template', 'create', '--name', 'N', '--category', 'c', '--shape', 'circle', '--position', 'top'], 'POST /api/v1/templates', { position: 'top' }],
    [['template', 'update', 't1', '--after', 't2'], 'PATCH /api/v1/templates/t1', { afterId: 't2' }],
  ]
  for (const [args, route, placement] of cases) {
    const r = await run(...args)
    assert.equal(`${r.method} ${r.path}`, route, args.join(' '))
    for (const [k, v] of Object.entries(placement)) assert.equal(r.body?.[k], v, `${args.join(' ')} sends ${k}`)
  }
})

test('folder update --move-item sends moveItem, each item named as --add names one', async () => {
  const r = await run('folder', 'update', 'f1', '--move-item', 'a1B2c3D4-2', '--move-after', 'card:c1')
  assert.deepEqual(r.body?.moveItem, { item: { mediaId: 'a1B2c3D4-2' }, after: { cardId: 'c1' } })
  const end = await run('folder', 'update', 'f1', '--move-item', 'project:p1', '--move-position', 'top')
  assert.deepEqual(end.body?.moveItem, { item: { projectId: 'p1' }, position: 'top' })
})

test('brand-kit --display-logo marks the named logo isDisplay, and must name one of the --logo refs', async () => {
  const r = await run('brand-kit', 'update', 'bk1', '--logo', 'https://x/full.png', '--logo', 'https://x/icon.png', '--display-logo', 'https://x/icon.png')
  assert.deepEqual(r.body?.logos, [{ url: 'https://x/full.png', isPrimary: true }, { url: 'https://x/icon.png', isDisplay: true }])
  seen.length = 0
  const failure = await buildProgram()
    .parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'brand-kit', 'update', 'bk1', '--logo', 'https://x/a.png', '--display-logo', 'https://x/b.png'], { from: 'user' })
    .then(() => null, (err: unknown) => err)
  assert.ok(failure, 'a display logo that is not among the logos is refused')
  assert.equal(seen.length, 0, 'nothing is sent for a refused command')
})
