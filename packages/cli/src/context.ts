/**
 * Per-invocation context: resolve global options, the API key, and the SDK client.
 *
 * Auth ladder (highest priority first):
 *   1. --api-key flag
 *   2. CONTENTHERO_API_KEY env
 *   3. the stored credential file (written by `contenthero login`)
 *
 * Base URL ladder: --base-url flag, then CONTENTHERO_BASE_URL env, then the
 * stored config, then the SDK default. The SDK reads the same env vars itself,
 * but resolving here keeps the precedence explicit and lets us report the key
 * source in `auth status` / `config list`.
 */

import { ContentHero } from '@contenthero/sdk'
import type { Command } from 'commander'
import { readConfig, readCredential } from './config.js'
import { CliError, EXIT } from './errors.js'

/** Where the active key came from (for diagnostics, never the key itself). */
export type KeySource = 'flag' | 'env' | 'file' | 'none'

/** Global options merged onto every command. */
export interface GlobalOptions {
  json: boolean
  human: boolean
  apiKey?: string
  baseUrl?: string
}

/** The resolved invocation context. */
export interface Context {
  /** True when output should be raw JSON (the default). */
  json: boolean
  apiKey?: string
  keySource: KeySource
  baseUrl?: string
}

/** Read the merged global options off any command in the tree. */
export function globalsOf(command: Command): GlobalOptions {
  const o = command.optsWithGlobals() as Record<string, unknown>
  return {
    // JSON is the default; --human turns it off; an explicit --json forces it back on.
    json: o.json === true || o.human !== true,
    human: o.human === true,
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : undefined,
    baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : undefined,
  }
}

/** Resolve the API key and where it came from, without constructing a client. */
export function resolveContext(command: Command): Context {
  const g = globalsOf(command)

  let apiKey: string | undefined
  let keySource: KeySource = 'none'
  if (g.apiKey) {
    apiKey = g.apiKey
    keySource = 'flag'
  } else if (process.env.CONTENTHERO_API_KEY) {
    apiKey = process.env.CONTENTHERO_API_KEY
    keySource = 'env'
  } else {
    const stored = readCredential()
    if (stored?.apiKey) {
      apiKey = stored.apiKey
      keySource = 'file'
    }
  }

  const baseUrl =
    g.baseUrl || process.env.CONTENTHERO_BASE_URL || readConfig().baseUrl || undefined

  return { json: g.json, apiKey, keySource, baseUrl }
}

/**
 * Build an authenticated SDK client for this command, or throw a CliError with
 * the auth exit code when no key is configured anywhere in the ladder.
 */
export function makeClient(command: Command): { client: ContentHero; ctx: Context } {
  const ctx = resolveContext(command)
  if (!ctx.apiKey) {
    throw new CliError(
      'No API key found. Run `contenthero login`, set CONTENTHERO_API_KEY, or pass --api-key.',
      EXIT.AUTH,
    )
  }
  const client = new ContentHero({
    apiKey: ctx.apiKey,
    baseUrl: ctx.baseUrl,
    // Tag spends from the CLI as the 'cli' transport channel (the CLI spends
    // through an api key, so this header is what distinguishes it from raw api).
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          'X-ContentHero-Channel': 'cli',
        },
      }),
  })
  return { client, ctx }
}
