import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TierListDetail } from '@contenthero/sdk'
import { tierListResult } from './format.js'

const detail = {
  id: 'l1-uuid',
  shortId: 'l1',
  appUrl: 'https://app/tier-lists/l1',
  name: 'Board',
  showPoints: true,
  tiers: [
    { id: 't1-uuid', shortId: 't1', label: 'C', points: 1 },
    { id: 't2-uuid', shortId: 't2', label: 'B', points: 2 },
    { id: 't3-uuid', shortId: 't3', label: 'A', points: 0 },
  ],
  tabs: [{ id: 'a-uuid', shortId: 'a', appUrl: 'https://app/tier-lists/l1/tabs/a', name: 'Alpha', revision: 1 }],
  tab: { id: 'a-uuid', shortId: 'a', appUrl: 'https://app/tier-lists/l1/tabs/a', name: 'Alpha', revision: 1 },
  items: [
    { id: 'i1-uuid', shortId: 'i1', tabId: 'a-uuid', tierId: 't1-uuid', label: 'Qwen', caption: null, mediaId: 'm1', inTrash: false },
    { id: 'i2-uuid', tabId: 'a-uuid', tierId: null, label: null, caption: null, mediaId: null, inTrash: false },
  ],
  standings: [
    { rank: 1, tied: false, label: 'Qwen', total: 1, placements: 1 },
    { rank: 2, tied: false, label: 'Flux', total: 2, placements: 2 },
    { rank: 3, tied: false, label: 'Zed', total: 0, placements: 0 },
  ],
} as unknown as TierListDetail

test('the tier list reply uses the singular for exactly one point and one placement', () => {
  const out = JSON.stringify(tierListResult(null, detail))
  assert.match(out, /C \(id t1, 1 point\)/)
  assert.match(out, /B \(id t2, 2 points\)/)
  assert.match(out, /A \(id t3, 0 points\)/)
  assert.match(out, /Qwen, 1 point, 1 placement[^s]/)
  assert.match(out, /Flux, 2 points, 2 placements/)
  assert.match(out, /Zed, 0 points, 0 placements/)
  assert.doesNotMatch(out, /\(s\)/)
})

test('the tier list reply names the list, tiers, tabs and items by short id, and a record without one by its id', () => {
  const out = JSON.stringify(tierListResult(null, detail))
  assert.match(out, /\(id l1,/)
  assert.match(out, /Tabs: Alpha \(id a, revision 1\)/)
  assert.match(out, /Showing tab Alpha \(id a, revision 1\)/)
  assert.match(out, /item i1: Qwen/)
  assert.match(out, /item i2-uuid: no label/)
  assert.equal(out.match(/tier-lists\/l1\/tabs\/a/g)?.length ?? 0, 0, 'an id carries no link of its own')
  assert.equal(out.match(/tier-lists\/l1(?!\/)/g)?.length ?? 0, 1, 'the list link is shown once')
  assert.doesNotMatch(out, /l1-uuid|t1-uuid|a-uuid|i1-uuid/)
})
