/**
 * Every tool hands the request's call context to `getClient`, so the hosted server can bind the call to its caller.
 *
 * The hosted MCP (`app/api/mcp/route.ts` in contenthero-app) resolves the caller from `extra.authInfo` inside
 * `getClient`. The stdio server ignores the argument, so a tool that passes the wrong thing works locally and answers
 * "Not authenticated." on every hosted connection: get_account did exactly that (2026-10-28), because its handler named
 * its first parameter `extra` and so passed the tool's args on. The `ToolExtra` type makes that fail `tsc`; this holds
 * it at runtime, for every tool, through the SDK's own dispatch (which calls `(args, extra)` for a tool with an input
 * schema and `(extra)` for one without).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools, SERVER_INFO, type ToolExtra } from './server.js'

/** Thrown by the fake `getClient` once it has recorded what it was handed: no tool needs to go further. */
class Resolved extends Error {}

test('every tool hands the request call context, with its authInfo, to getClient', async () => {
  const server = new McpServer({ ...SERVER_INFO })
  let handed: ToolExtra[] = []
  registerTools(server, {
    getClient: (extra) => {
      handed.push(extra)
      throw new Resolved('resolved')
    },
  })

  type Dispatch = { executeToolHandler(tool: unknown, args: unknown, extra: unknown): Promise<unknown> }
  const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
  const names = Object.keys(tools)
  assert.ok(names.length > 50, `expected the full tool surface, found ${names.length}`)

  const wrong: string[] = []
  const reached: string[] = []
  for (const name of names) {
    handed = []
    const extra = {
      authInfo: { token: `token-${name}`, clientId: 'test', scopes: [], extra: { userId: 'user-1' } },
      signal: new AbortController().signal,
      requestId: 1,
      sendNotification: async () => {},
      sendRequest: async () => ({}),
    } as unknown as ToolExtra
    await (server as unknown as Dispatch).executeToolHandler(tools[name], {}, extra)
    // A tool that resolves no client (one that answers from the contract alone) has nothing to hand on.
    if (handed.some((h) => h !== extra)) wrong.push(name)
    if (handed.length) reached.push(name)
  }
  // Called with no arguments, most tools still reach getClient first; the account tools take none and must.
  assert.ok(reached.includes('get_account') && reached.includes('update_account'), `get_account and update_account must resolve a client: reached ${reached.join(', ')}`)
  assert.ok(reached.length >= names.length / 2, `only ${reached.length} of ${names.length} tools reached getClient with empty args`)
  assert.deepEqual(wrong, [], `these tools handed getClient something other than the request's call context: ${wrong.join(', ')}`)
})
