/**
 * Lazy ContentHero SDK client, configured from the environment.
 *
 * Resolution goes through the SDK's shared auth ladder: an explicit value, then
 * CONTENTHERO_API_KEY, then the credential written by `contenthero login` at
 * ~/.contenthero/credentials. It is deferred to first use so the server can start
 * and advertise its tools even before a key is present; the missing-key error then
 * surfaces as a tool-call result rather than a crash.
 *
 * ## Why the ladder, and not just the env var
 *
 * Reading only the environment is what forced every ContentHero entry in `.mcp.json`
 * to carry a plaintext `ch_live_` key inline in its command string, and made pointing
 * the MCP at a different account a three-file edit. With the ladder, an account is a
 * profile directory: set CONTENTHERO_CONFIG_DIR and no secret needs to live in any
 * editor config at all.
 *
 * ⚠️ THE CLIENT IS CACHED FOR THE PROCESS LIFETIME, so switching accounts requires
 * restarting the MCP server. That is deliberate. A key that could change underneath a
 * running session would let a generation land in, and bill, an account nobody at the
 * keyboard chose, and generations are not refundable.
 */

import { ContentHero } from '@contenthero/sdk'
import { configDir, resolveAuth } from '@contenthero/sdk/credentials'

let cached: ContentHero | undefined

export function getClient(): ContentHero {
  if (cached) return cached
  const { apiKey, keySource, baseUrl } = resolveAuth()
  if (!apiKey) {
    throw new Error(
      'No ContentHero API key found. Set CONTENTHERO_API_KEY in the MCP server env, ' +
        `or run \`contenthero login\` to store one (looked in ${configDir()}).`,
    )
  }
  // Announced once, on stderr so it never corrupts the stdio protocol stream. Which ACCOUNT an MCP server is
  // acting as is the single most consequential thing about it and was previously invisible: the only way to
  // find out was to call get_balance and recognise the number.
  console.error(`[contenthero-mcp] authenticated from ${keySource} (config dir: ${configDir()})`)
  cached = new ContentHero({
    apiKey,
    baseUrl,
    // Tag spends from the stdio MCP as the 'mcp' transport channel, matching the
    // hosted OAuth MCP. The MCP spends through an api key, so this header is what
    // distinguishes it from a raw api-key or cli caller on credit_transactions.
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          'X-ContentHero-Channel': 'mcp',
        },
      }),
  })
  return cached
}
