import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrandKit, BrandKitAccount } from '@contenthero/sdk'
import { brandKitResult } from './format.js'

/**
 * The full get_brand_kit read shows linked accounts as an AI needs them. A kit linked to 68 inspiration accounts
 * made the read about 60 KB (measured 2026-09-26), most of it signed avatar links a model cannot use.
 */

const account = (i: number, accountType: string): BrandKitAccount => ({
  id: `acc-${accountType}-${i}`,
  platform: 'instagram',
  name: `Creator ${i}`,
  handle: `creator${i}`,
  avatarUrl: `https://media.contenthero.ai/profiles/${i}/avatar.jpg?sig=${'x'.repeat(600)}`,
  followerCount: 1000 + i,
  accountType,
})

const kit = {
  id: 'kit-1',
  name: 'Test kit',
  isDefault: false,
  brandAccounts: [account(0, 'brand')],
  inspirationAccounts: Array.from({ length: 68 }, (_, i) => account(i + 1, 'inspiration')),
  sections: [],
  logos: [{ url: 'https://media.contenthero.ai/logo.png' }],
} as unknown as BrandKit

const printed = (): string => {
  const block = brandKitResult(kit).content[0]
  assert.equal(block.type, 'text')
  return (block as { text: string }).text
}

const parsed = () => JSON.parse(printed().slice(printed().indexOf('{')))

test('linked accounts keep who they are and drop the avatar link and the repeated type', () => {
  const out = parsed()
  assert.deepEqual(out.brandAccounts[0], {
    id: 'acc-brand-0',
    platform: 'instagram',
    name: 'Creator 0',
    handle: 'creator0',
    followerCount: 1000,
  })
  assert.equal(out.inspirationAccounts.length, 68)
  assert.ok(!printed().includes('avatar.jpg'), 'no avatar link reaches the model')
})

test('the rest of the kit is unchanged, logos included', () => {
  const out = parsed()
  assert.deepEqual(out.logos, [{ url: 'https://media.contenthero.ai/logo.png' }])
  assert.equal(out.name, 'Test kit')
})

test('68 inspiration accounts cost a few KB, not tens', () => {
  assert.ok(printed().length < 15_000, `printed ${printed().length} chars`)
})
