import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewDescription } from './tool-text.js'

test('view says contact sheets are lossy and never for telling renders apart', () => {
  for (const audience of ['mcp', 'in-app'] as const) {
    const text = viewDescription(audience)
    assert.match(text, /contact sheet is a lossy, downscaled copy/)
    assert.match(text, /never to measure or to test whether two renders differ/)
  }
})
