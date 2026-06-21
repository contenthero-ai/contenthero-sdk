#!/usr/bin/env node
/**
 * ContentHero MCP package entry point.
 *
 * Dual-purpose:
 *  - As a CLI (the `contenthero-mcp` bin, run by Claude Code / Claude Desktop):
 *    boots the stdio server. stdout is the protocol channel, so logs go to stderr.
 *  - As a library (imported by an embedding host, e.g. the hosted OAuth MCP):
 *    re-exports registerTools / buildServer / the model helpers, with NO side
 *    effects. The stdio server only starts when this file is executed directly.
 */

import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server.js'

export { buildServer, registerTools } from './server.js'
export type { BuildServerOptions, RegisterToolsOptions, GetClient } from './server.js'
export { resolveModelEnums, fallbackModelEnums } from './models.js'
export type { ResolvedModelEnums, ModelEnum } from './models.js'

async function main(): Promise<void> {
  const server = await buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('ContentHero MCP server running on stdio')
}

// Only boot the stdio server when this module is the process entry point (the
// `contenthero-mcp` bin). When imported as a library, this is skipped.
//
// process.argv[1] may be a SYMLINK (npx / npm `.bin/contenthero-mcp` always is,
// and macOS /tmp is symlinked too), while Node sets import.meta.url to the
// module's REALPATH. Comparing the symlink path directly fails → the server
// silently no-ops on exit 0. Resolve the symlink before comparing so the bin
// boots under npx while the library-import path stays side-effect-free.
const entry = process.argv[1]
let entryRealUrl: string | undefined
try {
  entryRealUrl = entry ? pathToFileURL(realpathSync(entry)).href : undefined
} catch {
  entryRealUrl = undefined
}
const invokedDirectly =
  !!entry &&
  (import.meta.url === pathToFileURL(entry).href || import.meta.url === entryRealUrl)

if (invokedDirectly) {
  main().catch((err) => {
    console.error('ContentHero MCP server failed to start:', err)
    process.exit(1)
  })
}
