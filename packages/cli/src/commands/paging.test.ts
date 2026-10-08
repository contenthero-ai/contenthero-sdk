import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { buildProgram } from '../program.js'

/**
 * 9.7b: ONE paging mechanism for every paged list. Each command takes `--limit` and `--cursor` and no `--offset`, sends
 * them as the API reads them, and ends its human output with the next page's flag exactly when there is one (`--json`
 * keeps the whole page, `nextCursor` included). Each case runs the real command against a local server.
 *
 * The output cases run the CLI as a real process: its stdout is the test runner's report stream in process, and
 * capturing it there swallows the report. The server answers a request whose cursor is `last` as the last page.
 */

const exec = promisify(execFile)
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')
let server: Server
let baseUrl = ''
const seen: URLSearchParams[] = []

/** One row that every list's human formatter can render, under every list's items key. */
const ROW = {
  id: 'r1', shortId: 'R1short1', mediaId: 'R1short1', type: 'media', kind: 'image', title: 'Row', name: 'Row', status: 'completed',
  isFavorited: false, model: 'm', prompt: null, fileName: null, summary: null, relevance: 0.5, scenes: [], platform: 'youtube',
  sourceType: 'text', createdAt: null, category: 'shapes', scope: 'system', version: 1, coverage: 'full', orientation: '16:9',
  input_urls: [], input_video_url: null, voiceId: 'v1', sortOrder: 0, created_at: 't', label: null, revision: 1,
}

before(async () => {
  server = createServer((req, res) => {
    const query = new URL(req.url ?? '/', 'http://x').searchParams
    seen.push(query)
    const nextCursor = query.get('cursor') === 'last' ? null : 'next-9'
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      media: [ROW], results: [ROW], folder: null, items: [ROW], cards: [ROW], content: [ROW], templates: [ROW], projects: [ROW],
      tags: [ROW], avatars: [ROW], voices: [ROW], brandKits: [ROW], klingElements: [ROW], connectedAccounts: [ROW],
      trackedAccounts: [ROW], stages: [ROW], spaces: [ROW], folders: [ROW], derived: [], versions: [ROW],
      total: 1, space: { id: 's1', name: 'Main' }, nextCursor,
    }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

const PAGED = [
  ['media', 'list'],
  ['media', 'search', 'cats'],
  ['folder', 'get', 'favorites'],
  ['card', 'list'],
  ['content', 'list'],
  ['brand-kit', 'knowledge', 'list', 'k1'],
  ['template', 'list'],
  ['project', 'list'],
  // Paged in 9.9: every growable list pages.
  ['tag', 'list'],
  ['avatar', 'list'],
  ['voice', 'list'],
  ['brand-kit', 'list'],
  ['kling-element', 'list'],
  ['connected-account', 'list'],
  ['tracked-account', 'list'],
  ['stage', 'list'],
  ['space', 'list'],
  ['folder', 'list'],
  ['project', 'version', 'list', 'p1'],
]

/** Run a command in process, returning the query the server received. Its `--json` output joins the report, harmlessly. */
async function query(args: string[]): Promise<URLSearchParams> {
  seen.length = 0
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, ...args], { from: 'user' })
  assert.equal(seen.length, 1, `expected one request for: ${args.join(' ')}`)
  return seen[0]!
}

/** Run a command as a real process, returning what it printed. */
async function printed(args: string[]): Promise<string> {
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', entry, '--api-key', 'k', '--base-url', baseUrl, ...args], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  return stdout
}

test('every paged list sends --limit and --cursor as limit and cursor', async () => {
  for (const command of PAGED) {
    const sent = await query([...command, '--limit', '5', '--cursor', 'c-1'])
    assert.equal(sent.get('limit'), '5', `${command.join(' ')} sends limit`)
    assert.equal(sent.get('cursor'), 'c-1', `${command.join(' ')} sends cursor`)
    assert.equal(sent.has('offset'), false, `${command.join(' ')} sends no offset`)
  }
})

test('every paged list refuses --offset', async () => {
  for (const command of PAGED) {
    const write = process.stderr.write
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      await assert.rejects(
        buildProgram().exitOverride().parseAsync(['--api-key', 'k', '--base-url', baseUrl, ...command, '--offset', '10'], { from: 'user' }),
        `${command.join(' ')} has no --offset`,
      )
    } finally {
      process.stderr.write = write
    }
  }
})

test('a paged list ends with the next page\'s flag only when there is one, and --json keeps the cursor', async () => {
  await Promise.all(
    PAGED.map(async (command) => {
      const [more, json, last] = await Promise.all([
        printed(['--human', ...command]),
        printed(command),
        printed(['--human', ...command, '--cursor', 'last']),
      ])
      assert.match(more, /\nMore: --cursor next-9\n$/, `${command.join(' ')} names the next page`)
      assert.equal(JSON.parse(json).nextCursor, 'next-9', `${command.join(' ')} --json keeps nextCursor`)
      assert.doesNotMatch(last, /More:/, `${command.join(' ')} says nothing on the last page`)
    }),
  )
})

/**
 * 9.9: ONE sort mechanism for every sortable list. Each takes `--sort` (a field the API declares for that list, from
 * `LIST_SORTS`) and `--order`, sends them as `sort` and `order`, and refuses a field the list does not have.
 */
const SORTED: Array<[string[], string]> = [
  [['card', 'list'], 'scheduledAt'],
  [['project', 'list'], 'title'],
  [['space', 'list'], 'cardCount'],
  [['content', 'list'], 'engagementRate'],
  [['media', 'list'], 'sizeBytes'],
]

test('every sortable list sends --sort and --order as sort and order', async () => {
  for (const [command, field] of SORTED) {
    const sent = await query([...command, '--sort', field, '--order', 'asc'])
    assert.equal(sent.get('sort'), field, `${command.join(' ')} sends sort`)
    assert.equal(sent.get('order'), 'asc', `${command.join(' ')} sends order`)
  }
})

test('every sortable list refuses a sort field or an order it does not have', async () => {
  for (const [command] of SORTED) {
    for (const bad of [['--sort', 'nope'], ['--order', 'up']]) {
      const write = process.stderr.write
      process.stderr.write = (() => true) as typeof process.stderr.write
      try {
        await assert.rejects(
          buildProgram().exitOverride().parseAsync(['--api-key', 'k', '--base-url', baseUrl, ...command, ...bad], { from: 'user' }),
          `${command.join(' ')} refuses ${bad.join(' ')}`,
        )
      } finally {
        process.stderr.write = write
      }
    }
  }
})
