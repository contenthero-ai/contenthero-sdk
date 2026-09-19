import { test } from 'node:test'
import assert from 'node:assert/strict'
import { table, keyValues } from './output.js'

/**
 * ⚠️ **THESE ASSERT LAYOUT, NOT COLOR, AND THE TEST SCRIPT SETS `NO_COLOR=1` TO KEEP THAT TRUE.**
 *
 * 🚨 The comment that used to sit here said picocolors "honors NO_COLOR / non-TTY, so under `node --test`
 * these render without ANSI codes, making the assertions stable". **The second half did not follow from
 * the first.** Nothing set `NO_COLOR`, and `node --test` does not guarantee a non-TTY stdout, so color
 * was decided by however the suite happened to be launched: green through a pipe, red in a terminal. The
 * same code and the same input gave two answers. Measured 2026-09-19, when `npm test --workspaces` passed
 * and `npm test -w @contenthero/cli` failed on these two.
 *
 * ⛔ **A GUARANTEE THAT NOBODY BUILT READS EXACTLY LIKE ONE THAT WAS.** The script now actually sets it.
 *
 * Forcing the no-color path once, in the script, is deliberate rather than stripping ANSI per assertion:
 * what these protect is column alignment and the absence of trailing whitespace, and saying that in one
 * place beats repeating a `.replace()` inside every expectation.
 */

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
