import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRenderFailure } from './describe.js'

/**
 * The words the MCP and the CLI share for a render's failure. One copy, so the two surfaces cannot drift into saying
 * different things about the same response.
 *
 * Break-verified: ignoring a range's missing frames turns the second red.
 */

test('a render with no error has nothing to say', () => {
  assert.equal(describeRenderFailure({ mode: 'image', dataUrl: 'data:image/webp;base64,AA' }), null)
  assert.equal(describeRenderFailure(null), null)
})

test('a failed render, and the frames of a range that did not render, are said in words', () => {
  assert.equal(
    describeRenderFailure({ mode: 'image', error: { code: 'render_unavailable', message: 'Rendering is unavailable right now.' } }),
    'The render produced no image. render_unavailable: Rendering is unavailable right now.',
  )
  assert.equal(
    describeRenderFailure({ mode: 'image', missingFrames: [30], error: { code: 'render_failed', message: 'Lambda timed out' } }),
    '1 frame could not be rendered (frames 30). render_failed: Lambda timed out',
  )
})
