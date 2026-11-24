/**
 * The listing the hosted route serves, built the way the route builds it (`registerTools` with an `isStaff` callback, listed
 * over a transport), carries every property the contract declares. The 2026-11-23 report named one: generate_audio
 * `voiceSettings.cloneStrength`. The whole-contract comparison is `pnpm check:mcp-listing` (guard 10).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools, SERVER_INFO } from './server.js'

async function listedTool(name: string, staff: boolean) {
  const server = new McpServer({ ...SERVER_INFO })
  registerTools(server, { getClient: () => { throw new Error('no call is made') }, isStaff: async () => staff })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  const { tools } = await client.listTools()
  await client.close()
  return tools.find((t) => t.name === name)
}

for (const staff of [false, true]) {
  test(`generate_audio lists voiceSettings with cloneStrength to ${staff ? 'a staff' : 'a public'} caller`, async () => {
    const tool = await listedTool('generate_audio', staff)
    assert.ok(tool, 'generate_audio is listed')
    const vs = (tool.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>).voiceSettings
    assert.ok(vs, 'voiceSettings is listed')
    for (const key of ['cloneStrength', 'similarity', 'speakerBoost', 'speed', 'stability', 'style']) assert.ok(vs.properties?.[key], `voiceSettings.${key} is listed`)
  })
}
