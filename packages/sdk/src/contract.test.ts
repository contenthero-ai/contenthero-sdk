import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as sdk from './index.js'
import { AGENT_CONTRACT, AGENT_CONTRACT_VERSION, toolDescription } from './contract.generated.js'
import { contractChoices, optionFromContract } from './contract.js'

const vendored = JSON.parse(readFileSync(new URL('../contract/agent-contract.json', import.meta.url), 'utf8')) as {
  version: string
  vocabularies: Record<string, readonly string[]>
}

test('the SDK carries the vendored contract version', () => {
  assert.equal(AGENT_CONTRACT_VERSION, vendored.version)
  assert.equal(AGENT_CONTRACT.version, vendored.version)
})

test('every SDK export sharing a contract vocabulary name holds the contract values', () => {
  const exported = sdk as unknown as Record<string, unknown>
  let shared = 0
  for (const [name, values] of Object.entries(vendored.vocabularies)) {
    if (!(name in exported)) continue
    shared += 1
    assert.deepEqual([...(exported[name] as string[])], [...values], name)
  }
  assert.ok(shared > 0)
})

test('view says contact sheets are lossy and never for telling renders apart', () => {
  for (const audience of ['mcp', 'in-app'] as const) {
    const text = toolDescription('view', audience)
    assert.match(text, /contact sheet is a lossy, downscaled copy/)
    assert.match(text, /never to measure or to test whether two renders differ/)
  }
})

test('a CLI option reads its words and choices from the contract', () => {
  const sort = optionFromContract('list_projects', 'sort')
  assert.ok(sort.description)
  assert.deepEqual(sort.choices, contractChoices('list_projects', 'sort'))
  assert.deepEqual(sort.choices, sdk.LIST_SORTS.projects)
  assert.throws(() => optionFromContract('list_projects', 'nope'))
})
