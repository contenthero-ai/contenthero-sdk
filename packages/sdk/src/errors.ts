/**
 * Typed error hierarchy for the ContentHero SDK.
 *
 * Every non-2xx response from the API is mapped to one of these so callers can
 * branch on `instanceof` rather than poking at status codes. `ContentHeroError`
 * is the base; catch it to handle anything the SDK throws from a request.
 */

export interface ContentHeroErrorOptions {
  status?: number
  /** The parsed response body (object or string), when there was one. */
  body?: unknown
  /** The platform's id for the request (the `x-vercel-id` response header), when the response carried one. */
  requestId?: string
}

/** Base class for every error thrown by the SDK. */
export class ContentHeroError extends Error {
  /** HTTP status code, when the error came from an API response. */
  readonly status?: number
  /** The parsed response body, when available. */
  readonly body?: unknown
  /**
   * The platform's id for the failed request (the `x-vercel-id` response header), when the response carried one.
   * Quote it when reporting a failure: it finds the request in the server's logs.
   */
  readonly requestId?: string

  constructor(message: string, options?: ContentHeroErrorOptions) {
    super(message)
    this.name = 'ContentHeroError'
    this.status = options?.status
    this.body = options?.body
    this.requestId = options?.requestId
    // Preserve the prototype chain when compiled down to ES targets.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 401: the API key is missing, malformed, revoked, or expired. */
export class AuthenticationError extends ContentHeroError {
  constructor(message = 'Authentication failed', options?: ContentHeroErrorOptions) {
    super(message, options)
    this.name = 'AuthenticationError'
  }
}

/** 403: the key is valid but lacks the scope required for this operation. */
export class PermissionError extends ContentHeroError {
  constructor(message = 'Permission denied', options?: ContentHeroErrorOptions) {
    super(message, options)
    this.name = 'PermissionError'
  }
}

/** 400: the request was rejected as malformed or unsupported by the model. */
export class ValidationError extends ContentHeroError {
  constructor(message = 'Invalid request', options?: ContentHeroErrorOptions) {
    super(message, options)
    this.name = 'ValidationError'
  }
}

/**
 * 409: what you tried to change has moved on since you read it. Nothing was written.
 *
 * `conflicts` is set when the server names each stale item with its current state (brand kit section writes send
 * `{ key, version, body }` per section); re-read, reapply your change, and send the new `expectedVersion`. Other
 * 409s carry their current state in `body`.
 */
export class ConflictError extends ContentHeroError {
  readonly conflicts?: Array<Record<string, unknown>>

  constructor(message = 'Conflict', options?: ContentHeroErrorOptions & { conflicts?: Array<Record<string, unknown>> }) {
    super(message, options)
    this.name = 'ConflictError'
    this.conflicts = options?.conflicts
  }
}

/** 404: the referenced generation does not exist (or is not owned by this key). */
export class NotFoundError extends ContentHeroError {
  constructor(message = 'Not found', options?: ContentHeroErrorOptions) {
    super(message, options)
    this.name = 'NotFoundError'
  }
}

/** Why a request was refused for a limit (the `code` of every 402). */
export type LimitCode = 'insufficient_credits' | 'spend_cap_reached' | 'storage_full' | 'plan_limit'

/** A way out of a limit, ranked: what to show a person, and where it happens in the app. */
export interface LimitAction {
  id: 'upgrade' | 'auto_top_up' | 'top_up' | 'update_payment_method' | 'raise_cap' | 'manage_storage' | 'request_limit'
  label: string
  url: string
}

/**
 * 402: a limit refused the request, and nothing ran or was charged. `message` is written for a person (relay it as
 * is), `actions` are the ways out in the order to offer them, and the numbers say how far off it was. Catch this for
 * every limit, or one of its four kinds below.
 */
export class LimitError extends ContentHeroError {
  readonly code: LimitCode
  readonly actions: LimitAction[]

  constructor(code: LimitCode, message: string, options?: ContentHeroErrorOptions & { actions?: LimitAction[] }) {
    super(message, options)
    this.name = 'LimitError'
    this.code = code
    this.actions = options?.actions ?? []
  }
}

interface CreditNumbers {
  /** Credits this needed. */
  needed?: number
  /** What could be spent (the balance less what is held for running work). */
  available?: number
  balance?: number
  held?: number
}

/** 402 `insufficient_credits`: not enough credits for this. */
export class InsufficientCreditsError extends LimitError {
  readonly needed?: number
  readonly available?: number
  readonly balance?: number
  readonly held?: number

  constructor(message = 'Insufficient credits', options?: ContentHeroErrorOptions & { actions?: LimitAction[] } & CreditNumbers) {
    super('insufficient_credits', message, options)
    this.name = 'InsufficientCreditsError'
    this.needed = options?.needed
    this.available = options?.available
    this.balance = options?.balance
    this.held = options?.held
  }
}

/** 402 `spend_cap_reached`: this would cross the account's monthly spend cap. Topping up does not pass it. */
export class SpendCapReachedError extends LimitError {
  readonly needed?: number
  readonly cap?: number
  readonly spent?: number
  /** When the cap resets (the start of next month, UTC). */
  readonly resetsAt?: string

  constructor(
    message = 'Monthly spend cap reached',
    options?: ContentHeroErrorOptions & { actions?: LimitAction[]; needed?: number; cap?: number; spent?: number; resetsAt?: string },
  ) {
    super('spend_cap_reached', message, options)
    this.name = 'SpendCapReachedError'
    this.needed = options?.needed
    this.cap = options?.cap
    this.spent = options?.spent
    this.resetsAt = options?.resetsAt
  }
}

/** 402 `storage_full`: the plan's storage is used up. */
export class StorageFullError extends LimitError {
  readonly fileBytes?: number
  readonly remainingBytes?: number

  constructor(message = 'Storage full', options?: ContentHeroErrorOptions & { actions?: LimitAction[]; fileBytes?: number; remainingBytes?: number }) {
    super('storage_full', message, options)
    this.name = 'StorageFullError'
    this.fileBytes = options?.fileBytes
    this.remainingBytes = options?.remainingBytes
  }
}

/** 402 `plan_limit`: a count the plan allows is reached (tracked accounts, connected accounts, brand kits). */
export class PlanLimitError extends LimitError {
  readonly feature?: string
  readonly current?: number
  readonly limit?: number
  /** The first plan that raises this limit; null at the top plan (the action is then `request_limit`). */
  readonly plan?: string | null

  constructor(
    message = 'Plan limit reached',
    options?: ContentHeroErrorOptions & { actions?: LimitAction[]; feature?: string; current?: number; limit?: number; plan?: string | null },
  ) {
    super('plan_limit', message, options)
    this.name = 'PlanLimitError'
    this.feature = options?.feature
    this.current = options?.current
    this.limit = options?.limit
    this.plan = options?.plan
  }
}

/** The limit error a 402 body describes, by its `code`; a plain error when the body is not a limit refusal. */
function limitErrorFrom(message: string, record: Record<string, unknown> | undefined, options: ContentHeroErrorOptions): ContentHeroError {
  const num = (k: string) => (typeof record?.[k] === 'number' ? (record[k] as number) : undefined)
  const str = (k: string) => (typeof record?.[k] === 'string' ? (record[k] as string) : undefined)
  const actions = Array.isArray(record?.actions) ? (record.actions as LimitAction[]) : []
  switch (record?.code) {
    case 'insufficient_credits':
      return new InsufficientCreditsError(message, { ...options, actions, needed: num('needed'), available: num('available'), balance: num('balance'), held: num('held') })
    case 'spend_cap_reached':
      return new SpendCapReachedError(message, { ...options, actions, needed: num('needed'), cap: num('cap'), spent: num('spent'), resetsAt: str('resetsAt') })
    case 'storage_full':
      return new StorageFullError(message, { ...options, actions, fileBytes: num('fileBytes'), remainingBytes: num('remainingBytes') })
    case 'plan_limit':
      return new PlanLimitError(message, {
        ...options,
        actions,
        feature: str('feature'),
        current: num('current'),
        limit: num('limit'),
        plan: typeof record?.plan === 'string' ? record.plan : null,
      })
    default:
      return new ContentHeroError(message, options)
  }
}

/**
 * 429: the API key exceeded its per-minute request limit. `retryAfter` is the
 * suggested wait in seconds when the API reports it, so callers can back off
 * before retrying.
 */
export class RateLimitError extends ContentHeroError {
  readonly retryAfter?: number

  constructor(
    message = 'Rate limit exceeded',
    options?: ContentHeroErrorOptions & { retryAfter?: number },
  ) {
    super(message, options)
    this.name = 'RateLimitError'
    this.retryAfter = options?.retryAfter
  }
}

/**
 * 503: the service could not do its part right now, most often because it could not CHECK the caller's identity
 * (its database or auth server was unavailable). Nothing about the request or the key was judged wrong, so the
 * correct response is to retry the same call shortly, never to replace the key. `retryAfter` is the suggested
 * wait in seconds when the API reports it.
 */
export class ServiceUnavailableError extends ContentHeroError {
  readonly retryAfter?: number

  constructor(
    message = 'The service is temporarily unavailable',
    options?: ContentHeroErrorOptions & { retryAfter?: number },
  ) {
    super(message, options)
    this.name = 'ServiceUnavailableError'
    this.retryAfter = options?.retryAfter
  }
}

/**
 * Thrown by `generateAndWait` when the generation reaches a terminal `failed`
 * state. `outputId` lets the caller re-fetch the record for the error detail.
 */
export class GenerationFailedError extends ContentHeroError {
  readonly outputId: string

  constructor(outputId: string, message = 'Generation failed', options?: ContentHeroErrorOptions) {
    super(message, options)
    this.name = 'GenerationFailedError'
    this.outputId = outputId
  }
}

/**
 * Thrown by `generateAndWait` when the generation does not reach a terminal
 * state before the configured timeout. The job may still complete server-side;
 * `outputId` lets the caller keep polling with `getGeneration`.
 */
export class GenerationTimeoutError extends ContentHeroError {
  readonly outputId: string

  constructor(outputId: string, message = 'Timed out waiting for generation to finish') {
    super(message)
    this.name = 'GenerationTimeoutError'
    this.outputId = outputId
  }
}

/**
 * A generation was SUBMITTED (accepted, running, and charged) but the client could not
 * follow it to a terminal state: a poll returned a transient error, the network dropped,
 * the process lost connectivity.
 *
 * The distinction that matters: this is NOT a failed generation. Discarding the outputId
 * here turns a recoverable blip into a lost job, and the caller's natural response is to
 * retry, which submits a SECOND generation and charges for it again. The id lets the
 * caller resume with `getGeneration` instead.
 */
export class GenerationInterruptedError extends ContentHeroError {
  readonly outputId: string

  /** What actually went wrong while polling, kept for diagnosis. */
  readonly reason: unknown

  constructor(outputId: string, reason: unknown, message?: string) {
    super(
      message ??
        `Submitted, but polling was interrupted: ${reason instanceof Error ? reason.message : String(reason)}. ` +
          `The generation may still be running; poll outputId ${outputId}.`,
    )
    this.name = 'GenerationInterruptedError'
    this.outputId = outputId
    this.reason = reason
  }
}

/**
 * The outputId of a generation that is still RUNNING despite the error, so the caller
 * can resume rather than resubmit. Undefined when the error is terminal (the generation
 * genuinely failed) or unrelated to a submitted job.
 */
export function pendingOutputId(err: unknown): string | undefined {
  if (err instanceof GenerationFailedError) return undefined
  if (err instanceof GenerationTimeoutError) return err.outputId
  if (err instanceof GenerationInterruptedError) return err.outputId
  return undefined
}

/** What a response said about itself beyond its status and body. */
export interface ResponseMeta {
  /** The `x-vercel-id` response header. */
  requestId?: string
  /** The body did not parse as JSON: the HTML error page a crashed route serves, or a proxy's plain text. */
  nonJson?: boolean
}

/**
 * Map an HTTP status + parsed body onto the right typed error.
 *
 * The message is the server's own when the body carries one. A body that is not JSON (the HTML page a crashed route
 * serves, a proxy's plain text) is never the message, since a page of markup says nothing a caller can act on. The
 * message names the status, says the response was not JSON, and gives the request id that finds the request in the
 * server's logs; the page itself stays on `body`. A response with no message of its own carries the request id the
 * same way.
 */
export function errorFromResponse(status: number, body: unknown, meta: ResponseMeta = {}): ContentHeroError {
  const record = (body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined)
  const served = (record && typeof record.error === 'string' && record.error) || (!meta.nonJson && typeof body === 'string' && body)
  const message =
    served ||
    `${meta.nonJson ? `HTTP ${status} (non-JSON response)` : `Request failed with status ${status}`}` +
      (meta.requestId ? `, request id ${meta.requestId}` : '')
  const options: ContentHeroErrorOptions = { status, body, requestId: meta.requestId }

  switch (status) {
    case 400:
      return new ValidationError(message, options)
    case 401:
      return new AuthenticationError(message, options)
    case 402:
      return limitErrorFrom(message, record, options)
    case 403:
      return new PermissionError(message, options)
    case 404:
      return new NotFoundError(message, options)
    case 409:
      return new ConflictError(message, {
        ...options,
        conflicts: Array.isArray(record?.conflicts) ? (record.conflicts as Array<Record<string, unknown>>) : undefined,
      })
    case 429:
      return new RateLimitError(message, {
        ...options,
        retryAfter: typeof record?.retryAfter === 'number' ? record.retryAfter : undefined,
      })
    case 503:
      return new ServiceUnavailableError(message, {
        ...options,
        retryAfter: typeof record?.retryAfter === 'number' ? record.retryAfter : undefined,
      })
    default:
      return new ContentHeroError(message, options)
  }
}
