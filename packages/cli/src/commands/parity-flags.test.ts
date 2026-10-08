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

// get_context's region and get_media's keyframe width reach the wire (motion graphics foundation, item 1.2).
// Break-verified: dropping `region:` from the context call, or `frameWidth:` from the watch item, turns its case red.
test('context --region asks for a crop in composition units', async () => {
  const r = await run('context', '--project', 'p1', '--region', '480,270,240,135')
  assert.equal(r.query.get('render'), 'true')
  assert.equal(r.query.get('region'), '480,270,240,135')
})

test('media watch --frame-width asks for wider keyframes', async () => {
  // The stub answers with no `items`, so the command fails AFTER sending; the request it sent is what this checks.
  seen.length = 0
  await buildProgram()
    .parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'media', 'watch', 'https://media.contenthero.ai/a/original.mp4', '--frame-width', '1280'], { from: 'user' })
    .catch(() => {})
  assert.equal(seen.length, 1)
  const items = seen[0]?.body?.items as Array<Record<string, unknown>>
  assert.equal(items[0]?.frameWidth, 1280)
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

test('project duplicate, undo and redo reach their routes', async () => {
  const dup = await run('project', 'duplicate', 'p1')
  assert.equal(`${dup.method} ${dup.path}`, 'POST /api/v1/projects/p1/duplicate')
  const undo = await run('project', 'undo', 'p1', '--expected-revision', '9', '--revision', '7')
  assert.equal(`${undo.method} ${undo.path}`, 'POST /api/v1/projects/p1/undo')
  assert.deepEqual(undo.body, { expectedRevision: 9, revision: 7 })
  const redo = await run('project', 'redo', 'p1', '--expected-revision', '10')
  assert.equal(`${redo.method} ${redo.path}`, 'POST /api/v1/projects/p1/redo')
  assert.deepEqual(redo.body, { expectedRevision: 10 })
})

test('project settings update sends only the settings named, on and off', async () => {
  const r = await run('project', 'settings', 'update', 'p1', '--snapping', '--no-magnetic-track', '--linked-tracks', '{"audio":false}')
  assert.equal(`${r.method} ${r.path}`, 'PATCH /api/v1/projects/p1/settings')
  assert.deepEqual(r.body, { magneticTrack: false, snapping: true, linkedTracks: { audio: false } })
  const read = await run('project', 'settings', 'get', 'p1')
  assert.equal(`${read.method} ${read.path}`, 'GET /api/v1/projects/p1/settings')
})

test('project version commands reach the version routes with the bodies the API reads', async () => {
  const cases: Array<[string[], string, unknown]> = [
    [['project', 'version', 'save', 'p1', '--label', 'Before'], 'POST /api/v1/projects/p1/versions', { label: 'Before' }],
    [['project', 'version', 'restore', 'p1', 'v1'], 'POST /api/v1/projects/p1/versions/v1', { action: 'restore' }],
    [['project', 'version', 'copy', 'p1', 'v1'], 'POST /api/v1/projects/p1/versions/v1', { action: 'copy' }],
    [['project', 'version', 'rename', 'p1', 'v1', 'Final'], 'PATCH /api/v1/projects/p1/versions/v1', { label: 'Final' }],
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
