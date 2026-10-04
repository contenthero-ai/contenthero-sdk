import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../program.js'

/**
 * `contenthero template` (motion graphics 5.7): the editor's Elements on the CLI, the same calls the MCP's template tools
 * make. Each case runs the real command against a local server and asserts what it received.
 */

type Seen = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }
let server: Server
let baseUrl = ''
const seen: Seen[] = []
const ROW = { id: '22222222-2222-4222-8222-222222222222', name: 'Lower third', version: 3, code: 'export default () => null' }

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      seen.push({ method: req.method ?? '', path: url.pathname, query: url.searchParams, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ templates: [ROW], nextCursor: null, template: ROW, warnings: [], deleted: true, id: ROW.id }))
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

test('template list sends its filters as the API reads them', async () => {
  const r = await run('template', 'list', '--scope', 'user', '--kind', 'shape', '--category', 'shapes', '--category', 'arrows', '--search', 'star', '--archived', '--limit', '20')
  assert.equal(`${r.method} ${r.path}`, 'GET /api/v1/templates')
  assert.deepEqual(
    { scope: r.query.get('scope'), kind: r.query.get('kind'), category: r.query.getAll('category'), search: r.query.get('search'), archived: r.query.get('archived'), limit: r.query.get('limit') },
    { scope: 'user', kind: 'shape', category: ['shapes', 'arrows'], search: 'star', archived: 'only', limit: '20' },
  )
})

test('template get, update and delete address one template by id; update sends the version read', async () => {
  assert.equal(`${(await run('template', 'get', ROW.id)).path}`, `/api/v1/templates/${ROW.id}`)
  const updated = await run('template', 'update', ROW.id, '--props', '{"title":"Bye"}', '--expected-version', '3', '--tag', 'name', '--tag', 'intro')
  assert.equal(`${updated.method} ${updated.path}`, `PATCH /api/v1/templates/${ROW.id}`)
  assert.deepEqual(updated.body, { props: { title: 'Bye' }, tags: ['name', 'intro'], expectedVersion: 3 })
  const deleted = await run('template', 'delete', ROW.id)
  assert.equal(`${deleted.method} ${deleted.path}`, `DELETE /api/v1/templates/${ROW.id}`)
})

test('template create saves from a placed item, from a copy, or from fields with code read from a file', async () => {
  const fromItem = await run('template', 'create', '--from-item', 'g1', '--from-project', 'p1', '--category', 'lower-thirds')
  assert.equal(`${fromItem.method} ${fromItem.path}`, 'POST /api/v1/templates')
  assert.deepEqual(fromItem.body, { category: 'lower-thirds', fromItem: { projectId: 'p1', itemId: 'g1' } })

  const copy = await run('template', 'create', '--from-template', ROW.id, '--name', 'Mine')
  assert.deepEqual(copy.body, { name: 'Mine', fromTemplateId: ROW.id })

  const file = join(mkdtempSync(join(tmpdir(), 'ch-template-')), 'graphic.tsx')
  writeFileSync(file, 'export default function G() { return null }\n')
  const fields = await run(
    'template', 'create', '--name', 'G', '--category', 'probe', '--code', file,
    '--coverage', 'partial', '--width-fraction', '0.25', '--height-fraction', '0.1', '--resize', 'scale', '--aspect', '2.5', '--duration-frames', '90',
  )
  assert.deepEqual(fields.body, {
    name: 'G', category: 'probe', code: 'export default function G() { return null }\n',
    durationFrames: 90, coverage: 'partial', widthFraction: 0.25, heightFraction: 0.1, resize: 'scale', aspect: 2.5,
  })

  const lottie = await run('template', 'create', '--name', 'L', '--category', 'probe', '--lottie', 'https://media.contenthero.ai/a.json', '--recolor', '#FF0000=primaryColor')
  assert.deepEqual(lottie.body, { name: 'L', category: 'probe', lottie: { url: 'https://media.contenthero.ai/a.json', recolor: [{ from: '#FF0000', role: 'primaryColor' }] } })
})

test('template create refuses a source given half or twice, before any request', async () => {
  for (const args of [['--from-item', 'g1'], ['--from-item', 'g1', '--from-project', 'p1', '--from-template', ROW.id]]) {
    seen.length = 0
    await assert.rejects(buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', 'template', 'create', ...args], { from: 'user' }))
    assert.equal(seen.length, 0)
  }
})
