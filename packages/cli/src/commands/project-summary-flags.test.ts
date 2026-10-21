import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * `project get` shows a muted track, a hidden track and a disabled clip exactly when the summary sets them, and omits
 * them otherwise, as the MCP's get_project does. The CLI's default output is the project as the API sent it, so the
 * flags reach a script untouched; `--human` prints no composition for a whole read.
 * Break-verified: dropping `muted` from the music track below turns the first assertion red.
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

const clip = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'video', from: 0, durationInFrames: 30, trackId: 't', ...extra })

async function projectGet(tracks: unknown[]): Promise<{ tracks: Array<Record<string, any>> }> {
  body = { project: { id: 'p1', title: 'Rough cut', type: 'editor', revision: 7, width: 1920, height: 1080, groups: [], state: { tracks } } }
  const { stdout } = await run(process.execPath, ['--import', 'tsx', entry, '--api-key', 'k', '--base-url', baseUrl, 'project', 'get', 'p1'], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  return (JSON.parse(stdout) as { state: { tracks: Array<Record<string, any>> } }).state
}

test('the flags show exactly when set', async () => {
  const { tracks } = await projectGet([
    { id: 'main', name: 'Main', trackType: 'media', isPrimary: true, items: [clip('a'), clip('b', { disabled: true })] },
    { id: 'music', name: 'Music', trackType: 'audio', muted: true, items: [] },
    { id: 'over', name: 'Overlay', trackType: 'media', hidden: true, items: [] },
  ])
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]))
  assert.equal(byId.music.muted, true)
  assert.equal(byId.over.hidden, true)
  assert.equal(byId.main.items[1].disabled, true)
})

test('a project with none of them shows none', async () => {
  const { tracks } = await projectGet([{ id: 'main', name: 'Main', trackType: 'media', isPrimary: true, items: [clip('a')] }])
  assert.equal('muted' in tracks[0]! || 'hidden' in tracks[0]!, false)
  assert.equal('disabled' in tracks[0]!.items[0], false)
})
