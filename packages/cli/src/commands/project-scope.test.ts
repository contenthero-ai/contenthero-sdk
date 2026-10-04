import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * `project get` says when its state is part of the document, in the same sentence the MCP's get_project gives.
 *
 * Run as a real process under --human: the summary is written to stdout, which inside the test runner is also the report
 * stream.
 * Break-verified: dropping the scope line from the `project get` summary turns the first red.
 */

const run = promisify(execFile)
const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')
let body: unknown = {}
let server: Server
let baseUrl = ''

before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

const project = { id: 'p1', title: 'Rough cut', type: 'editor', revision: 7, width: 1920, height: 1080, groups: [] }

async function projectGet(...flags: string[]): Promise<string> {
  const { stdout } = await run(process.execPath, ['--import', 'tsx', entry, '--human', '--api-key', 'k', '--base-url', baseUrl, 'project', 'get', 'p1', ...flags], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  return stdout
}

test('a windowed read says it is part of the project', async () => {
  body = { project: { ...project, scope: { fromFrame: 600, toFrame: 629, trackId: 'main' } } }
  const out = await projectGet('--detail', 'full', '--from', '600', '--to', '629', '--track', 'main')
  assert.match(out, /Scoped read \(frames 600 to 629, track main\): the state is that part of the project, not all of it\./)
})

test('a whole read says nothing about scope', async () => {
  body = { project }
  const out = await projectGet()
  assert.match(out, /Project p1 "Rough cut"/)
  assert.doesNotMatch(out, /Scoped read/)
})
