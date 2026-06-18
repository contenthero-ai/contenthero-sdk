/**
 * CLI error model + exit-code mapping.
 *
 * Exit codes follow the HeyGen CLI convention so shell/agent callers can branch
 * on the result without parsing text:
 *   0  success
 *   1  general error (API / network / unexpected)
 *   2  usage error (bad flags or arguments)
 *   3  authentication error (missing / invalid / unauthorized key)
 *   4  timeout: the work was accepted but did not finish in time (an outputId
 *      is still emitted, so the caller can keep polling)
 *
 * SDK errors are mapped here; `CliError` carries an explicit code for problems
 * the CLI itself raises (e.g. no key configured).
 */

import {
  AuthenticationError,
  PermissionError,
  ValidationError,
  GenerationTimeoutError,
} from '@contenthero/sdk'

export const EXIT = {
  OK: 0,
  GENERAL: 1,
  USAGE: 2,
  AUTH: 3,
  TIMEOUT: 4,
} as const

/** An error the CLI raises itself, carrying the exit code it should produce. */
export class CliError extends Error {
  readonly exitCode: number
  constructor(message: string, exitCode: number = EXIT.GENERAL) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

/** Map any thrown value onto a CLI exit code. */
export function exitCodeForError(err: unknown): number {
  if (err instanceof CliError) return err.exitCode
  if (err instanceof AuthenticationError || err instanceof PermissionError) return EXIT.AUTH
  if (err instanceof ValidationError) return EXIT.USAGE
  if (err instanceof GenerationTimeoutError) return EXIT.TIMEOUT
  return EXIT.GENERAL
}

/** A human-readable message for any thrown value. */
export function messageForError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
