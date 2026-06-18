#!/usr/bin/env node
/**
 * ContentHero MCP server entry point (stdio transport).
 *
 * Run by an MCP client (Claude Code, Claude Desktop, etc.) as a child process.
 * stdout is the protocol channel, so all logging goes to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server.js'

async function main(): Promise<void> {
  const server = await buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('ContentHero MCP server running on stdio')
}

main().catch((err) => {
  console.error('ContentHero MCP server failed to start:', err)
  process.exit(1)
})
