import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIST_SORTS } from './types.js'

/**
 * `LIST_SORTS` mirrors the app's one declaration (`lib/lists/sorts.ts`, motion graphics 9.9, the app's "API Lists"),
 * which the API validates every `sort` against. Two declarations drift, so this holds the SDK's to the app's whenever
 * the app sits beside this repository (a developer checkout); without it there is nothing to compare and the test
 * says so rather than passing silently.
 */
const APP_SORTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'contenthero-app', 'lib', 'lists', 'sorts.ts')

test('LIST_SORTS matches the fields the app declares for every list the API sorts', { skip: existsSync(APP_SORTS) ? false : 'no contenthero-app checkout beside this repository' }, () => {
  const source = readFileSync(APP_SORTS, 'utf8')
  const declared = new Map<string, string[]>()
  for (const m of source.matchAll(/^\s{2}(\w+): declare\(\{\s*fields: \[([^\]]*)\]/gm)) {
    declared.set(m[1]!, [...m[2]!.matchAll(/'([^']+)'/g)].map((f) => f[1]!))
  }
  assert.ok(declared.size > 0, 'read no list declarations from the app: has its shape changed?')
  assert.deepEqual(
    Object.fromEntries(Object.entries(LIST_SORTS).map(([list, fields]) => [list, [...fields]])),
    Object.fromEntries(declared),
  )
})
