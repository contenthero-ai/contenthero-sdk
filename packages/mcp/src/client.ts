/**
 * Lazy ContentHero SDK client, configured from the environment.
 *
 * Reads CONTENTHERO_API_KEY (required) and CONTENTHERO_BASE_URL (optional) from
 * the MCP server's env config. Resolution is deferred to first use so the
 * server can start and advertise its tools even before a key is present; the
 * missing-key error then surfaces as a tool-call result rather than a crash.
 */

import { ContentHero } from '@contenthero/sdk'

let cached: ContentHero | undefined

export function getClient(): ContentHero {
  if (cached) return cached
  const apiKey = process.env.CONTENTHERO_API_KEY
  if (!apiKey) {
    throw new Error(
      'CONTENTHERO_API_KEY is not set. Add it to the env of your ContentHero MCP server config.',
    )
  }
  cached = new ContentHero({ apiKey, baseUrl: process.env.CONTENTHERO_BASE_URL })
  return cached
}
