/**
 * Every answer that starts or finishes a background job names the job by an id `get_status` takes, and its link.
 *
 * ## The defect class this holds (found live 2026-10-10)
 *
 * `export_project`, when the export finished inside the call, answered with the delivered file and nothing that named
 * the export: an agent could not follow it up, link it or read it with `get_export`. The survey behind this test found
 * the same class wider: a still-running generation, import, edit or editor effect named its job by a full UUID in a
 * `get_status` call with no kind, which the status route refuses, and most pending answers dropped the job's link even
 * when the start returned one.
 *
 * ## What it runs
 *
 * The real SDK over a fake server, so the rule is held where the ids come from (each start and each status read) and
 * where they are read (each tool's answer). Every job-starting tool is driven down both paths: finished within the
 * call and still running. Each answer must name the job's short id and its link, and every `get_status` call it
 * prints must be one the route accepts: short ids alone, or a full id with its kind.
 *
 * ## Holding the class, not the cases
 *
 * A tool whose description names `get_status` starts or follows a job, so it must have a case here: adding one
 * without a case turns the coverage test red. Tools that start a job without naming the wait in their description are
 * listed by hand in `CASES`.
 *
 * Break-verified: printing the export's file without its id (the 2026-10-10 answer), dropping `kind` from a pending
 * generation's call, or dropping the job's link from a pending answer each turns this red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ContentHero } from '@contenthero/sdk'
import { buildServer } from './server.js'

const APP = 'https://app.test'
const UUID = (n: number) => `5f0c7e1a-1111-4a2b-9c3d-${String(n).padStart(12, '0')}`

/** One job as the server names it: its full id, its short id and its link. */
interface Job {
  id: string
  shortId: string
  appUrl: string
}
const job = (n: number, shortId: string, noun: string): Job => ({ id: UUID(n), shortId, appUrl: `${APP}/${noun}/${shortId}` })

const OUTPUT = job(1, 'Gen12345', 'media')
const EXPORT = job(2, 'Exp12345', 'exports')
const POST = job(3, 'Pst12345', 'content')
const AVATAR = job(4, 'Avt12345', 'avatars')
const KIT = job(5, 'Kit12345', 'brand-kits')
const TRANSCRIPT = job(6, 'Trn12345', 'media')
/** An editor effect's output: its record, and so its short id, is written when the job runs. */
const EFFECT = { id: UUID(7), appUrl: `${APP}/media/${UUID(7)}` }

type Path = 'finished' | 'pending'

function generation(state: 'completed' | 'processing', contentType = 'image'): Record<string, unknown> {
  return {
    outputId: OUTPUT.id,
    shortId: OUTPUT.shortId,
    appUrl: OUTPUT.appUrl,
    status: state,
    contentType,
    modelId: 'test-model',
    outputs:
      state === 'completed'
        ? [{ mediaId: `${OUTPUT.shortId}-1`, status: 'succeeded', url: 'https://media.contenthero.ai/a.png', appUrl: `${OUTPUT.appUrl}-1` }]
        : [],
    error: null,
    createdAt: 't',
    completedAt: state === 'completed' ? 't2' : null,
  }
}

function exportJob(status: 'completed' | 'rendering'): Record<string, unknown> {
  return {
    exportId: EXPORT.id,
    shortId: EXPORT.shortId,
    appUrl: EXPORT.appUrl,
    status,
    progress: status === 'completed' ? 1 : 0.4,
    ...(status === 'completed' ? { outputUrl: 'https://media.contenthero.ai/e.mp4', shareUrl: `${APP}/share/x` } : {}),
  }
}

/** The fake server: each route answers as the app does, finished or still running. */
function server(path: Path) {
  const done = path === 'finished'
  return (method: string, url: URL, body: Record<string, unknown>): unknown => {
    const p = url.pathname
    if (method === 'GET' && p.startsWith('/api/v1/models/')) return { id: 'test-model', contentType: 'image', kind: 'upscale', capabilities: {} }
    if (method === 'POST' && p === '/api/v1/studio/generate') {
      if (body.contentType === 'audio') return { ...generation('completed', 'audio'), status: 'completed' }
      return { outputId: OUTPUT.id, shortId: OUTPUT.shortId, appUrl: OUTPUT.appUrl, status: 'processing' }
    }
    if (method === 'POST' && p === '/api/v1/studio/reference-board') {
      return { outputId: OUTPUT.id, shortId: OUTPUT.shortId, appUrl: OUTPUT.appUrl, status: 'processing' }
    }
    if (method === 'POST' && p === '/api/v1/studio/audio/edit') {
      if (body.clipIds || body.enhanceClips) {
        return {
          outputId: OUTPUT.id,
          status: 'processing',
          projectId: 'p1',
          jobs: [{ outputId: OUTPUT.id, shortId: OUTPUT.shortId, appUrl: OUTPUT.appUrl, clipIds: ['c1'], windows: 1 }],
        }
      }
      if (body.operation === 'isolate') return { ...generation('completed', 'audio'), status: 'completed' }
      return { outputId: OUTPUT.id, shortId: OUTPUT.shortId, appUrl: OUTPUT.appUrl, status: 'processing' }
    }
    if (method === 'POST' && p === '/api/v1/media/imports') {
      return { outputId: OUTPUT.id, shortId: OUTPUT.shortId, appUrl: OUTPUT.appUrl, status: 'processing' }
    }
    if (method === 'POST' && p === '/api/v1/studio/transcribe') {
      return { outputId: TRANSCRIPT.id, shortId: TRANSCRIPT.shortId, appUrl: TRANSCRIPT.appUrl, status: 'completed', transcript: 'hi', language: 'en', wordCount: 1, durationSeconds: 1 }
    }
    if (method === 'POST' && /^\/api\/v1\/projects\/[^/]+\/export$/.test(p)) {
      // A file the server makes at once (subtitles, a transcript) is finished in the start's own answer.
      if (body.format === 'srt') return exportJob('completed')
      return exportJob('rendering')
    }
    if (method === 'GET' && p.startsWith('/api/v1/exports/')) return exportJob(done ? 'completed' : 'rendering')
    if (method === 'POST' && /^\/api\/v1\/content\/[^/]+\/analysis$/.test(p)) {
      const handle = { contentId: POST.id, shortId: POST.shortId, appUrl: POST.appUrl }
      if (body.kind === 'scenes') return { ...handle, kind: 'scenes', scenes: done ? { status: 'complete', sceneCount: 3 } : { status: 'running' } }
      return { ...handle, analysis: done ? { status: 'complete', sections: [], data: {} } : { status: 'running' } }
    }
    if (method === 'POST' && p === '/api/v1/avatars') {
      return {
        avatar: { id: AVATAR.id, shortId: AVATAR.shortId, appUrl: AVATAR.appUrl, name: 'Mika', imageUrl: null, status: 'processing', looks: [] },
        status: 'processing',
      }
    }
    if (method === 'POST' && p === '/api/v1/brand-kits') {
      return {
        brandKit: { id: KIT.id, shortId: KIT.shortId, appUrl: KIT.appUrl, name: 'Kit', isDefault: false, brandAccounts: [], inspirationAccounts: [] },
        import: { extract: { status: 'queued' } },
      }
    }
    if (method === 'POST' && p === '/api/v1/editor/ops') {
      return {
        revision: 2,
        results: [{ op: 'remove_background', opId: 'o1', ok: true, generatingOutputId: EFFECT.id, generatingAppUrl: EFFECT.appUrl }],
      }
    }
    if (method === 'GET' && p.startsWith('/api/v1/status/')) {
      const id = decodeURIComponent(p.split('/').pop() as string)
      const kind = url.searchParams.get('kind')
      if (kind === 'export' || id === EXPORT.shortId || id === EXPORT.id) {
        return { kind: 'export', id: EXPORT.shortId, state: done ? 'completed' : 'processing', reason: null, appUrl: EXPORT.appUrl, progress: done ? 1 : 0.4, detail: exportJob(done ? 'completed' : 'rendering') }
      }
      if (kind === 'content' || kind === 'scenes') {
        return { kind, id: POST.shortId, state: done ? 'completed' : 'processing', reason: null, appUrl: POST.appUrl, progress: null, detail: { status: done ? 'complete' : 'running' } }
      }
      const gen = generation(done ? 'completed' : 'processing')
      return { kind: 'output', id: OUTPUT.shortId, state: done ? 'completed' : 'processing', reason: null, appUrl: OUTPUT.appUrl, progress: null, detail: gen }
    }
    throw new Error(`The fake server has no route for ${method} ${p}`)
  }
}

async function connect(path: Path): Promise<Client> {
  const answer = server(path)
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = answer(init?.method ?? 'GET', url, body)
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const client = new ContentHero({ apiKey: 'ch_live_test', fetch, baseUrl: 'https://api.test' })
  const mcp = await buildServer({ getClient: () => client, jobWait: { waitMs: 200, pollMs: 50 } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const caller = new Client({ name: 'test', version: '0' })
  await Promise.all([mcp.connect(b), caller.connect(a)])
  return caller
}

/** Each `get_status { ids: [...], kind? }` call an answer prints. */
function statusCalls(text: string): Array<{ ids: string[]; kind: string | null }> {
  return [...text.matchAll(/get_status \{ ids: \[([^\]]*)\](?:, kind: "([a-z_]+)")? \}/g)].map((m) => ({
    ids: [...(m[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1] as string),
    kind: m[2] ?? null,
  }))
}

const SHORT_ID = /^[A-Za-z0-9]{8}$/

interface Case {
  tool: string
  args: Record<string, unknown>
  /** The job the answer must name: its short id where it has one, else its full id, and its link. */
  names: { id: string; appUrl: string }
  /** Which paths this tool has. A tool that always finishes in the call, or never does, has one. */
  paths: Path[]
}

const CASES: Case[] = [
  { tool: 'generate_image', args: { modelId: 'test-model', prompt: 'a cat' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['pending'] },
  { tool: 'generate_video', args: { modelId: 'test-model', prompt: 'a cat' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['pending'] },
  { tool: 'generate_lip_sync', args: { modelId: 'test-model', imageUrl: 'https://media.contenthero.ai/f.png', audioUrl: 'https://media.contenthero.ai/a.mp3' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['pending'] },
  { tool: 'upscale', args: { modelId: 'test-model', sourceUrl: 'https://media.contenthero.ai/a.png', factor: '2x' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['pending'] },
  { tool: 'generate_audio', args: { modelId: 'test-model', text: 'hello' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['finished'] },
  { tool: 'generate_board', args: { boardType: 'character', prompt: 'a cat' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'edit_audio', args: { operation: 'enhance', sourceUrl: 'https://media.contenthero.ai/a.mp3' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['pending'] },
  { tool: 'edit_audio', args: { projectId: 'p1', enhanceClips: true }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['pending'] },
  { tool: 'import_media', args: { url: 'https://example.com/a.png' }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'transcribe', args: { audioUrl: 'https://media.contenthero.ai/a.mp3' }, names: { id: TRANSCRIPT.shortId, appUrl: TRANSCRIPT.appUrl }, paths: ['finished'] },
  // The 2026-10-10 case: a picture or sound export that finished inside the call is drawn by the card, and still named.
  { tool: 'export_project', args: { projectId: 'p1', format: 'mp4' }, names: { id: EXPORT.shortId, appUrl: EXPORT.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'export_project', args: { projectId: 'p1', format: 'srt' }, names: { id: EXPORT.shortId, appUrl: EXPORT.appUrl }, paths: ['finished'] },
  { tool: 'get_export', args: { exportId: EXPORT.shortId }, names: { id: EXPORT.shortId, appUrl: EXPORT.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'analyze_content', args: { contentId: POST.shortId }, names: { id: POST.shortId, appUrl: POST.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'analyze_content', args: { contentId: POST.shortId, kind: 'scenes' }, names: { id: POST.shortId, appUrl: POST.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'create_avatar', args: { name: 'Mika', age: '20s', gender: 'female' }, names: { id: AVATAR.shortId, appUrl: AVATAR.appUrl }, paths: ['pending'] },
  { tool: 'create_brand_kit', args: { name: 'Kit', websiteUrls: ['https://example.com'], extract: true }, names: { id: KIT.shortId, appUrl: KIT.appUrl }, paths: ['pending'] },
  // An editor effect's job has no record, and so no short id, until it runs: its full id with kind output names it.
  { tool: 'update_timeline', args: { projectId: 'p1', userIntent: 'cut out', ops: [{ op: 'remove_background', clipId: 'c1' }] }, names: { id: EFFECT.id, appUrl: EFFECT.appUrl }, paths: ['pending'] },
  { tool: 'update_canvas', args: { projectId: 'p1', userIntent: 'cut out', ops: [{ op: 'remove_background', layerId: 'l1' }] }, names: { id: EFFECT.id, appUrl: EFFECT.appUrl }, paths: ['pending'] },
  { tool: 'get_status', args: { ids: [OUTPUT.shortId], wait: false }, names: { id: OUTPUT.shortId, appUrl: OUTPUT.appUrl }, paths: ['finished', 'pending'] },
  { tool: 'get_status', args: { ids: [OUTPUT.shortId, EXPORT.shortId], wait: false }, names: { id: EXPORT.shortId, appUrl: EXPORT.appUrl }, paths: ['finished', 'pending'] },
]

/** Tools that read jobs other tools started and are held elsewhere: a listing names every job it lists the same way. */
const READS_ONLY: readonly string[] = ['list_exports']

for (const c of CASES) {
  for (const path of c.paths) {
    test(`${c.tool} ${JSON.stringify(c.args).slice(0, 60)} (${path}) names its job by an id get_status takes, with its link`, async () => {
      const mcp = await connect(path)
      const res = (await mcp.callTool({ name: c.tool, arguments: c.args })) as { content: Array<{ type: string; text?: string }>; isError?: boolean }
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      assert.ok(!res.isError, `${c.tool} answered an error: ${text}`)
      assert.ok(text.includes(c.names.id), `${c.tool} (${path}) does not name its job ${c.names.id}:\n${text}`)
      assert.ok(text.includes(c.names.appUrl), `${c.tool} (${path}) does not give its job's link ${c.names.appUrl}:\n${text}`)
      const calls = statusCalls(text)
      if (path === 'pending' && c.tool !== 'get_status') {
        assert.ok(calls.length > 0, `${c.tool} is still running and does not say how to wait for it:\n${text}`)
      }
      for (const call of calls) {
        for (const id of call.ids) {
          assert.ok(SHORT_ID.test(id) || call.kind, `${c.tool} (${path}) prints a get_status call the route refuses: "${id}" is a full id with no kind:\n${text}`)
        }
      }
    })
  }
}

test('every tool that names get_status in its description has a case here', async () => {
  const mcp = await connect('finished')
  const { tools } = await mcp.listTools()
  const waiting = tools.filter((t) => /get_status/.test(t.description ?? '')).map((t) => t.name)
  const covered = new Set([...CASES.map((c) => c.tool), ...READS_ONLY])
  const missing = waiting.filter((name) => !covered.has(name))
  assert.deepEqual(missing, [], `these tools start or follow a job and have no case: ${missing.join(', ')}`)
})
