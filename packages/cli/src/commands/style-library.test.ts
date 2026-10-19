import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../program.js'

/**
 * `contenthero style-library`: the same calls the MCP's style library tools make. Each case runs the real command
 * against a local server and asserts what it received. There is no delete command.
 */

type Seen = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }
let server: Server
let baseUrl = ''
const seen: Seen[] = []
const LIB = { id: '33333333-3333-4333-8333-333333333333', name: 'motion', description: 'Shared motion', latestVersion: 2, archivedAt: null, createdAt: 'c', updatedAt: 'u' }

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      seen.push({ method: req.method ?? '', path: url.pathname, query: url.searchParams, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ styleLibraries: [LIB], nextCursor: null, styleLibrary: LIB, archived: true }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function run(...args: string[]): Promise<Seen> {
  seen.length = 0
  await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })
  assert.equal(seen.length, 1, `expected one request for: ${args.join(' ')}`)
  return seen[0]!
}

function fileWith(name: string, content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ch-style-library-')), name)
  writeFileSync(file, content)
  return file
}

test('style-library list sends its filters, paging and sort as the API reads them', async () => {
  const r = await run('style-library', 'list', '--archived', '--search', 'mo', '--sort', 'name', '--order', 'asc', '--limit', '20', '--cursor', 'c1')
  assert.equal(`${r.method} ${r.path}`, 'GET /api/v1/style-libraries')
  assert.deepEqual(
    { archived: r.query.get('archived'), search: r.query.get('search'), sort: r.query.get('sort'), order: r.query.get('order'), limit: r.query.get('limit'), cursor: r.query.get('cursor') },
    { archived: 'true', search: 'mo', sort: 'name', order: 'asc', limit: '20', cursor: 'c1' },
  )
  seen.length = 0
  await assert.rejects(buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'style-library', 'list', '--sort', 'createdAt'], { from: 'user' }))
  assert.equal(seen.length, 0)
})

test('style-library get reads versions a page at a time, or one version when asked', async () => {
  const paged = await run('style-library', 'get', 'motion', '--limit', '5', '--cursor', 'v1')
  assert.equal(`${paged.method} ${paged.path}`, '/api/v1/style-libraries/motion'.replace(/^/, 'GET '))
  assert.deepEqual({ limit: paged.query.get('limit'), cursor: paged.query.get('cursor'), version: paged.query.get('version') }, { limit: '5', cursor: 'v1', version: null })
  const one = await run('style-library', 'get', 'motion', '--at-version', '2')
  assert.equal(one.query.get('version'), '2')
  assert.equal(one.query.get('limit'), null)
})

test('style-library create reads module code from files and sends the publish sources', async () => {
  const code = fileWith('ease.tsx', 'export const ease = 1\n')
  const r = await run('style-library', 'create', 'motion', '--description', 'Shared motion', '--notes', 'first', '--module', `ease=${code}`)
  assert.equal(`${r.method} ${r.path}`, 'POST /api/v1/style-libraries')
  assert.deepEqual(r.body, { name: 'motion', description: 'Shared motion', notes: 'first', modules: { ease: { code: 'export const ease = 1\n' } } })

  const fromProject = await run('style-library', 'create', 'motion', '--from-project', 'p1', '--project-module', 'a', '--project-module', 'b', '--project-revision', '4')
  assert.deepEqual(fromProject.body, { name: 'motion', fromProject: { projectId: 'p1', modules: ['a', 'b'], revision: 4 } })

  const bare = await run('style-library', 'create', 'motion')
  assert.deepEqual(bare.body, { name: 'motion' })

  seen.length = 0
  await assert.rejects(buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'style-library', 'create', 'motion', '--from-project', 'p1'], { from: 'user' }))
  assert.equal(seen.length, 0)
})

test('style-library update sends edits, drops, a cleared description and the base version', async () => {
  const edits = fileWith('edits.json', '[{"find":"1","replace":"2"}]')
  const r = await run('style-library', 'update', 'motion', '--base-version', '2', '--edits', `ease=${edits}`, '--drop-module', 'old', '--clear-description', '--notes', 'faster')
  assert.equal(`${r.method} ${r.path}`, 'PATCH /api/v1/style-libraries/motion')
  assert.deepEqual(r.body, { description: null, baseVersion: 2, notes: 'faster', modules: { ease: { edits: [{ find: '1', replace: '2' }] }, old: null } })

  const text = await run('style-library', 'update', 'motion', '--description', 'New')
  assert.deepEqual(text.body, { description: 'New' })
})

test('archive style-library goes through the archive route, and there is no delete', async () => {
  const r = await run('archive', 'style-library', 'motion')
  assert.equal(`${r.method} ${r.path}`, 'POST /api/v1/archive')
  assert.deepEqual(r.body, { assetType: 'style_library', id: 'motion', archived: true })
  seen.length = 0
  await assert.rejects(buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'style-library', 'delete', 'motion'], { from: 'user' }))
  assert.equal(seen.length, 0)
})
