/**
 * What the widget reads from the HOST'S CONTEXT, as pure functions of it.
 *
 * ⭐⭐ ALWAYS THE MERGED CONTEXT, NEVER A CHANGE NOTIFICATION'S PAYLOAD.
 *
 * A `hostcontextchanged` notification carries ONLY the fields that changed. The App merges it into the
 * context it keeps (`getHostContext()`) before telling us, so that is the whole state and the payload is a
 * diff. Reading the payload as the state is what flipped a light widget to dark on entering fullscreen: the
 * host sent `{ displayMode }`, the payload had no theme, and a missing theme reads as dark.
 */

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** The fields of the host context this widget uses. Every one is optional: a host may send none of them. */
export interface HostLayout {
  theme?: string
  displayMode?: string
  platform?: string
  deviceCapabilities?: { touch?: boolean; hover?: boolean }
  safeAreaInsets?: Insets
  containerDimensions?: { height?: number; maxHeight?: number }
}

/** A host that reports no theme gets the dark treatment, which stays legible on a light background. */
export function themeOf(ctx: HostLayout | undefined): 'light' | 'dark' {
  return ctx?.theme === 'light' ? 'light' : 'dark'
}

/**
 * Whether the person can hover. The host's own answer wins; without one, the frame's `(hover: none)` media query,
 * which reports the device the frame runs on.
 */
export function canHover(ctx: HostLayout | undefined, mediaSaysNoHover: boolean): boolean {
  const reported = ctx?.deviceCapabilities?.hover
  return typeof reported === 'boolean' ? reported : !mediaSaysNoHover
}

/** The host's safe-area insets, each clamped at zero; all zero when the host reports none. */
export function insetsOf(ctx: HostLayout | undefined): Insets {
  const i = ctx?.safeAreaInsets
  const side = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0)
  return { top: side(i?.top), right: side(i?.right), bottom: side(i?.bottom), left: side(i?.left) }
}

/**
 * How much of the fullscreen frame's bottom the host covers (its composer), in pixels, or null when there is
 * nothing to go on.
 *
 * ⭐ ON A PHONE, THE HOST SAYS SO: a mobile host reports `safeAreaInsets`, and its bottom inset is the part of the
 * frame it keeps for itself. That is taken as given, plus a small margin, instead of the desktop estimate, whose
 * 132px floor left a band of dead space under the picture on a screen that has none to spare.
 *
 * ⚠️ ON DESKTOP, THE ESTIMATE STAYS. Desktop hosts draw their composer over the frame without reporting an inset,
 * so the band is the viewport below the container the host gave us, clamped to 132 to 240px.
 *
 * ⚠️ THE 132px FLOOR IS THE COMPOSER PLUS A MARGIN, NOT A GUESS AT THE ARROW. The host's scroll-to-bottom arrow
 * floats over the INLINE frame and takes the pointer, which is why this was once 184px; measured 2026-09-21, a
 * fullscreen frame shows the composer and no arrow. If an arrow ever does appear over a fullscreen frame, the
 * symptom is a button that responds only when the cursor is slightly off it: raise this, do not chase the button.
 */
export function composerBand(ctx: HostLayout | undefined, innerHeight: number): number | null {
  if (ctx?.platform === 'mobile' && ctx.safeAreaInsets) return insetsOf(ctx).bottom + 8
  const dims = ctx?.containerDimensions
  const given = dims?.height ?? dims?.maxHeight
  if (!given || !innerHeight) return null
  return Math.round(Math.min(240, Math.max(132, innerHeight - given + 24)))
}
