/**
 * `contenthero auth` - manage how the CLI authenticates.
 *   auth login              browser-assisted key provisioning (lands in a later slice)
 *   auth login --with-key   store a key you already have (flag value or piped stdin)
 *   auth status             verify the active key and show the account
 *   auth logout             delete the stored credential
 *
 * `login` and `logout` are also exposed at the top level (`contenthero login`)
 * since that is the headline command. Both forms share these handlers.
 *
 * The browser flow is the primary path; `--with-key` and CONTENTHERO_API_KEY
 * cover bring-your-own-key (CI, or a key from the app's API Keys tab).
 */

import type { Command } from 'commander'
import { ContentHero } from '@contenthero/sdk'
import { clearCredential, credentialsPath, writeCredential } from '../config.js'
import { resolveContext } from '../context.js'
import { emit, keyValues } from '../output.js'
import { CliError, EXIT } from '../errors.js'

/** Read piped stdin (returns '' when attached to a TTY or nothing is piped). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function loginAction(opts: { withKey?: string | boolean }, command: Command): Promise<void> {
  const ctx = resolveContext(command)

  // Browser-assisted provisioning is built in a later slice. Until then, point
  // the user at the supported bring-your-own-key paths.
  if (opts.withKey === undefined) {
    throw new CliError(
      'Browser login is coming soon. For now: `contenthero login --with-key <key>` ' +
        '(create a key in the app API Keys tab), or set CONTENTHERO_API_KEY.',
      EXIT.USAGE,
    )
  }

  const key = typeof opts.withKey === 'string' ? opts.withKey.trim() : await readStdin()
  if (!key) {
    throw new CliError(
      'No key provided. Pass it as `--with-key <key>` or pipe it via stdin.',
      EXIT.USAGE,
    )
  }

  // Verify the key before storing it, so we never persist a dud.
  const client = new ContentHero({ apiKey: key, baseUrl: ctx.baseUrl })
  const balance = await client.getBalance()

  writeCredential({ apiKey: key, createdAt: new Date().toISOString() })

  const data = { ok: true, stored: credentialsPath(), tier: balance.tier, balance: balance.balance }
  emit(data, ctx, (d: typeof data) =>
    keyValues([
      ['Logged in', 'stored ' + d.stored],
      ['Tier', d.tier],
      ['Balance', `${d.balance} credits`],
    ]),
  )
}

async function statusAction(_opts: unknown, command: Command): Promise<void> {
  const ctx = resolveContext(command)
  if (!ctx.apiKey) {
    throw new CliError(
      'Not authenticated. Run `contenthero login`, set CONTENTHERO_API_KEY, or pass --api-key.',
      EXIT.AUTH,
    )
  }
  // getBalance round-trips the key, so a bad key surfaces as an auth error (exit 3).
  const client = new ContentHero({ apiKey: ctx.apiKey, baseUrl: ctx.baseUrl })
  const balance = await client.getBalance()

  const data = {
    authenticated: true,
    keySource: ctx.keySource,
    baseUrl: ctx.baseUrl ?? 'https://app.contenthero.ai',
    tier: balance.tier,
    balance: balance.balance,
  }
  emit(data, ctx, (d: typeof data) =>
    keyValues([
      ['Authenticated', 'yes'],
      ['Key source', d.keySource],
      ['Base URL', d.baseUrl],
      ['Tier', d.tier],
      ['Balance', `${d.balance} credits`],
    ]),
  )
}

function logoutAction(_opts: unknown, command: Command): void {
  const ctx = resolveContext(command)
  const removed = clearCredential()
  emit({ ok: true, removed }, ctx, () =>
    removed ? 'Logged out (stored credential removed).' : 'No stored credential to remove.',
  )
}

/** Apply the login description/option/action to a command (shared by both mounts). */
function configureLogin(cmd: Command): Command {
  return cmd
    .description('Authenticate the CLI. Browser-assisted by default; --with-key stores an existing key.')
    .option(
      '--with-key [key]',
      'store an existing API key (pass the key, or pipe it via stdin). Omit to use the browser flow.',
    )
    .action(loginAction)
}

/** Apply the logout description/action to a command (shared by both mounts). */
function configureLogout(cmd: Command): Command {
  return cmd
    .description('Delete the stored credential (env / --api-key are unaffected)')
    .action(logoutAction)
}

export function registerAuth(program: Command): void {
  const auth = program.command('auth').description('Manage CLI authentication')

  configureLogin(auth.command('login'))
  auth
    .command('status')
    .description('Verify the active API key and show the account it resolves to')
    .action(statusAction)
  configureLogout(auth.command('logout'))

  // Top-level aliases for the two headline commands.
  configureLogin(program.command('login'))
  configureLogout(program.command('logout'))
}
