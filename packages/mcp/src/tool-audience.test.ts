/**
 * A tool the contract marks for staff is listed to staff only, and the listing is the only thing that changes: the
 * server refuses a staff tool for anyone else however the call arrives, so this hides, never guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AGENT_CONTRACT, toolAudience, type ContractToolName } from '@contenthero/sdk'
import { registerTools, SERVER_INFO, type ToolExtra } from './server.js'

const STAFF_TOOLS = AGENT_CONTRACT.tools.filter((t) => t.audience === 'staff').map((t) => t.name)

async function listed(isStaff?: (extra: ToolExtra) => boolean | Promise<boolean>): Promise<string[]> {
  const server = new McpServer({ ...SERVER_INFO })
  registerTools(server, { getClient: () => { throw new Error('no call is made') }, ...(isStaff ? { isStaff } : {}) })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  const { tools } = await client.listTools()
  await client.close()
  return tools.map((t) => t.name)
}

test('the contract marks the tier list tools for staff, and nothing else', () => {
  assert.deepEqual([...STAFF_TOOLS].sort(), ['create_tier_list', 'get_tier_list', 'list_tier_lists', 'update_tier_list'])
  assert.equal(toolAudience('list_tier_lists' as ContractToolName), 'staff')
  assert.equal(toolAudience('list_media' as ContractToolName), undefined)
})

test('a caller who is not staff is not offered a staff tool', async () => {
  const names = await listed(() => false)
  for (const tool of STAFF_TOOLS) assert.ok(!names.includes(tool), `${tool} was listed`)
  assert.ok(names.includes('list_media'))
})

test('a staff caller is offered every tool', async () => {
  const names = await listed(async () => true)
  for (const tool of STAFF_TOOLS) assert.ok(names.includes(tool), `${tool} was not listed`)
})

test('with no way to know the caller, every tool is listed', async () => {
  const names = await listed()
  for (const tool of STAFF_TOOLS) assert.ok(names.includes(tool), `${tool} was not listed`)
})
