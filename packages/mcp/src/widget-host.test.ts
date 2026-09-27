import { test } from 'node:test'
import assert from 'node:assert/strict'
import { App } from '@modelcontextprotocol/ext-apps'
import { canHover, composerBand, insetsOf, themeOf } from '../widget/src/host.js'
import { ZOOM_SCALE, clampPan, classifyRelease, isDoubleTap, zoomAt } from '../widget/src/gestures.js'

/**
 * ⭐⭐ THE THEME FIX RESTS ON THE APP MERGING A CHANGE BEFORE IT NOTIFIES. The widget reads `getHostContext()` on
 * every change and never the payload, which carries only what changed. This pins that library behavior: if an
 * upgrade stopped merging, the widget would lose its theme on every expand again, and this is where it shows.
 */
test('a host context change is merged into getHostContext before listeners run', async () => {
  const app = new App({ name: 'test', version: '1' }, {})
  ;(app as unknown as { _hostContext: unknown })._hostContext = { theme: 'light', displayMode: 'inline' }
  let payload: unknown
  let merged: unknown
  app.addEventListener('hostcontextchanged', (p) => {
    payload = p
    merged = app.getHostContext()
  })
  const handlers = (app as unknown as { _notificationHandlers: Map<string, (n: unknown) => unknown> })
    ._notificationHandlers
  const handler = handlers.get('ui/notifications/host-context-changed')
  assert.ok(handler, 'the host-context-changed handler is registered')
  await handler({ method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } })
  assert.deepEqual(payload, { displayMode: 'fullscreen' })
  assert.equal(themeOf(payload as never), 'dark', 'the payload alone reads as dark: the old bug')
  assert.equal(themeOf(merged as never), 'light')
})

test('theme: light only when the host says light', () => {
  assert.equal(themeOf({ theme: 'light' }), 'light')
  assert.equal(themeOf({ theme: 'dark' }), 'dark')
  assert.equal(themeOf(undefined), 'dark')
})

test("hover: the host's answer wins, the media query is the fallback", () => {
  assert.equal(canHover({ deviceCapabilities: { hover: false } }, false), false)
  assert.equal(canHover({ deviceCapabilities: { hover: true } }, true), true)
  assert.equal(canHover({}, true), false)
  assert.equal(canHover(undefined, false), true)
})

test('insets: clamped at zero, zero when absent', () => {
  assert.deepEqual(insetsOf({ safeAreaInsets: { top: 47, right: 0, bottom: 34, left: -3 } }), {
    top: 47, right: 0, bottom: 34, left: 0,
  })
  assert.deepEqual(insetsOf(undefined), { top: 0, right: 0, bottom: 0, left: 0 })
})

test('composer band: a phone uses its bottom inset; desktop keeps the clamped estimate', () => {
  assert.equal(composerBand({ platform: 'mobile', safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 } }, 800), 42)
  assert.equal(composerBand({ platform: 'desktop', containerDimensions: { height: 800 } }, 800), 132)
  assert.equal(composerBand({ containerDimensions: { height: 500 } }, 800), 240)
  assert.equal(composerBand({ containerDimensions: { height: 640 } }, 800), 184)
  assert.equal(composerBand({ platform: 'mobile' }, 800), null)
  assert.equal(composerBand(undefined, 800), null)
})

test('release: tap, swipe left is next, swipe right is previous, a slow or vertical drag is neither', () => {
  assert.equal(classifyRelease(2, 3, 120), 'tap')
  assert.equal(classifyRelease(-80, 10, 200), 'next')
  assert.equal(classifyRelease(80, -10, 200), 'previous')
  assert.equal(classifyRelease(60, 70, 200), 'none')
  assert.equal(classifyRelease(-80, 0, 1200), 'none')
  assert.equal(classifyRelease(20, 0, 200), 'none')
})

test('double tap: close in time and place', () => {
  const first = { x: 100, y: 100, t: 1000 }
  assert.equal(isDoubleTap(null, first), false)
  assert.equal(isDoubleTap(first, { x: 110, y: 105, t: 1200 }), true)
  assert.equal(isDoubleTap(first, { x: 110, y: 105, t: 1400 }), false)
  assert.equal(isDoubleTap(first, { x: 160, y: 100, t: 1100 }), false)
})

test('zoom keeps the tapped point in place, and a pan cannot leave the content', () => {
  const box = { width: 400, height: 300 }
  const center = zoomAt({ x: 200, y: 150 }, box, ZOOM_SCALE)
  assert.equal(Math.abs(center.x) + Math.abs(center.y), 0, 'a tap at the center needs no translation')
  const t = zoomAt({ x: 300, y: 150 }, box, ZOOM_SCALE)
  // The point lands at c + (p - c) * s + t, which must equal p.
  assert.equal(200 + (300 - 200) * ZOOM_SCALE + t.x, 300)
  assert.deepEqual(clampPan({ x: 1000, y: -1000 }, box, ZOOM_SCALE), { x: 300, y: -225 })
})
