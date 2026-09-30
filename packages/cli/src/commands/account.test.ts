import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSpendCap } from './account.js'

test('account update --spend-cap takes whole credits or "none", and refuses anything else', () => {
  assert.equal(parseSpendCap('25000'), 25000)
  assert.equal(parseSpendCap('none'), null)
  assert.equal(parseSpendCap('None'), null)
  for (const bad of ['0', '-5', '12.5', 'abc', '']) {
    assert.throws(() => parseSpendCap(bad), /whole number of credits/, bad)
  }
})
