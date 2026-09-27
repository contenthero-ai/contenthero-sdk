import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CardDetail } from '@contenthero/sdk'
import { cardResult } from './format.js'

/**
 * get_card prints the id a caller follows an attachment by. A linked project read back with no id on 2026-09-27
 * (measured against production after the attach release), so an agent could link a project but not open it.
 */

const card = {
  id: 'card-1',
  title: 'Probe',
  stage: null,
  revision: 1,
  tags: [],
  posts: [],
  assets: [
    { id: 'att-1', assetType: 'editor', assetId: 'proj-1', assetUrl: null, displayName: 'Cut', sortOrder: 0, inspiration: null },
    { id: 'att-2', assetType: 'inspiration', assetId: 'content-1', assetUrl: 'https://instagram.com/p/x', displayName: null, sortOrder: 1, inspiration: null },
  ],
} as unknown as CardDetail

const text = () => (cardResult(card).content[0] as { text: string }).text

test('a linked project prints the id get_project takes', () => {
  assert.match(text(), /\[editor\] Cut \| .*project proj-1 \(pass to get_project\)/)
})

test('an inspiration post still prints the id get_content takes', () => {
  assert.match(text(), /content content-1 \(pass to get_content\)/)
})
