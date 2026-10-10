import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/**
 * `contenthero schema get effect [--name n]` (motion graphics 7.25, 7.37): the CLI twin of the MCP's get_schema kind
 * 'effect'. Without a name it reads the effect catalog, with one it reads that effect in full, and --name on any other
 * kind is refused rather than ignored. Each case runs the real command against a local server.
 */

let server: Server
let baseUrl = ''
const seen: string[] = []

before(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ effects: [], codeHosts: ['Solid'], name: 'glow', params: {}, defaults: {}, keyframeable: [] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

const run = (...args: string[]) =>
  buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })

test('schema get effect reads the catalog, and --name reads one effect', async () => {
  seen.length = 0
  await run('schema', 'get', 'effect')
  await run('schema', 'get', 'effect', '--name', 'light leak')
  assert.deepEqual(seen, ['/api/v1/editor/effects', '/api/v1/editor/effects?name=light%20leak'])
})

// The timeline schema reads in two steps (2026-10-09), as the MCP's get_schema does.
test('schema get timeline reads the index, --name one entry, and --detail full the whole', async () => {
  seen.length = 0
  await run('schema', 'get', 'timeline')
  await run('schema', 'get', 'timeline', '--name', 'update_clip')
  await run('schema', 'get', 'timeline', '--detail', 'full')
  assert.deepEqual(seen, ['/api/v1/editor/timeline-types', '/api/v1/editor/timeline-types?name=update_clip', '/api/v1/editor/timeline-types?detail=full'])
})

// The canvas schema reads in the same two steps (2026-10-10).
test('schema get layer reads the index, --name one entry, and --detail full the whole', async () => {
  seen.length = 0
  await run('schema', 'get', 'layer')
  await run('schema', 'get', 'layer', '--name', 'create_layer')
  await run('schema', 'get', 'layer', '--detail', 'full')
  assert.deepEqual(seen, ['/api/v1/editor/layer-types', '/api/v1/editor/layer-types?name=create_layer', '/api/v1/editor/layer-types?detail=full'])
})

test('--name on another kind is refused, and nothing is asked', async () => {
  seen.length = 0
  await assert.rejects(() => run('schema', 'get', 'export', '--name', 'glow'), /kind export takes no --name; it belongs to kinds effect, timeline and layer\./)
  await assert.rejects(() => run('schema', 'get', 'export', '--detail', 'full'), /kind export takes no --detail; it belongs to kinds timeline and layer\./)
  await assert.rejects(() => run('schema', 'get', 'timeline', '--detail', 'summary'), /Unknown --detail "summary"\. The only value is full\./)
  assert.deepEqual(seen, [])
})
