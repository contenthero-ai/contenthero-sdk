import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadedHuman } from './media.js'

// An upload reads back with the name it was given, as the library lists it (phase 5 item 7: upload file names on
// every surface); an older server that sends none prints no Name row rather than an empty one.
test('an upload prints the name it was given', () => {
  const base = { outputId: 'o1', shortId: 'Abc12345', url: 'https://media.test/o1.png', kind: 'image', boardType: null, appUrl: 'https://app.test/media/Abc12345' }
  assert.match(uploadedHuman({ ...base, fileName: 'logo-final.png' } as never), /Name:\s+logo-final\.png/)
  assert.doesNotMatch(uploadedHuman(base as never), /Name:/)
})
