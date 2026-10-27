/**
 * Reads of the agent contract (`contract.generated.ts`) that the CLI and the MCP share, so a field's allowed values and
 * its words are read one way. The contract is declared by the app and vendored here; nothing in this file restates it.
 */
import { AGENT_CONTRACT, type ContractSchema, type ContractToolName } from './contract.generated.js'

/** One input field of a tool, by name, or by a dotted path into nested objects and arrays (`files.sizeBytes`). */
export function contractField(tool: ContractToolName, path: string): ContractSchema {
  const t = AGENT_CONTRACT.tools.find((x) => x.name === tool)
  if (!t) throw new Error(`No tool named ${tool} in the agent contract`)
  let node: ContractSchema | undefined = t.inputSchema as ContractSchema
  for (const part of path.split('.')) {
    node = unwrap(node)
    if (node?.type === 'array' && node.items) node = unwrap(node.items)
    node = node?.properties?.[part]
    if (!node) throw new Error(`${tool} has no input ${path} in the agent contract`)
  }
  return node
}

/** A schema with its `null` alternatives set aside: the one non-null branch of a nullable field. */
function unwrap(node: ContractSchema | undefined): ContractSchema | undefined {
  const branches = node?.anyOf ?? node?.oneOf
  if (!node || !branches) return node
  const rest = branches.filter((b) => b.type !== 'null')
  return rest.length === 1 ? { ...rest[0], description: rest[0]!.description ?? node.description } : node
}

/** The allowed values of an enum field, or an array field's items. Throws when the field declares none. */
export function contractChoices(tool: ContractToolName, path: string): readonly string[] {
  const field = unwrap(contractField(tool, path))
  const values = field?.enum ?? (field?.items ? unwrap(field.items)?.enum : undefined)
  if (!values) throw new Error(`${tool}.${path} declares no allowed values in the agent contract`)
  return values as readonly string[]
}

/** What a CLI option takes from the contract: the field's words, and its allowed values when it has a closed set. */
export function optionFromContract(tool: ContractToolName, path: string): { description: string; choices?: readonly string[] } {
  const field = unwrap(contractField(tool, path))
  const description = field?.description
  if (!description) throw new Error(`${tool}.${path} has no description in the agent contract`)
  const values = field?.enum ?? (field?.items ? unwrap(field.items)?.enum : undefined)
  return values ? { description, choices: values as readonly string[] } : { description }
}
