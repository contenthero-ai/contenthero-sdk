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
