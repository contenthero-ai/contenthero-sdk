/**
 * Shared generation plumbing: submit a request, optionally preflight its cost,
 * optionally block until it finishes, and render the result. Used by the
 * `generate`, `upscale`, and `status` commands so they behave identically.
 *
 * Async contract (mirrors the SDK / MCP): image, video, and upscale return
 * `processing`; audio returns `completed` inline. With --wait (the default) we
 * poll to a terminal state; on timeout we emit the outputId and set exit 4 so
 * the caller can keep polling and still script around it.
 */

import {
  ContentHero,
  GenerationFailedError,
  describeReferences,
  type CostEstimate,
  type EditAudioRequest,
  type EditAudioResult,
  type GenerateBoardRequest,
  type GenerateRequest,
  type GenerateResult,
  type Generation,
} from '@contenthero/sdk'
import { EXIT } from './errors.js'
import { costRows, displayId, emit, keyValues, linkRow, statusCommand } from './output.js'
import type { Context } from './context.js'

/** Drop undefined values so the request payload stays minimal. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

/** Build a References object from parts, or undefined when empty. */
export function references(
  parts: GenerateRequest['references'],
): GenerateRequest['references'] | undefined {
  const refs = compact(parts as Record<string, unknown>)
  return Object.keys(refs).length > 0 ? (refs as GenerateRequest['references']) : undefined
}

/** How long a waiting command blocks by default before handing back the outputId (seconds). */
export const DEFAULT_TIMEOUT_SEC = 600

export interface RunOptions {
  cost: boolean
  wait: boolean
  /** Wait timeout in seconds. */
  timeoutSec: number
}

function costHuman(est: CostEstimate): string {
  return keyValues([
    ['Estimated cost', `${est.creditsEstimate} credits`],
    ...((est.modelId ? [['Model', est.modelId] as [string, string]] : [])),
    ...((est.contentType ? [['Type', est.contentType] as [string, string]] : [])),
  ])
}

function resultHuman(r: GenerateResult): string {
  const pairs: Array<[string, string | number]> = [
    ['Output id', displayId({ id: r.outputId, shortId: r.shortId })],
    ...linkRow(r),
    ['Status', r.status],
  ]
  if (r.idempotentReplay) pairs.push(['Idempotent replay', 'yes'])
  pairs.push(...costRows(r.charge))
  // Each output by its media id, the name to pass back; nothing is numbered by position (7.44).
  for (const o of r.outputs ?? []) pairs.push([o.mediaId, o.url ?? o.status])
  if (r.status === 'processing') {
    pairs.push(['Next', statusCommand([{ id: r.outputId, shortId: r.shortId, kind: 'output' }])])
  }
  return keyValues(pairs)
}

function generationHuman(g: Generation): string {
  const pairs: Array<[string, string | number]> = [
    ['Output id', displayId({ id: g.outputId, shortId: g.shortId })],
    ...linkRow(g),
    ['Status', g.status],
    ['Model', g.modelId],
    ['Type', g.contentType],
  ]
  if (g.error) pairs.push(['Error', g.error])
  // An import whose bytes were already in the account: nothing new, so say where they already are.
  if (g.alreadyExisted) {
    pairs.push(['Already in your account', g.alreadyExisted.outputId ?? g.alreadyExisted.objectName])
    pairs.push(['URL', g.alreadyExisted.url])
  }
  for (const o of g.outputs ?? []) pairs.push([o.mediaId, o.url ?? o.status])
  // What it was made FROM, in the words the MCP and Studio use.
  for (const r of describeReferences(g.references)) pairs.push(['Made from', r])
  pairs.push(...costRows(g.charge))
  if (g.status === 'processing' || g.status === 'pending') {
    pairs.push(['Next', statusCommand([{ id: g.outputId, shortId: g.shortId, kind: 'output' }])])
  }
  return keyValues(pairs)
}

/** Preflight a generation's cost and render the estimate. */
async function emitCost(
  client: ContentHero,
  ctx: Context,
  request: GenerateRequest | GenerateBoardRequest,
  isBoard: boolean,
): Promise<void> {
  const est = isBoard
    ? await client.estimateBoardCost(request as GenerateBoardRequest)
    : await client.estimateCost(request as GenerateRequest)
  emit(est, ctx, costHuman)
}

/**
 * Submit a generation (or board) and render it. Honors --cost (preflight only),
 * --wait (poll to terminal, the default), and --no-wait (return the submission).
 */
export async function runGeneration(
  client: ContentHero,
  ctx: Context,
  request: GenerateRequest,
  opts: RunOptions,
): Promise<void> {
  if (opts.cost) return emitCost(client, ctx, request, false)
  const submitted = await client.generate(request)
  await renderSubmission(client, ctx, submitted, opts)
}

/**
 * Same as runGeneration, for the edit_audio pipeline (existing audio -> audio).
 * Isolation returns `completed` inline; --cost previews without running.
 */
export async function runEditAudio(
  client: ContentHero,
  ctx: Context,
  request: EditAudioRequest,
  opts: RunOptions,
): Promise<void> {
  if (opts.cost) {
    const est = await client.estimateEditAudioCost(request)
    emit(est, ctx, costHuman)
    return
  }
  const submitted = await client.editAudio(request)
  await renderSubmission(client, ctx, submitted, opts)
}

/** Same as runGeneration, for the Reference Board pipeline. */
export async function runBoard(
  client: ContentHero,
  ctx: Context,
  request: GenerateBoardRequest,
  opts: RunOptions,
): Promise<void> {
  if (opts.cost) return emitCost(client, ctx, request, true)
  const submitted = await client.generateBoard(request)
  await renderSubmission(client, ctx, submitted, opts)
}

/** Render a submission, polling to terminal when --wait and still processing. */
async function renderSubmission(
  client: ContentHero,
  ctx: Context,
  submitted: GenerateResult | EditAudioResult,
  opts: RunOptions,
): Promise<void> {
  if (submitted.status === 'completed' || !opts.wait) {
    emit(submitted, ctx, resultHuman)
    return
  }
  await waitAndRender(client, ctx, submitted, opts.timeoutSec)
}

/**
 * Render an in-place clip enhancement, which is one job per SOURCE rather than one job.
 *
 * Waits on EVERY outputId, not just the first. Waiting on one would report the whole edit as finished when a
 * single recording had landed, while the others were still running and their clips still untouched.
 *
 * A `noop` is emitted as-is rather than treated as an error: a selection with no audible audio is a real,
 * correct answer, and the server explains which case it was.
 */
export async function renderEnhanceClips(
  client: ContentHero,
  ctx: Context,
  result: EditAudioResult,
  opts: { wait: boolean; timeoutSec: number },
): Promise<void> {
  const jobs = result.jobs ?? []
  if (jobs.length === 0 || !opts.wait) {
    emit(result, ctx, enhanceClipsHuman)
    return
  }
  emit(result, ctx, enhanceClipsHuman)
  for (const job of jobs) {
    await waitAndRender(client, ctx, job, opts.timeoutSec)
  }
}

/** Human rendering for an in-place enhancement submission. */
function enhanceClipsHuman(result: EditAudioResult): string {
  const jobs = result.jobs ?? []
  if (jobs.length === 0) return result.note ?? 'Nothing to enhance: no audible clips in that selection.'
  const lines = jobs.map(
    (j, i) =>
      `  ${i + 1}. ${displayId({ id: j.outputId, shortId: j.shortId })}  ${j.clipIds.length} clip${j.clipIds.length === 1 ? '' : 's'}, ` +
      `${j.windows} window${j.windows === 1 ? '' : 's'}${j.appUrl ? `  ${j.appUrl}` : ''}`,
  )
  const head =
    jobs.length === 1
      ? 'Enhancing 1 source:'
      : `Enhancing ${jobs.length} sources as separate jobs (a noise profile is estimated per recording):`
  const tail = result.silencedClipsExcluded
    ? `\n${result.silencedClipsExcluded} silenced clip${result.silencedClipsExcluded === 1 ? '' : 's'} skipped.`
    : ''
  const wait = `Wait: ${statusCommand(jobs.map((j) => ({ id: j.outputId, shortId: j.shortId, kind: 'output' as const })))}`
  return `${head}\n${lines.join('\n')}\nThe enhanced audio is applied to the clips automatically as each job lands.${tail}\n${wait}`
}

/** Block on one submitted job to a terminal state and render it; exit 4 on timeout. */
export async function waitAndRender(
  client: ContentHero,
  ctx: Context,
  submitted: { outputId: string; shortId?: string; appUrl?: string },
  timeoutSec: number,
): Promise<void> {
  const { outputId } = submitted
  try {
    const gen = await client.waitForGeneration(outputId, { timeoutMs: timeoutSec * 1000 })
    emit(gen, ctx, generationHuman)
  } catch (err) {
    // A generation that reached this function was SUBMITTED: it is running and charged.
    // Whether we timed out or a poll hit a transient error, the job is not lost, so emit
    // what we know (with its outputId) and exit TIMEOUT rather than throwing. Throwing
    // would print an error for a live generation and invite the user to run it again,
    // paying twice. A GenerationFailedError is terminal and still propagates.
    if (err instanceof GenerationFailedError) throw err
    try {
      const snapshot = await client.getGeneration(outputId)
      emit(snapshot, ctx, generationHuman)
    } catch {
      // Even the snapshot failed. Surface the id itself so the run is still resumable.
      emit({ outputId, shortId: submitted.shortId, appUrl: submitted.appUrl, status: 'processing' } as unknown as Generation, ctx, generationHuman)
    }
    process.exitCode = EXIT.TIMEOUT
    return
  }
}

export { generationHuman }
