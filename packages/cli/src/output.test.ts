import { test } from 'node:test'
import assert from 'node:assert/strict'
import { table, keyValues } from './output.js'

// picocolors honors NO_COLOR / non-TTY, so under `node --test` these render
// without ANSI codes, making the assertions stable.

test('table aligns columns to the widest cell and trims trailing space', () => {
  const out = table(
    ['MODEL', 'TYPE'],
    [
      ['gpt-image-2', 'image'],
      ['kling-3.0', 'video'],
    ],
  )
  const lines = out.split('\n')
  assert.equal(lines[0], 'MODEL        TYPE')
  assert.equal(lines[1], 'gpt-image-2  image')
  assert.equal(lines[2], 'kling-3.0    video')
  // no trailing whitespace on any line
  for (const l of lines) assert.equal(l, l.replace(/\s+$/, ''))
})

test('table tolerates missing cells', () => {
  const out = table(['A', 'B'], [['x']])
  assert.equal(out.split('\n')[1], 'x')
})

test('keyValues pads keys and renders values', () => {
  const out = keyValues([
    ['Tier', 'legend'],
    ['Auto top-up', 'off'],
  ])
  const lines = out.split('\n')
  assert.match(lines[0], /^Tier:\s+legend$/)
  assert.match(lines[1], /^Auto top-up:\s+off$/)
})
