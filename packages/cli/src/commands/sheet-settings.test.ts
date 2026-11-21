import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/**
 * A reference sheet's panel count and aspect ratio: the flags reach the wire, a model that is not a sheet refuses
 * the count, and `model get` prints the range and each type's defaults from what the server reports.
 */
type Seen = { method: string; path: string; body: Record<string, unknown> | null }
let server: Server
let baseUrl = ''
const seen: Seen[] = []

const SHEET = {
  modelId: 'reference-sheets', displayName: 'Reference Sheets', contentType: 'image', kind: 'generate', tags: [],
  capabilities: { kind: 'generate', outputType: 'image', promptMode: 'optional', inputTypes: ['imageRef'], panelCount: { min: 2, max: 7 }, aspectRatio: { supported: ['3:4', '16:9'], default: '3:4' } },
  sheetTypes: [{ sheetType: 'alpha', label: 'Alpha', summary: 'for alpha', defaultPanelCount: 4, defaultAspectRatio: '3:4' }],
}
const PLAIN = { modelId: 'plain', displayName: 'Plain', contentType: 'image', kind: 'generate', tags: [], capabilities: {} }

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      res.setHeader('content-type', 'application/json')
      if (req.method === 'GET' && /^\/api\/v1\/models\/[^/]+$/.test(url.pathname)) {
        res.end(JSON.stringify(url.pathname.endsWith('reference-sheets') ? SHEET : PLAIN))
        return
      }
      seen.push({ method: req.method ?? '', path: url.pathname, body: raw ? JSON.parse(raw) : null })
      res.end(JSON.stringify({}))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function run(...args: string[]): Promise<string> {
  seen.length = 0
  const lines: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((c: string | Uint8Array) => (lines.push(String(c)), true)) as typeof process.stdout.write
  try {
    await buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--human', ...args], { from: 'user' })
  } finally {
    process.stdout.write = orig
  }
  return lines.join('')
}

test('generate image sends --panel-count and --aspect to the sheet route', async () => {
  await run('generate', 'image', '-m', 'reference-sheets', '--type', 'alpha', '--panel-count', '3', '--aspect', '16:9', '--cost', 'a lamp').catch(() => undefined)
  const sheet = seen.find((s) => s.path === '/api/v1/studio/reference-sheet')
  assert.ok(sheet, 'the sheet route was called')
  assert.equal(sheet.body?.panelCount, 3)
  assert.equal(sheet.body?.aspectRatio, '16:9')
})

test('a ratio the sheet model does not offer is refused before any request', async () => {
  await assert.rejects(
    run('generate', 'image', '-m', 'reference-sheets', '--type', 'alpha', '--aspect', '1:1', '--cost', 'a lamp'),
    /offers the aspect ratios 3:4, 16:9, not 1:1/,
  )
  assert.equal(seen.length, 0)
})

test('a model that is not a sheet refuses --panel-count', async () => {
  await assert.rejects(run('generate', 'image', '-m', 'plain', '--panel-count', '3', '--cost', 'a lamp'), /panelCount/)
  assert.equal(seen.length, 0)
})

test('model get prints the panel range, the type defaults and the ratios', async () => {
  const out = await run('model', 'get', 'reference-sheets')
  assert.match(out, /panels on a sheet: 2 to 7/)
  assert.match(out, /alpha \(for alpha; default 4 panels, 3:4\)/)
  assert.match(out, /3:4, 16:9/)
})
