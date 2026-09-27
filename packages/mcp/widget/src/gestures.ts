/**
 * The fullscreen viewer's touch gestures, as pure geometry: swipe between variations, double-tap to zoom, drag to
 * pan while zoomed. The component feeds pointer positions in; nothing here touches the DOM.
 */

export interface Point {
  x: number
  y: number
}

export interface Box {
  width: number
  height: number
}

/** A tap: a press that neither moved nor lingered. */
const TAP_SLOP = 10
const TAP_MS = 300
/** A double tap: the second tap lands this close to the first, this soon after it. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 30
/** A swipe: far enough, mostly sideways, and quick enough to read as a flick rather than a drag. */
const SWIPE_MIN = 48
const SWIPE_MS = 800

/** How far a double tap zooms in. */
export const ZOOM_SCALE = 2.5

export type Release = 'next' | 'previous' | 'tap' | 'none'

/** What a press that moved `dx`,`dy` over `ms` milliseconds was. A leftward swipe goes to the NEXT variation. */
export function classifyRelease(dx: number, dy: number, ms: number): Release {
  if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP && ms < TAP_MS) return 'tap'
  if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > 1.5 * Math.abs(dy) && ms < SWIPE_MS) {
    return dx < 0 ? 'next' : 'previous'
  }
  return 'none'
}

/** Whether a tap at `now` completes a double tap begun by the tap at `before`. */
export function isDoubleTap(before: (Point & { t: number }) | null, now: Point & { t: number }): boolean {
  if (!before) return false
  return now.t - before.t < DOUBLE_TAP_MS && Math.hypot(now.x - before.x, now.y - before.y) < DOUBLE_TAP_SLOP
}

/**
 * Keep a translation inside the zoomed content, so a pan cannot drag the picture off screen. With the transform
 * `translate(t) scale(s)` about the box's center, the content overhangs the box by `(s - 1) * size / 2` per side.
 */
export function clampPan(t: Point, box: Box, scale: number): Point {
  const maxX = ((scale - 1) * box.width) / 2
  const maxY = ((scale - 1) * box.height) / 2
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v))
  return { x: clamp(t.x, maxX), y: clamp(t.y, maxY) }
}

/**
 * The translation that zooms to `scale` while keeping the point under the finger where it is. `at` is relative to
 * the box's top-left. About the center c, a point p lands at `c + (p - c) * s + t`; holding it at p gives
 * `t = (p - c) * (1 - s)`, then clamped.
 */
export function zoomAt(at: Point, box: Box, scale: number): Point {
  const cx = box.width / 2
  const cy = box.height / 2
  return clampPan({ x: (at.x - cx) * (1 - scale), y: (at.y - cy) * (1 - scale) }, box, scale)
}
