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
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((err) => {
    console.error('ContentHero MCP server failed to start:', err)
    process.exit(1)
  })
}
