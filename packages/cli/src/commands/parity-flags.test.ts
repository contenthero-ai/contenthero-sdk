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

test('brand-kit create sends the identity fields it used to lack', async () => {
  const r = await run(
    'brand-kit', 'create', '--name', 'Acme',
    '--design-principle', 'one', '--design-principle', 'two',
    '--brand-account', 'instagram:acme',
    '--inspiration-account', 'https://youtube.com/@rival',
  )
  assert.equal(r.method, 'POST')
  assert.deepEqual(r.body?.designPrinciples, ['one', 'two'])
  assert.deepEqual(r.body?.brandAccounts, [{ platform: 'instagram', handleOrUrl: 'acme' }])
  assert.deepEqual(r.body?.inspirationAccounts, [{ handleOrUrl: 'https://youtube.com/@rival' }])
})

test('brand-kit get sends the summary detail, or the field filter with history, as query parameters', async () => {
  const summary = await run('brand-kit', 'get', 'bk1', '--detail', 'summary')
  assert.equal(summary.path, '/api/v1/brand-kits/bk1')
  assert.equal(summary.query.get('detail'), 'summary')

  const scoped = await run('brand-kit', 'get', 'bk1', '--tabs', 'voice', '--tiers', 'core,contextual', '--history')
  assert.equal(scoped.query.get('tabs'), 'voice')
  assert.equal(scoped.query.get('tiers'), 'core,contextual')
  assert.equal(scoped.query.get('history'), 'true')
})

test('brand-kit update --fields sends field writes, all in one patch', async () => {
  const fields = [{ key: 'summary', value: 'Warm.', expectedVersion: 2 }, { key: 'avoid', revertTo: 1 }]
  const r = await run('brand-kit', 'update', 'bk1', '--fields', JSON.stringify(fields))
  assert.equal(r.method, 'PATCH')
  assert.deepEqual(r.body?.fields, fields)
})

test('brand-kit create from a social profile alone is accepted (the flag its handler already read now exists)', async () => {
  const r = await run('brand-kit', 'create', '--brand-account', 'instagram:acme')
  assert.deepEqual(r.body?.brandAccounts, [{ platform: 'instagram', handleOrUrl: 'acme' }])
})

test('folder update --text re-queries a smart folder', async () => {
  const r = await run('folder', 'update', 'f1', '--text', 'sunsets')
  assert.deepEqual(r.body?.query, { text: 'sunsets' })
})

test('project create --brand-kit associates the kit', async () => {
  const r = await run('project', 'create', '--brand-kit', 'bk1')
  assert.equal(r.body?.brandKitId, 'bk1')
})

test('project get --include-render-url asks for a preview still', async () => {
  const r = await run('project', 'get', 'p1', '--include-render-url')
  assert.equal(r.query.get('includeRenderUrl'), 'true')
})

test('project apply --include-render-url asks for a preview still of the result', async () => {
  const r = await run('project', 'apply', 'p1', '--ops', '[{"op":"delete_clip","clipId":"c1"}]', '--include-render-url')
  assert.equal(r.body?.includeRenderUrl, true)
})
