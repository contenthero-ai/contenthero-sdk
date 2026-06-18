/**
 * Shared generation plumbing: submit a request, optionally preflight its cost,
 * optionally block until it finishes, and render the result. Used by the
 * `generate`, `upscale`, and `generation` commands so they behave identically.
 *
 * Async contract (mirrors the SDK / MCP): image, video, and upscale return
 * `processing`; audio returns `completed` inline. With --wait (the default) we
 * poll to a terminal state; on timeout we emit the outputId and set exit 4 so
 * the caller can keep polling and still script around it.
 */

import {
  ContentHero,
  GenerationTimeoutError,
  type CostEstimate,
  type GenerateBoardRequest,
  type GenerateRequest,
  type GenerateResult,
  type Generation,
} from '@contenthero/sdk'
import { EXIT } from './errors.js'
import { emit, keyValues } from './output.js'
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
    ['Output id', r.outputId],
    ['Status', r.status],
  ]
  if (r.idempotentReplay) pairs.push(['Idempotent replay', 'yes'])
  if (r.creditsEstimate != null) pairs.push(['Credits', r.creditsEstimate])
  for (const [i, url] of (r.outputUrls ?? []).entries()) pairs.push([`URL ${i + 1}`, url])
  if (r.status === 'processing') {
    pairs.push(['Next', `contenthero generation status ${r.outputId}`])
  }
  return keyValues(pairs)
}

function generationHuman(g: Generation): string {
  const pairs: Array<[string, string | number]> = [
    ['Output id', g.outputId],
    ['Status', g.status],
    ['Model', g.modelId],
    ['Type', g.contentType],
  ]
  if (g.error) pairs.push(['Error', g.error])
  for (const [i, url] of g.outputUrls.entries()) pairs.push([`URL ${i + 1}`, url])
  if (g.status === 'processing' || g.status === 'pending') {
    pairs.push(['Next', `contenthero generation status ${g.outputId}`])
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
  submitted: GenerateResult,
  opts: RunOptions,
): Promise<void> {
  if (submitted.status === 'completed' || !opts.wait) {
    emit(submitted, ctx, resultHuman)
    return
  }
  await waitAndRender(client, ctx, submitted.outputId, opts.timeoutSec)
}

/** Block on one outputId to a terminal state and render it; exit 4 on timeout. */
export async function waitAndRender(
  client: ContentHero,
  ctx: Context,
  outputId: string,
  timeoutSec: number,
): Promise<void> {
  try {
    const gen = await client.waitForGeneration(outputId, { timeoutMs: timeoutSec * 1000 })
    emit(gen, ctx, generationHuman)
  } catch (err) {
    if (err instanceof GenerationTimeoutError) {
      const snapshot = await client.getGeneration(outputId)
      emit(snapshot, ctx, generationHuman)
      process.exitCode = EXIT.TIMEOUT
      return
    }
    throw err
  }
}

export { generationHuman }
