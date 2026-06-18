/**
 * `contenthero auth` - manage how the CLI authenticates.
 *   auth login              browser-assisted key provisioning (the primary path)
 *   auth login --with-key   store a key you already have (flag value or piped stdin)
 *   auth status             verify the active key and show the account
 *   auth logout             delete the stored credential
 *
 * `login` and `logout` are also exposed at the top level (`contenthero login`)
 * since that is the headline command. Both forms share these handlers.
 *
 * Browser login: we start a localhost listener, open the app's /cli/auth page
 * (passing the loopback port + a state nonce), the user approves, the page mints a
 * named `CLI (<host>)` key and navigates back to the listener with it. We verify
 * the key, then store it. `--with-key` and CONTENTHERO_API_KEY cover headless /
 * bring-your-own-key (CI, or a key from the app's API Keys tab).
 */

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { ContentHero } from '@contenthero/sdk'
import { clearCredential, credentialsPath, writeCredential } from '../config.js'
import { resolveContext, type Context } from '../context.js'
import { emit, keyValues } from '../output.js'
import { CliError, EXIT } from '../errors.js'

const DEFAULT_BASE_URL = 'https://app.contenthero.ai'
const LOGIN_TIMEOUT_MS = 180_000

/** Read piped stdin (returns '' when attached to a TTY or nothing is piped). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8').trim()
}

/** Open a URL in the default browser. Best-effort; the URL is always printed too.
 * Skipped when CONTENTHERO_NO_BROWSER is set (headless / CI). */
function openBrowser(url: string): void {
  if (process.env.CONTENTHERO_NO_BROWSER) return
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Ignore: the URL was printed for manual navigation.
  }
}

/** Minimal branded HTML for the loopback success / cancel page. */
function resultPage(title: string, sub: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f9fa;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#121212}
    .card{background:#fff;border-radius:24px;padding:40px 48px;box-shadow:0 8px 32px rgba(0,0,0,.08);text-align:center}
    h1{font-size:20px;margin:0 0 8px} p{color:#6b7280;margin:0;font-size:14px}
    .dot{color:#d4af37}</style></head>
    <body><div class="card"><h1><span class="dot">ContentHero</span> ${title}</h1><p>${sub}</p></div></body></html>`
}

/** Verify a key against the API, then persist it and report. */
async function verifyAndStore(key: string, ctx: Context, label?: string): Promise<void> {
  const client = new ContentHero({ apiKey: key, baseUrl: ctx.baseUrl })
  const balance = await client.getBalance()
  writeCredential({ apiKey: key, label, createdAt: new Date().toISOString() })
  const data = { ok: true, stored: credentialsPath(), tier: balance.tier, balance: balance.balance }
  emit(data, ctx, (d: typeof data) =>
    keyValues([
      ['Logged in', 'stored ' + d.stored],
      ['Tier', d.tier],
      ['Balance', `${d.balance} credits`],
    ]),
  )
}

export interface LoopbackOptions {
  /** The state nonce the browser callback must echo back. */
  state: string
  /**
   * App base URL the browser is redirected back to after delivering the key, so
   * the user lands on a real on-brand success page (`/cli/auth/done`) instead of
   * this raw-IP listener. Delivering the key needs a navigation to localhost (an
   * https page cannot fetch http://127.0.0.1 reliably), so we make that hop
   * instant and bounce straight back to the app.
   */
  redirectBase: string
  /** Called with the bound port once the listener is up (to build + open the URL). */
  onListening: (port: number) => void
  /** Give up after this many ms (default 3 minutes). */
  timeoutMs?: number
}

/**
 * Start a localhost listener and resolve with the API key the browser hands back
 * to `/callback?state=<state>&key=<key>`. On a valid hit it 302-redirects the
 * browser to `<redirectBase>/cli/auth/done` so the user lands on a styled app
 * page. Rejects on `error=...`, a listener failure, or timeout. A callback whose
 * state does not match is rejected with 400 and ignored (the listener keeps
 * waiting), so a stray or forged hit cannot end the flow. Exported for testing.
 */
export function awaitLoopbackKey(opts: LoopbackOptions): Promise<string> {
  const { state, redirectBase, onListening, timeoutMs = LOGIN_TIMEOUT_MS } = opts
  const doneUrl = (status: string) => `${redirectBase}/cli/auth/done?status=${status}`
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('Not found')
        return
      }
      // Bind the callback to this invocation; ignore anything with a wrong state.
      if (reqUrl.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html' })
        res.end(resultPage('login error', 'Invalid request. You can close this tab.'))
        return
      }
      const error = reqUrl.searchParams.get('error')
      const got = reqUrl.searchParams.get('key')
      if (error || !got) {
        // Bounce to the styled cancelled page, then reject the CLI promise.
        res.writeHead(302, { location: doneUrl('cancelled') })
        res.end()
        finish(() => reject(new CliError('Login was cancelled in the browser.', EXIT.AUTH)))
        return
      }
      // Key captured: bounce the browser to the on-brand success page on the app.
      res.writeHead(302, { location: doneUrl('connected') })
      res.end()
      finish(() => resolve(got))
    })

    server.on('error', (e) =>
      finish(() => reject(new CliError(`Could not start the local login listener: ${e.message}`, EXIT.GENERAL))),
    )

    const timer = setTimeout(
      () => finish(() => reject(new CliError('Login timed out after 3 minutes.', EXIT.AUTH))),
      timeoutMs,
    )

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      onListening(port)
    })
  })
}

/** Run the browser-assisted login: loopback listener + the app's /cli/auth page. */
async function browserLogin(ctx: Context): Promise<void> {
  const state = randomBytes(16).toString('hex')
  const label = hostname()
  const base = (ctx.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

  const key = await awaitLoopbackKey({
    state,
    redirectBase: base,
    onListening: (port) => {
      const authUrl = `${base}/cli/auth?port=${port}&state=${state}&label=${encodeURIComponent(label)}`
      process.stderr.write(
        `Opening your browser to authorize the CLI.\nIf it does not open, visit:\n  ${authUrl}\n\nWaiting for authorization...\n`,
      )
      openBrowser(authUrl)
    },
  })

  await verifyAndStore(key, ctx, label)
}

async function loginAction(opts: { withKey?: string | boolean }, command: Command): Promise<void> {
  const ctx = resolveContext(command)

  // No --with-key: run the browser-assisted flow (the primary path).
  if (opts.withKey === undefined) {
    await browserLogin(ctx)
    return
  }

  const key = typeof opts.withKey === 'string' ? opts.withKey.trim() : await readStdin()
  if (!key) {
    throw new CliError(
      'No key provided. Pass it as `--with-key <key>` or pipe it via stdin.',
      EXIT.USAGE,
    )
  }
  await verifyAndStore(key, ctx)
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
    baseUrl: ctx.baseUrl ?? DEFAULT_BASE_URL,
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
