import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildProgram } from '../program.js'

/**
 * `contenthero schema effect [--name n]` (motion graphics 7.25, 7.37): the CLI twin of the MCP's get_schema kind
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
    res.end(JSON.stringify({ effects: [], graphicHosts: ['Solid'], name: 'glow', params: {}, defaults: {}, keyframeable: [] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

const run = (...args: string[]) =>
  buildProgram().parseAsync(['--api-key', 'k', '--base-url', baseUrl, '--json', ...args], { from: 'user' })

test('schema effect reads the catalog, and --name reads one effect', async () => {
  seen.length = 0
  await run('schema', 'effect')
  await run('schema', 'effect', '--name', 'light leak')
  assert.deepEqual(seen, ['/api/v1/editor/effects', '/api/v1/editor/effects?name=light%20leak'])
})

test('--name on another kind is refused, and nothing is asked', async () => {
  seen.length = 0
  await assert.rejects(() => run('schema', 'timeline', '--name', 'glow'), /kind timeline takes no --name; it belongs to kind effect\./)
  assert.deepEqual(seen, [])
})
