import { test } from 'node:test'
import assert from 'node:assert/strict'

import { colorRefs, typographyRefs } from './brandkit.js'

/**
 * `--color` and the font flags are how a terminal writes a kit's palette and fonts. The server holds the rules
 * (hex format, the role list, one color per role); these only turn flags into the fields the API takes.
 */

test('--color reads hex, then an optional role, then an optional name that may hold a colon', () => {
  assert.deepEqual(colorRefs(['#1A2B3C:primary:Ocean', '#ffffff::Paper', '#000000:accent', '#123456:secondary:Ratio 3:2']), [
    { hex: '#1A2B3C', role: 'primary', name: 'Ocean' },
    { hex: '#ffffff', name: 'Paper' },
    { hex: '#000000', role: 'accent' },
    { hex: '#123456', role: 'secondary', name: 'Ratio 3:2' },
  ])
})

test('--color none clears the palette, and no --color leaves it alone', () => {
  assert.deepEqual(colorRefs(['none']), [])
  assert.equal(colorRefs(undefined), undefined)
})

test('the font flags send only the fonts named, none as null, so the server keeps the other', () => {
  assert.deepEqual(typographyRefs({ titleFont: 'Manrope' }), { titleFont: 'Manrope' })
  assert.deepEqual(typographyRefs({ bodyFont: 'none' }), { bodyFont: null })
  assert.equal(typographyRefs({}), undefined)
})
