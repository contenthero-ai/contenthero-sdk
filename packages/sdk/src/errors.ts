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
}

/** Base class for every error thrown by the SDK. */
export class ContentHeroError extends Error {
  /** HTTP status code, when the error came from an API response. */
  readonly status?: number
  /** The parsed response body, when available. */
  readonly body?: unknown

  constructor(message: string, options?: ContentHeroErrorOptions) {
    super(message)
    this.name = 'ContentHeroError'
    this.status = options?.status
    this.body = options?.body
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

/** 404: the referenced generation does not exist (or is not owned by this key). */
export class NotFoundError extends ContentHeroError {
  constructor(message = 'Not found', options?: ContentHeroErrorOptions) {
    super(message, options)
    this.name = 'NotFoundError'
  }
}

/**
 * 402: the account does not have enough credits for the requested generation.
 * Carries the current `balance` and the `required` amount when the API reports
 * them, so callers can surface a precise top-up prompt.
 */
export class InsufficientCreditsError extends ContentHeroError {
  readonly balance?: number
  readonly required?: number

  constructor(
    message = 'Insufficient credits',
    options?: ContentHeroErrorOptions & { balance?: number; required?: number },
  ) {
    super(message, options)
    this.name = 'InsufficientCreditsError'
    this.balance = options?.balance
    this.required = options?.required
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

/** Map an HTTP status + parsed body onto the right typed error. */
export function errorFromResponse(status: number, body: unknown): ContentHeroError {
  const record = (body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined)
  const message =
    (record && typeof record.error === 'string' && record.error) ||
    (typeof body === 'string' && body) ||
    `Request failed with status ${status}`
  const options: ContentHeroErrorOptions = { status, body }

  switch (status) {
    case 400:
      return new ValidationError(message, options)
    case 401:
      return new AuthenticationError(message, options)
    case 402:
      return new InsufficientCreditsError(message, {
        ...options,
        balance: typeof record?.balance === 'number' ? record.balance : undefined,
        required: typeof record?.required === 'number' ? record.required : undefined,
      })
    case 403:
      return new PermissionError(message, options)
    case 404:
      return new NotFoundError(message, options)
    case 429:
      return new RateLimitError(message, {
        ...options,
        retryAfter: typeof record?.retryAfter === 'number' ? record.retryAfter : undefined,
      })
    default:
      return new ContentHeroError(message, options)
  }
}
