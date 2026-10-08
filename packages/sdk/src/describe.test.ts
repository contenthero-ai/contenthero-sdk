import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRenderFailure, describeScope } from './describe.js'

/**
 * The words the MCP and the CLI share for a read's scope and a render's failure. One copy each, so the two surfaces
 * cannot drift into saying different things about the same response.
 *
 * Break-verified: dropping the track from `describeScope` turns the first red; ignoring a range's missing frames turns
 * the third red.
 */

test('a scoped read names its window and track, or its slide', () => {
  assert.equal(
    describeScope({ fromFrame: 600, toFrame: 629, trackId: 'main' }),
    'Scoped read (frames 600 to 629, track main): the state is that part of the project, not all of it.',
  )
  assert.equal(describeScope({ toFrame: 90 }), 'Scoped read (frames start to 90): the state is that part of the project, not all of it.')
  assert.equal(describeScope({ slideId: 's2' }), 'Scoped read (slide s2): the state is that part of the project, not all of it.')
})

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

test('describeFileSize reads as the app shows a size', async () => {
  const { describeFileSize } = await import('./describe.js')
  assert.equal(describeFileSize(512), '512 B')
  assert.equal(describeFileSize(2048), '2.0 KB')
  assert.equal(describeFileSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(describeFileSize(3 * 1024 * 1024 * 1024), '3.0 GB')
})
