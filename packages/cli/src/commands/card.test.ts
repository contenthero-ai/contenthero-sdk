import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assertNotesCarryRevision } from './card.js'

/**
 * `card update --notes` REFUSES A WRITE THAT CANNOT NAME THE REVISION IT READ.
 *
 * ## Why the CLI checks something the server already checks
 *
 * A card's notes have four independent writers (the board's panel, the MCP, this CLI, and the in-app
 * agent). Each reads the whole document, edits it, and writes it back whole, so whoever wrote last used to
 * win silently, with a success response. The compare-and-swap that fixed it lives in the database, and
 * `updateCard` refuses a `notes` write with no `expectedRevision` before it ever reaches the network.
 *
 * ⭐ **THIS GUARD EXISTS FOR THE MESSAGE, NOT THE RULE.** The server's wording names `expectedRevision`,
 * the FIELD, because that is what an SDK or MCP caller passes. Somebody at a terminal typed `--notes` and
 * needs the FLAG, plus where to read the value. A user told to pass a field that does not appear in
 * `--help` has been given a correct answer to a question they did not ask.
 *
 * ⛔ **THE TEST FOR WHETHER A CLIENT-SIDE CHECK IS LEGITIMATE:** deleting it must change only the wording,
 * never what is allowed. That holds here, which is why this is not the "convenience gate hiding a missing
 * guarantee" shape. The guarantee is the filtered UPDATE, and it is still the only thing deciding.
 */

test('🚨 --notes without --expected-revision is refused, naming the FLAG', () => {
  assert.throws(
    () => assertNotesCarryRevision('card_abc', 'some notes', undefined),
    (err: Error) => {
      // The flag, not the field: a user cannot act on `expectedRevision`, it is not in --help.
      assert.match(err.message, /--expected-revision/)
      // And where to get it, because knowing the flag without the source is still a dead end.
      assert.match(err.message, /card get card_abc/)
      // The reason, so this reads as a safeguard rather than an arbitrary requirement.
      assert.match(err.message, /erase/)
      return true
    },
  )
})

test('--notes WITH --expected-revision passes, including revision 0', () => {
  /*
    ⛔ 0 IS A REAL REVISION. A card nobody has edited sits at 0, and a falsy check here would refuse
    exactly the first write to every fresh card while accepting every later one, which is the kind of
    bug that looks like an intermittent failure rather than a logic error.
  */
  assert.doesNotThrow(() => assertNotesCarryRevision('card_abc', 'some notes', 0))
  assert.doesNotThrow(() => assertNotesCarryRevision('card_abc', 'some notes', 7))
})

test('a write that does not touch notes needs no revision', () => {
  // Only `notes` is guarded. A title or a stage change is last-write-wins by design, and requiring a
  // revision for them would make every unrelated edit fail for a reason the user cannot see.
  assert.doesNotThrow(() => assertNotesCarryRevision('card_abc', undefined, undefined))
})

test('clearing notes is still a notes write', () => {
  // An empty string is a DOCUMENT, not an absence: it replaces whatever was there, so it races exactly
  // like any other content. Only `undefined` means "leave notes alone".
  assert.throws(() => assertNotesCarryRevision('card_abc', '', undefined))
})
