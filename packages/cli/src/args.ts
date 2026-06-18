/**
 * Small commander option coercers. They throw a usage-coded CliError on bad
 * input so the central error boundary reports exit 2 with a clear message.
 */

import { CliError, EXIT } from './errors.js'

/** Parse an integer option value. */
export function toInt(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n)) {
    throw new CliError(`Expected an integer, got "${value}".`, EXIT.USAGE)
  }
  return n
}

/** Parse a numeric option value (integer or decimal). */
export function toFloat(value: string): number {
  const n = Number(value)
  if (Number.isNaN(n)) {
    throw new CliError(`Expected a number, got "${value}".`, EXIT.USAGE)
  }
  return n
}

/** Collect a repeatable option (e.g. --ref a --ref b) into an array. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** Parse a JSON option value into an unknown, with a usage error on bad JSON. */
export function toJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new CliError(`Expected valid JSON, got "${value}".`, EXIT.USAGE)
  }
}
