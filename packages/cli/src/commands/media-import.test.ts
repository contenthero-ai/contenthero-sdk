import { test } from 'node:test'
import assert from 'node:assert/strict'

import { importedHuman } from './media.js'

/**
 * What `ch media import` PRINTS when it created nothing.
 *
 * ## The failure this replaces
 *
 * `media import` rendered through `uploadedHuman`, the upload formatter. An import is idempotent, so on a
 * duplicate `outputId` is null, and that formatter printed `Output id:` followed by nothing. A blank value
 * reads as a broken command, not as a deliberate no-op, which is worse than the behaviour it replaced.
 *
 * The incident behind this: an editor export still was imported, became a row that owned no object, appeared
 * in Creations as though the studio had generated it, and could not be deleted. Printing "already imported"
 * without naming WHAT it is sends the operator hunting for a library item that does not exist.
 *
 * ⚠️ Human rendering only. `--json` still emits the whole object, so a script reading `alreadyExisted` is
 * unaffected by any of this.
 */

test('a NEW import prints the id it created', () => {
  const out = importedHuman({ outputId: 'abc123', url: 'https://x/y.png', alreadyExisted: false })
  assert.match(out, /Output id.*abc123/)
  assert.doesNotMatch(out, /Already|already/)
})

test('a duplicate that IS a library item prints the existing id and says nothing was imported', () => {
  const out = importedHuman({ outputId: 'existing1', url: 'https://x/y.png', alreadyExisted: true })
  assert.match(out, /Nothing was imported/)
  assert.match(out, /Output id.*existing1/)
})

test('⚠️ a duplicate that is NOT a library item never prints a blank id', () => {
  const out = importedHuman({
    outputId: null,
    url: 'https://cdn/x/Remotion Test-vr.png',
    alreadyExisted: true,
    existing: { objectName: 'u/proj/Remotion Test-vr.png', role: 'export', ownedBy: null },
  })
  assert.match(out, /You already have this file/)
  assert.match(out, /export/)
  assert.match(out, /Remotion Test-vr\.png/)
  // The whole point: an absent id is STATED as the answer, never rendered as an empty value.
  assert.match(out, /Output id.*none/)
  assert.doesNotMatch(out, /Output id:\s*$/m)
})

test('a duplicate with no role recorded still states the absent id', () => {
  const out = importedHuman({ outputId: null, url: 'https://x/y.png', alreadyExisted: true })
  assert.match(out, /an existing file/)
  assert.match(out, /Output id.*none/)
  assert.doesNotMatch(out, /Output id:\s*$/m)
})
