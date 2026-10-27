/**
 * The tool input the MCP registers: the contract's JSON Schema for the tool, turned into the validator the MCP SDK
 * runs on every call. The app declares each input once (`lib/api/contract`); nothing here restates a field, an enum or
 * a description, so a tool cannot advertise one thing and accept another.
 */
import { z } from 'zod'
import { toolInputSchema, type ContractToolName } from '@contenthero/sdk'

export function contractInput(name: ContractToolName): z.ZodType {
  return z.fromJSONSchema(toolInputSchema(name) as never, { defaultTarget: 'draft-7' } as never) as z.ZodType
}
