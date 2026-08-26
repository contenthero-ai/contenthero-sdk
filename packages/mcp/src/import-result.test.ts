import { test } from 'node:test'
import assert from 'node:assert/strict'

import { importedMediaResult } from './format.js'

/**
 * What an agent is TOLD when an import created nothing.
 *
 * ## Why this is worth pinning
 *
 * The import is idempotent: the same bytes twice give one library item, not two. That is only useful if the
 * caller can tell the cases apart. Reporting a duplicate as "Media ready" would be a lie an agent then acts
 * on, either by referencing an `outputId` that is null or by importing again next run because nothing said
 * it had already happened.
 *
 * The incident this came from: an editor export still was imported, produced a row that owned no object,
 * showed up in Creations as though the studio had generated it, and could not be deleted. Saying "already
 * imported" without naming WHAT it is would have sent someone hunting for a library item that never existed.
 */

const text = (r: ReturnType<typeof importedMediaResult>) =>
  r.content.map((c) => (c.type === 'text' ? c.text : '')).join('')

test('a NEW import reads as media ready, with an id to reference', () => {
  const out = text(importedMediaResult({ outputId: 'abc123', url: 'https://x/y.png', alreadyExisted: false }))
  assert.match(out, /Media ready \(id abc123\)/)
  assert.doesNotMatch(out, /already/i)
})

test('a duplicate that IS a library item gives the existing id, and says nothing was imported', () => {
  const out = text(importedMediaResult({ outputId: 'existing1', url: 'https://x/y.png', alreadyExisted: true }))
  assert.match(out, /Already in your library \(id existing1\)/)
  assert.match(out, /Nothing was imported/)
  // ⚠️ Must NOT read as a failure. A duplicate import is a successful no-op.
  assert.doesNotMatch(out, /error|failed|could not/i)
})

test('⚠️ a duplicate that is NOT a library item says what it IS, and that there is no id', () => {
  const out = text(
    importedMediaResult({
      outputId: null,
      url: 'https://cdn/x/Remotion Test-vr.png',
      alreadyExisted: true,
      existing: { objectName: 'u/proj/Remotion Test-vr.png', role: 'export', ownedBy: null },
    }),
  )
  assert.match(out, /You already have this file/)
  assert.match(out, /as a export/)
  assert.match(out, /Remotion Test-vr\.png/)
  // The part that prevents the hunt: there is no outputId, and it says so.
  assert.match(out, /no outputId/)
  assert.doesNotMatch(out, /id null/)
})

test('a duplicate with no role recorded still avoids promising an id', () => {
  const out = text(importedMediaResult({ outputId: null, url: 'https://x/y.png', alreadyExisted: true }))
  assert.match(out, /an existing file/)
  assert.match(out, /no outputId/)
})
