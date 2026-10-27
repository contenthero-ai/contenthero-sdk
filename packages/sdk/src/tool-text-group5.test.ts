import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewDescription, updateTimelineDescription } from './tool-text.js'

test('view says contact sheets are lossy and never for telling renders apart', () => {
  for (const audience of ['mcp', 'in-app'] as const) {
    const text = viewDescription(audience)
    assert.match(text, /contact sheet is a lossy, downscaled copy/)
    assert.match(text, /never to measure or to test whether two renders differ/)
  }
})

test('update_timeline names the keyframe run end and what a range operation cuts', () => {
  for (const audience of ['mcp', 'in-app'] as const) {
    const text = updateTimelineDescription(audience)
    assert.match(text, /endsAtClipEnd, on add_keyframe and in the patch of update_keyframe/)
    assert.match(text, /linked lanes at the same frames: linkage and the link mask decide that, the magnet only decides whether the gap closes/)
    assert.doesNotMatch(text, /[–—]/)
  }
})
