/**
 * THE GUARD: every operation a registry model can perform has a home in the one generate tool of its medium.
 *
 * The agent tools are one per medium (`generate_image`, `generate_video`, `generate_audio`). The registry's model
 * `kind` decides what runs. A kind the registry adds for an image or video model, with no tool that accepts it,
 * would be a Studio picker entry no agent can run, and this test fails first. It asserts, for every
 * (medium, kind) the registry holds for image and video models:
 *   1. the registry fixture's kinds are all in the SDK's kind list, and each has a case below;
 *   2. the medium's MCP tool accepts a model of that kind and sends the matching request;
 *   3. the medium's CLI command accepts a model of that kind and sends the matching request;
 *   4. `get_model`'s routing (`toolForModel`) names that same tool.
 * The app holds the SDK's kind list equal to the registry's `OperationKind` in
 * apps/web/__tests__/api/agent-model-kinds-have-a-home.test.ts.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { MODEL_KINDS, toolForModel } from '@contenthero/sdk'
import { buildServer } from './server.js'
import { buildProgram } from '../../cli/src/program.js'

type Medium = 'image' | 'video'

interface Case {
  medium: Medium
  kind: string
  board?: boolean
  mcp: Record<string, unknown>
  cli: string[]
}

/** One valid call per (medium, kind) the generate tools must accept. Add a row when the registry gains a kind. */
const CASES: Case[] = [
  { medium: 'image', kind: 'generate', mcp: { prompt: 'x' }, cli: ['x'] },
  { medium: 'image', kind: 'generate', board: true, mcp: { boardType: 'character', prompt: 'x' }, cli: ['x', '--type', 'character'] },
  { medium: 'image', kind: 'upscale', mcp: { referenceImages: ['u'], upscaleFactor: '2x' }, cli: ['--ref', 'u', '--upscale-factor', '2x'] },
  { medium: 'image', kind: 'background-removal', mcp: { referenceImages: ['u'] }, cli: ['--ref', 'u'] },
  { medium: 'image', kind: 'layer-separation', mcp: { referenceImages: ['u'] }, cli: ['--ref', 'u'] },
  { medium: 'video', kind: 'generate', mcp: { prompt: 'x' }, cli: ['x'] },
  {
    medium: 'video', kind: 'upscale',
    mcp: { referenceVideos: ['u'], upscaleFactor: '2x', sourceDurationSeconds: 4 },
    cli: ['--ref-video', 'u', '--upscale-factor', '2x', '--source-duration', '4'],
  },
  {
    medium: 'video', kind: 'background-removal',
    mcp: { referenceVideos: ['u'], sourceDurationSeconds: 4 },
    cli: ['--ref-video', 'u', '--source-duration', '4'],
  },
  { medium: 'video', kind: 'lip-sync', mcp: { referenceImages: ['f'], referenceAudio: ['a'] }, cli: ['--ref', 'f', '--ref-audio', 'a'] },
]

function modelFor(c: Case) {
  return {
    modelId: 'guard-model', displayName: 'Guard', contentType: c.medium, kind: c.kind, tags: [], capabilities: { kind: c.kind },
    ...(c.board ? { boardTypes: [{ boardType: 'character', summary: 's' }] } : {}),
  }
}

const snapshot = JSON.parse(readFileSync(new URL('../../../apps/web/__tests__/fixtures/registry-snapshot.json', import.meta.url), 'utf8'))

test('every image and video kind the registry holds is a kind the SDK knows and has a case here', () => {
  const pairs = new Set<string>()
  for (const m of snapshot.models) {
    const medium = m.contentType ?? m.capabilities?.contentType
    const kind = m.kind ?? m.capabilities?.kind
    if ((medium === 'image' || medium === 'video') && kind) pairs.add(`${medium}/${kind}`)
  }
  assert.ok(pairs.size >= 5, `read only ${pairs.size} (medium, kind) pairs from the registry snapshot`)
  const known = new Set<string>(MODEL_KINDS)
  const cased = new Set(CASES.map((c) => `${c.medium}/${c.kind}`))
  for (const pair of pairs) {
    assert.ok(known.has(pair.split('/')[1]!), `${pair}: the registry has a kind the SDK does not list (add it to medium.ts HOMES)`)
    assert.ok(cased.has(pair), `${pair}: the registry has a model of this kind and the guard has no case (give it a home in the generate tool)`)
  }
})

test('the routing table names the medium tool for every case', () => {
  for (const c of CASES) {
    assert.equal(toolForModel(modelFor(c) as never), c.medium === 'image' ? 'generate_image' : 'generate_video', `${c.medium}/${c.kind}`)
  }
})

test('the MCP tool of each medium accepts a model of every kind and sends its operation', async () => {
  for (const c of CASES) {
    const sent: Array<Record<string, unknown>> = []
    const boards: unknown[] = []
    const client = {
      getModel: async () => modelFor(c),
      generate: async (request: Record<string, unknown>) => { sent.push(request); return { outputId: 'o', status: 'processing' } },
      estimateBoardCost: async (request: unknown) => { boards.push(request); return { creditsEstimate: 1 } },
    }
    const server = await buildServer({ getClient: () => client as never })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const mcp = new Client({ name: 'guard', version: '0' })
    await Promise.all([server.connect(a), mcp.connect(b)])
    const name = c.medium === 'image' ? 'generate_image' : 'generate_video'
    const res = await mcp.callTool({ name, arguments: { modelId: 'guard-model', ...c.mcp, ...(c.board ? { getCost: true } : {}) } })
    const text = JSON.stringify(res.content)
    assert.ok(!res.isError, `${name} refused ${c.medium}/${c.kind}${c.board ? ' (board)' : ''}: ${text}`)
    if (c.board) assert.equal(boards.length, 1, `${c.medium}/board took the board route`)
    else {
      assert.equal(sent.length, 1, `${name} ${c.kind} submitted one request`)
      assert.equal(sent[0]!.kind, c.kind)
      assert.equal(sent[0]!.contentType, c.medium)
    }
    await mcp.close()
  }
})

let http: Server
let baseUrl = ''
let current: Case
const seen: Array<{ url: string; body: Record<string, unknown> }> = []

before(async () => {
  http = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') {
      res.end(JSON.stringify(modelFor(current)))
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: JSON.parse(raw) })
      res.end(JSON.stringify({ creditsEstimate: 1, outputId: 'o', status: 'processing' }))
    })
  })
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})
after(() => http.close())

test('the CLI command of each medium accepts a model of every kind and sends its operation', async () => {
  for (const c of CASES) {
    current = c
    seen.length = 0
    await buildProgram().parseAsync(
      ['--api-key', 'k', '--base-url', baseUrl, '--json', 'generate', c.medium, '--model', 'guard-model', ...c.cli, '--cost'],
      { from: 'user' },
    )
    assert.equal(seen.length, 1, `generate ${c.medium} ${c.kind}${c.board ? ' (board)' : ''} sent one request`)
    if (c.board) assert.match(seen[0]!.url, /board/, 'the board route')
    else {
      assert.equal(seen[0]!.body.kind, c.kind, `generate ${c.medium} sent kind ${c.kind}`)
      assert.equal(seen[0]!.body.contentType, c.medium)
    }
  }
})
