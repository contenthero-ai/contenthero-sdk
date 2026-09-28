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
    { id: 'att-1', assetType: 'editor', contentId: null, projectId: 'proj-1', assetId: 'proj-1', assetUrl: null, displayName: 'Cut', sortOrder: 0, inspiration: null },
    { id: 'att-2', assetType: 'inspiration', contentId: 'content-1', projectId: null, assetId: 'content-1', assetUrl: 'https://instagram.com/p/x', displayName: null, sortOrder: 1, inspiration: null },
    { id: 'att-3', assetType: 'image', contentId: null, projectId: null, assetId: 'obj-1', assetUrl: 'https://media.contenthero.ai/a.png', displayName: 'Cover', sortOrder: 2, inspiration: null },
  ],
} as unknown as CardDetail

const text = () => (cardResult(card).content[0] as { text: string }).text

test('a linked project prints the id get_project takes, and no url it does not have', () => {
  assert.match(text(), /- \[editor\] Cut \| project proj-1 \(pass to get_project\) \(id att-1\)/)
  assert.doesNotMatch(text(), /no url/)
})

test('a media asset still prints its name and url', () => {
  assert.match(text(), /- \[image\] Cover \| https:\/\/media\.contenthero\.ai\/a\.png \(id att-3\)/)
})

test('an inspiration post still prints the id get_content takes', () => {
  assert.match(text(), /content content-1 \(pass to get_content\)/)
})

test('an attachment prints the app link of what it points at, so a card links its references directly', () => {
  const linked = {
    ...card,
    assets: [
      { id: 'att-2', assetType: 'inspiration', contentId: 'content-1', projectId: null, assetId: 'content-1', assetUrl: 'https://instagram.com/p/x', appUrl: 'https://app.contenthero.ai/content/P0stAbcD', displayName: 'Reel', sortOrder: 0, inspiration: null },
    ],
  } as unknown as CardDetail
  const out = (cardResult(linked).content[0] as { text: string }).text
  assert.match(out, /\(id att-2, appUrl https:\/\/app\.contenthero\.ai\/content\/P0stAbcD\)/)
})

test('a card detail names its page tabs, so the agent links a tab as {appUrl}/{tab}', () => {
  const tabbed = { ...card, appUrl: 'https://app.contenthero.ai/card/CardAbcD', appTabs: ['details', 'inspiration'] } as unknown as CardDetail
  const out = (cardResult(tabbed).content[0] as { text: string }).text
  assert.match(out, /\(id card-1, appUrl https:\/\/app\.contenthero\.ai\/card\/CardAbcD, tabs details\|inspiration\)/)
})
