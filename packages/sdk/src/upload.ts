/**
 * The one-call upload: begin, send the bytes in whichever mode the server chose, complete.
 *
 * ## What this knows and what it does not
 *
 * The server decides how a file is uploaded (`CreateUploadResult.upload.mode`), and this module follows its answer:
 * a single PUT, or parts of the size the server stated, each signed on demand. No part size, part count or limit is
 * written here. The three bounds below are this client's own behavior (how many parts it sends at once, how often it
 * tries a part, how long it waits between tries), not a copy of anything the server enforces.
 *
 * ## Why parts are signed one at a time, just before they are sent
 *
 * A part's URL is a temporary write permission. Signing it right before its PUT means a slow upload, a paused one or
 * a retry never finds a dead URL: a failed part simply asks again. It is also what makes resuming cheap: only the
 * parts still missing are ever signed.
 */

import { ContentHeroError } from './errors.js'
import type {
  AbortUploadResult,
  CompletedUploadPart,
  CreateUploadInput,
  CreateUploadResult,
  SignedUploadPart,
  UploadOptions,
  UploadProgress,
  UploadedMedia,
  UploadTarget,
} from './types.js'

/** Parts sent at once. */
export const UPLOAD_PART_CONCURRENCY = 4

/** Tries per part (and for the completion) before the upload fails. */
export const UPLOAD_ATTEMPTS = 4

/** Wait before the first retry; doubled for each one after. */
export const UPLOAD_RETRY_DELAY_MS = 500

/** What the one-call upload needs from the client; the client supplies its own methods. */
export interface UploadDeps {
  createUpload(input: CreateUploadInput): Promise<CreateUploadResult>
  signUploadParts(outputId: string, partNumbers: number[]): Promise<SignedUploadPart[]>
  completeUpload(outputId: string, parts?: CompletedUploadPart[]): Promise<UploadedMedia>
  abortUpload(outputId: string): Promise<AbortUploadResult>
  /** PUT to the store. Resolves on success; rejects with a `ContentHeroError` carrying the status when the store refused. */
  put(url: string, headers: Record<string, string>, body: BodyInit, signal?: AbortSignal): Promise<Response>
  /** Tell the client's response listeners that this upload failed, as any failed request is told. */
  failed(): void
}

type UploadData = Blob | ArrayBuffer | ArrayBufferView

/** The size of what is being uploaded. */
export function sizeOf(data: UploadData): number {
  return data instanceof Blob ? data.size : data.byteLength
}

/** The bytes from `start` up to `end`, without copying where the input allows it. */
function sliceOf(data: UploadData, start: number, end: number): BodyInit {
  if (data instanceof Blob) return data.slice(start, end)
  if (data instanceof ArrayBuffer) return new Uint8Array(data, start, end - start)
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset + start, end - start)
}

/**
 * Read the answer of beginning an upload. An older API answers with the single-upload fields at the top level and no
 * `upload`; that is read as a single target, which is what lets the SDK and the API deploy in either order.
 */
export function readCreateUpload(raw: unknown, contentType: string): CreateUploadResult {
  const answer = (raw ?? {}) as {
    outputId?: string
    upload?: UploadTarget
    uploadUrl?: string
    uploadHeaders?: Record<string, string>
    expiresAt?: string
  }
  if (typeof answer.outputId !== 'string') {
    throw new ContentHeroError('The server answered a new upload without an output id. Try again, and if it keeps failing contact support.')
  }
  if (answer.upload) return { outputId: answer.outputId, upload: answer.upload }
  if (typeof answer.uploadUrl === 'string') {
    return {
      outputId: answer.outputId,
      upload: {
        mode: 'single',
        url: answer.uploadUrl,
        // An API that returns no headers needs the content type alone.
        headers: answer.uploadHeaders ?? { 'Content-Type': contentType },
        expiresAt: answer.expiresAt ?? '',
      },
    }
  }
  throw new ContentHeroError('The server answered a new upload without a target for its bytes. Try again, and if it keeps failing contact support.')
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Whether trying again can help. A refused request that names a problem with the request itself (bad input, no
 * permission, not found, gone) will be refused again; a dropped connection, a busy server or an expired signature
 * will not. `expiredSignature` is true for the store's own answers, where a 403 means the URL went stale, which
 * signing again fixes.
 */
function retryable(err: unknown, expiredSignature: boolean): boolean {
  if (isAbort(err)) return false
  if (err instanceof ContentHeroError) {
    const s = err.status
    if (s === undefined) return false
    return s >= 500 || s === 408 || s === 429 || (expiredSignature && s === 403)
  }
  // fetch itself rejected: no answer came back.
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Begin, send and complete one upload. See the module comment. */
export async function runUpload(deps: UploadDeps, data: UploadData, opts: UploadOptions): Promise<UploadedMedia> {
  const totalBytes = sizeOf(data)
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? UPLOAD_PART_CONCURRENCY))
  const attempts = Math.max(1, Math.floor(opts.attempts ?? UPLOAD_ATTEMPTS))
  const retryDelayMs = opts.retryDelayMs ?? UPLOAD_RETRY_DELAY_MS
  const signal = opts.signal

  // Run `step`, trying again while it fails in a way trying again can fix.
  const withRetry = async <T>(step: () => Promise<T>, canRetry: (err: unknown) => boolean): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted()
      try {
        return await step()
      } catch (err) {
        if (signal?.aborted || attempt >= attempts || !canRetry(err)) throw err
        await sleep(retryDelayMs * 2 ** (attempt - 1))
      }
    }
  }

  const session = opts.resume ?? (await deps.createUpload({ fileName: opts.fileName, contentType: opts.contentType, sizeBytes: totalBytes }))
  const { outputId, upload } = session
  const done = new Map<number, string>((opts.resume?.parts ?? []).map((p) => [p.partNumber, p.etag]))
  let uploadedBytes = 0
  const report = (part?: CompletedUploadPart) => {
    const progress: UploadProgress = { outputId, uploadedBytes, totalBytes, ...(part ? { part } : {}) }
    try {
      opts.onProgress?.(progress)
    } catch {
      // Observing progress never fails the upload.
    }
  }

  try {
    let parts: CompletedUploadPart[] | undefined
    if (upload.mode === 'single') {
      report()
      await withRetry(
        () => deps.put(upload.url, upload.headers, sliceOf(data, 0, totalBytes), signal),
        (err) => retryable(err, true),
      )
      uploadedBytes = totalBytes
      report()
    } else {
      const { partSize, partCount } = upload
      if (!(partSize > 0) || !(partCount > 0) || partSize * partCount < totalBytes || partSize * (partCount - 1) >= totalBytes) {
        throw new ContentHeroError(
          `The server planned ${partCount} parts of ${partSize} bytes for a file of ${totalBytes} bytes, which do not fit each other. Create the upload again, and if it keeps failing contact support.`,
        )
      }
      const lengthOf = (n: number) => Math.min(partSize, totalBytes - (n - 1) * partSize)
      for (const n of done.keys()) if (n >= 1 && n <= partCount) uploadedBytes += lengthOf(n)
      report()

      // Errors from asking for a part's URL, told apart from the store's own: a 403 from the store means the URL went
      // stale and signing again fixes it, while a 403 here means this key may not upload.
      const fromSigning = new WeakSet<object>()
      const signPart = async (n: number): Promise<SignedUploadPart> => {
        try {
          const signed = (await deps.signUploadParts(outputId, [n])).find((p) => p.partNumber === n)
          if (!signed) throw new ContentHeroError(`The server did not sign part ${n}. Try again, and if it keeps failing contact support.`)
          return signed
        } catch (err) {
          if (typeof err === 'object' && err !== null) fromSigning.add(err)
          throw err
        }
      }
      const sendPart = async (n: number): Promise<string> => {
        const start = (n - 1) * partSize
        const answer = await withRetry(
          async () => {
            // Signed now, so a retry or a late part never holds a stale URL.
            const signed = await signPart(n)
            return deps.put(signed.url, signed.headers, sliceOf(data, start, start + lengthOf(n)), signal)
          },
          (err) => retryable(err, !(typeof err === 'object' && err !== null && fromSigning.has(err))),
        )
        const etag = answer.headers.get('etag')
        if (!etag) {
          throw new ContentHeroError(
            `The store answered part ${n} without an ETag, which completing the upload needs. Try again, and if it keeps failing contact support.`,
          )
        }
        return etag
      }

      const missing: number[] = []
      for (let n = 1; n <= partCount; n++) if (!done.has(n)) missing.push(n)
      let next = 0
      let failure: { error: unknown } | null = null
      const worker = async () => {
        while (!failure) {
          const n = missing[next++]
          if (n === undefined) return
          try {
            const etag = await sendPart(n)
            done.set(n, etag)
            uploadedBytes += lengthOf(n)
            report({ partNumber: n, etag })
          } catch (error) {
            failure ??= { error }
            return
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker))
      if (failure) throw (failure as { error: unknown }).error
      // The store requires the parts in order; they finished in whatever order the network allowed.
      parts = [...done.entries()].map(([partNumber, etag]) => ({ partNumber, etag })).sort((a, b) => a.partNumber - b.partNumber)
    }
    return await withRetry(() => deps.completeUpload(outputId, parts), (err) => retryable(err, false))
  } catch (err) {
    deps.failed()
    if (opts.abortOnFailure !== false) await deps.abortUpload(outputId).catch(() => undefined)
    throw err
  }
}
