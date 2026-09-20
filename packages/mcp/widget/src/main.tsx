/**
 * The generation widget: what a person SEES when ContentHero makes something for them.
 *
 * ## Why this exists at all
 *
 * MCP's content blocks are `text | image | audio | resource | resource_link`. **There is no video block**,
 * so no arrangement of blocks can put a playing video in a conversation. Measured in production: a
 * `resource_link` rendered as a hyperlink in ChatGPT and as NOTHING in Claude.
 *
 * ⭐⭐ AND A `resource_link` IS WORSE THAN THAT. Measured 2026-09-20 against the reference implementation:
 * Higgsfield's `show_medias` returned one and the host answered **"Resource links are not currently
 * supported"**, so their widget mounted with no media in it. Attaching the bytes and feeding the widget from
 * `structuredContent` is why ours renders where theirs does not.
 *
 * ## The layout decision, which is deliberately NOT a copy of the reference
 *
 * ⭐⭐⭐ **VARIATIONS EXIST TO BE COMPARED, SO THEY ARE SHOWN TOGETHER.** The reference uses one horizontal
 * row with arrows, which makes comparison SERIAL: variation 1 and variation 4 can never be on screen at
 * once, and choosing between them is the entire reason four were generated. A grid makes it parallel. Their
 * carousel is a concession to horizontal space, not a thing to inherit.
 */
import { createRoot } from 'react-dom/client'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import { ModelGlyph } from './model-icon.js'
import {
  columnsForAspect,
  aspectToCss,
  parseAspectRatio,
  laurelKeyframes,
  laurelLeafClass,
  LAUREL_PATHS,
  LAUREL_VIEW_BOX,
  LAUREL_GOLD,
} from '@contenthero-ai/brand-ui'

interface Output {
  readonly url: string
  readonly posterUrl?: string | null
  readonly name: string
}

interface WidgetData {
  readonly outputId: string
  readonly contentType: 'image' | 'video' | 'audio'
  readonly modelId: string
  /**
   * ⛔ **NULL MEANS RENDER NO CHIP. NEVER FALL BACK TO `modelId`.** This carried `modelName ?? modelId`
   * until the server resolved it properly, and `gpt-image-2` reads enough like a label that a failed
   * lookup showed up as a chip flickering between kebab case and title case instead of as a failure.
   */
  readonly modelName?: string | null
  readonly modelBrandColor?: string | null
  readonly modelIconKey?: string | null
  /** `"W:H"` from the row, or null for audio. Drives both the column count and each tile's own shape. */
  readonly displayAspect?: string | null
  readonly outputs: readonly Output[]
  readonly prompt?: string | null
  /**
   * ⭐ `'processing'` is what makes the placeholders possible. A generation that outran the server's smart
   * wait used to come back as one sentence of prose asking the agent to poll, which is every video, so the
   * person who waited longest saw the least.
   */
  readonly status?: 'processing' | 'completed'
  /** How many outputs were asked for. Drives how many placeholders are drawn. */
  readonly expected?: number
  /** Seconds the server suggests waiting between polls. Images finish faster than video. */
  readonly pollAfterSeconds?: number
}

/**
 * ⚠️ THE TWO BRAND VALUES, AND WHY THEY DO NOT INVERT.
 *
 * Olympus Gold and obsidian are fixed. The app's `--obsidian-black` token deliberately flips to near-white
 * in dark mode because it is the brand foreground against the PAGE, but a button here carries its own
 * background, so its foreground must stay white in both themes for the same reason content on gold does.
 * Inverting would produce a near-white label on a near-white button in one of the two.
 *
 * ⭐ Everything else (surfaces, borders, body text) comes from the HOST, so the block sits in someone
 * else's conversation looking native rather than like a pasted-in dark slab.
 */
const GOLD = '#d4af37'
const OBSIDIAN = '#121212'

const styles = `
  /**
   * THE TWO CHIP TOKENS, SET FROM THE HOST'S REPORTED THEME.
   *
   * The defaults here are the DARK treatment, which is also what an absent theme gets: a host that reports
   * nothing is more likely dark than light in these clients, and a near-black pill with white content is
   * legible against a light background too, where the inverse is not. data-theme is stamped on <html> from
   * the host context, so a toggle repaints without remounting anything.
   */
  :root {
    color-scheme: light dark;
    --chip-bg: ${OBSIDIAN};
    --chip-fg: #ffffff;
  }
  :root[data-theme='light'] {
    --chip-bg: #f2f2f2;
    --chip-fg: ${OBSIDIAN};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 var(--font-sans, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
    color: var(--color-text-primary, CanvasText);
    background: transparent;
  }
  .wrap {
    border: 1px solid var(--color-border-primary, color-mix(in srgb, CanvasText 14%, transparent));
    border-radius: var(--border-radius-lg, 14px);
    overflow: hidden;
    background: var(--color-background-secondary, Canvas);
  }

  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
  .head .mark { width: 18px; height: 18px; flex: 0 0 auto; }
  .head .title { font-weight: var(--font-weight-semibold, 600); }
  /* The brand's only flourish: a gold hairline that fades out rather than a full-width rule. */
  .rule { height: 1px; background: linear-gradient(90deg, ${GOLD}, transparent 65%); }

  .meta { padding: 10px 12px 0; display: flex; flex-direction: column; gap: 8px; }
  .prompt { margin: 0; cursor: pointer; color: var(--color-text-secondary, color-mix(in srgb, CanvasText 60%, transparent)); }
  .prompt.clamped { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  /**
   * THE MODEL PILL, AND WHY IT CARRIES ITS OWN SURFACE.
   *
   * A brand glyph is a single-color shape. Drawn straight onto the host's background it is invisible in one
   * of the two themes, and the frame has no say over which theme that is. So the pill paints a surface it
   * controls and the glyph inherits the pill's own text color through currentColor, which is the whole
   * reason the Mono variant is imported instead of the colored one.
   *
   * ⭐⭐ IT FLIPS WITH THE HOST RATHER THAN COMMITTING TO ONE. The host reports theme on its context and
   * fires hostcontextchanged when a person toggles, so dark mode gets a near-black pill with white content
   * and light mode gets a near-white pill with near-black content. Committing to a dark pill in both would
   * have been the fallback, and it is still what an absent theme gets, by way of the defaults below.
   *
   * ⚠️ The BRAND COLOR stays on the dot and never becomes the pill's background. Sixty-six registry colors
   * chosen to read against the app's own surfaces cannot all clear a contrast bar against text in someone
   * else's chat, and a pill nobody can read is worse than one that is merely plain.
   */
  .badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
    border-radius: 999px; font-size: 12px; font-weight: 500;
    background: var(--chip-bg); color: var(--chip-fg);
  }
  .badge .dot { width: 6px; height: 6px; border-radius: 999px; background: ${GOLD}; flex: 0 0 auto; }
  /* The glyph is already the brand's mark, so a colored dot beside it says the same thing twice. */
  .badge.model .dot { display: none; }
  .badge.model.no-glyph .dot { display: block; }

  /**
   * ⭐ A GRID, NOT A CAROUSEL. The reference uses one horizontal row with arrows, which makes comparison
   * SERIAL: variation 1 and variation 4 can never be on screen at once, and choosing between them is the
   * entire reason four were generated.
   *
   * ⭐⭐⭐ **THE COLUMN COUNT COMES FROM THE SHAPE, VIA --cols.** This was 1fr 1fr for every count, so
   * four 9:16 images sat two-up and each one had to be shrunk to fit, which is where the letterboxing came
   * from. Four portrait images belong on ONE row; two 16:9 images already fill it. The rule is
   * columnsForAspect in @contenthero-ai/brand-ui, shared with the studio's row view so the same batch
   * is arranged the same way in both places.
   *
   * ⚠️ min() with the count, so three outputs under a four-column rule make three columns rather than
   * three columns and a hole.
   */
  .grid { display: grid; gap: 8px; padding: 10px 12px; grid-template-columns: repeat(var(--cols, 2), 1fr); }

  /**
   * ⛔⛔⛔ **THE TILE IS THE IMAGE. IT IS NOT A BOX WITH AN IMAGE INSIDE IT.**
   *
   * The tile used to be a fixed max-height: 220px container with object-fit: contain, so anything whose
   * shape disagreed with the container got bars painted around it. Four portrait images in landscape boxes
   * is most of what looked wrong here.
   *
   * ⭐ Giving the tile the generation's own aspect-ratio leaves nothing over to letterbox: the box takes
   * the shape of its content, the image covers it exactly, and the visible edge is the picture's edge.
   * --ar is set per tile from displayAspect, which the server now sends.
   *
   * ⚠️ object-fit: cover is safe ONLY because the tile's ratio IS the media's ratio. If the two ever
   * disagree, cover crops silently. The fallback below is contain for exactly that case: a missing
   * displayAspect means we do not know the shape, and cropping on a guess is worse than a bar.
   */
  .tile {
    position: relative; overflow: hidden; border-radius: var(--border-radius-md, 10px);
    background: var(--color-background-tertiary, color-mix(in srgb, CanvasText 6%, transparent));
    border: 1px solid transparent; padding: 0; display: block; width: 100%;
  }
  .tile.img { cursor: zoom-in; }
  .tile:focus-within { outline: 2px solid ${GOLD}; outline-offset: 2px; }
  /**
   * THE HEIGHT CAP, AND WHY IT IS EXPRESSED AS A MAX-WIDTH.
   *
   * A single 9:16 output at full column width is over 1000px tall in a chat, which is the opposite problem
   * from the letterboxing. But capping the HEIGHT of a box that already has a definite width and an
   * aspect-ratio does not shrink it: both axes are then constrained, the ratio is dropped, and
   * object-fit: cover silently CROPS the picture. That trades a visible bar for an invisible loss.
   *
   * Bounding the WIDTH keeps the ratio authoritative. --ar-num is the same ratio as a plain number, so the
   * widest a tile may be is cap times ratio, and its height therefore lands at or under the cap by
   * construction. A tall tile narrows and centers; a wide one is untouched because the bound never binds.
   */
  .tile.shaped {
    aspect-ratio: var(--ar);
    max-width: calc(420px * var(--ar-num, 1));
    margin-inline: auto;
  }
  .tile.shaped img, .tile.shaped video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Shape unknown: contain inside a bounded box, because cropping on a guess is worse than a bar. */
  .tile.unshaped img, .tile.unshaped video { display: block; width: 100%; height: auto; max-height: 260px; object-fit: contain; }
  .tile audio { width: 100%; padding: 22px 14px; }

  /*
   * A PLACEHOLDER IS THE SAME TILE, so it occupies exactly the space its output will. Anything else makes
   * the grid jump when the media lands, which reads as a glitch rather than as an arrival.
   */
  .laurel-wrap {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: var(--color-background-tertiary, color-mix(in srgb, CanvasText 6%, transparent));
  }
  .laurel-wrap .laurel { width: 38%; max-width: 72px; height: auto; }

  /*
   * ⭐⭐⭐ THE HANDOFF: THE LAUREL STAYS UNTIL THE PIXELS ARE THERE, THEN THE MEDIA REPLACES IT AT ONCE.
   *
   * ⛔ **NO CROSS-FADE, AND NO FADE AT ALL.** Read the studio before assuming otherwise, because its own
   * comment says "skeleton->resolve crossfade" and the code does not do that. In BOTH studio views the
   * skeleton and the media are never on screen together: the masonry view swaps component types across a
   * ternary, and the row view swaps a motion.div wrapper for a plain div, so React unmounts the skeleton
   * and mounts a fresh card whose reveal starts from opacity 0.
   *
   * ⚠️ Which means the studio has a GAP: the skeleton is gone the moment the row flips to completed, and
   * the image only appears once it has decoded. This keeps the studio's instant swap and removes the gap,
   * by holding the laurel until the pixels exist rather than until the status changes.
   */
  .tile .media { visibility: hidden; }
  .tile.ready .media { visibility: visible; }
  /* Audio has no decode event worth waiting on and no picture to hide, so it is ready on arrival. */
  .tile.audio .media { visibility: visible; }

  /* Actions live ON the thing they act on. Hidden until hover, but never unreachable by keyboard. */
  .acts { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity .12s ease; z-index: 1; }
  .tile:hover .acts, .tile:focus-within .acts { opacity: 1; }
  @media (hover: none) { .acts { opacity: 1; } }

  .pill {
    appearance: none; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 13px; border-radius: 999px; border: 1px solid transparent;
    background: ${OBSIDIAN}; color: #fff;
  }
  .pill:hover { background: #1e1e1e; }
  .pill:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
  .pill.ghost {
    background: transparent; color: inherit;
    border-color: var(--color-border-secondary, color-mix(in srgb, CanvasText 20%, transparent));
  }
  .pill.ghost:hover { border-color: ${GOLD}; }
  .pill.gold { background: ${GOLD}; color: ${OBSIDIAN}; }
  .pill[disabled] { opacity: .6; cursor: default; }
  /* A refused download must not look like one that worked. Gold is the brand's attention color. */
  .pill.warn { border-color: ${GOLD}; color: ${GOLD}; }
  /*
   * A pill with only a glyph in it is a CIRCLE. The reference draws squircles; fully round reads as an
   * action rather than a small panel, and it is the shape the rest of this widget already uses.
   */
  .acts .pill { padding: 0; width: 30px; height: 30px; justify-content: center; border-radius: 999px; }
  .acts .pill.warn { width: auto; padding: 0 12px; }

  .bar {
    display: flex; align-items: center; gap: 8px; padding: 10px 12px; flex-wrap: wrap;
    border-top: 1px solid var(--color-border-primary, color-mix(in srgb, CanvasText 14%, transparent));
  }
  .muted { color: var(--color-text-secondary, color-mix(in srgb, CanvasText 55%, transparent)); font-size: 13px; }
  .spacer { flex: 1 1 auto; }
  .fallback { padding: 18px; }

  /**
   * FULLSCREEN. ⚠️⚠️ "min-height: 0" ON THE MEDIA ROW IS LOAD-BEARING. A flex child defaults to
   * "min-height: auto", so a tall image refuses to shrink below its content size and pushes the thumbnail
   * strip off the bottom of the frame. That is exactly the clipping reported before this comment existed.
   */
  /*
   * ⚠️ 96px OF PADDING AT THE BOTTOM, ON THE CONTAINER. The host's composer floats over this frame, and
   * everything inside used to compensate for it individually: the strip carried the whole 96px itself, so
   * adding a foot below the strip put the foot back underneath the composer. Reserving the band ONCE, on
   * the thing that owns the layout, means anything added at the bottom later is already clear of it.
   */
  .full { position: fixed; inset: 0; display: flex; flex-direction: column; padding-bottom: 96px; background: var(--color-background-primary, Canvas); }
  .full .stage { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .full .stage img, .full .stage video { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
  /* ⚠️ The host's composer overlays the bottom of a fullscreen frame, so the strip needs room BELOW it or
     it sits behind the message box. Measured: clipped by roughly a composer's height. */
  .full .strip { flex: 0 0 auto; display: flex; gap: 8px; padding: 10px 16px 14px; overflow-x: auto; justify-content: center; }
  .full .strip .t { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; background: none; flex: 0 0 auto; }
  .full .strip .t[aria-current="true"] { border-color: ${GOLD}; }
  .full .strip .t img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /*
   * ⚠️ THE HOST'S COMPOSER OVERLAYS THE BOTTOM OF A FULLSCREEN FRAME. The foot was pressed flat against it
   * with no breathing room, so the actions read as squeezed against the message box rather than as part of
   * the picture above them. The strip already reserves 96px below itself for the same reason; the foot
   * sits inside that reserved band, which is why its own bottom padding is zero when a strip is present.
   */
  .full .foot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px 28px; flex-wrap: wrap; }
  .full .strip + .foot { padding-bottom: 0; }
`

/**
 * ⛔ **THE LAUREL'S PATHS ARE NO LONGER COPIED INTO THIS FILE.**
 *
 * They were, and they were the THIRD hand-copy of one shape. A copied path is a logo that slowly stops
 * being the logo, and nothing typechecks a `d` attribute. They now come from `@contenthero-ai/brand-ui`,
 * which ships data and pure functions only: this bundle must contain everything it draws, so a package
 * exporting React components could not have solved it.
 */
function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox={LAUREL_VIEW_BOX} width={size} height={size} className="mark" aria-hidden="true">
      {LAUREL_PATHS.map((d) => (
        <path key={d} d={d} fill={LAUREL_GOLD} />
      ))}
    </svg>
  )
}

/**
 * The action glyphs.
 *
 * ⛔ Drawn here rather than pulled from an icon set: four 16px shapes do not justify another dependency in
 * a bundle that ships as one string and is already paid for by everyone who installs the server. They use
 * currentColor so they follow the pill they sit in, in either theme.
 */
const ICON = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/**
 * A placeholder card: the laurel assembling itself, at the shape the finished output will be.
 *
 * ⭐⭐ THE ANIMATION IS NOT DRAWN HERE. `laurelKeyframes` comes from `@contenthero-ai/brand-ui`, so the
 * laurel assembles in a chat exactly the way it does in the studio. Re-deriving the timing would have
 * produced a laurel that moves differently in the two places, which nobody reading either file would catch.
 *
 * ⚠️ The keyframes are injected ONCE for the whole widget rather than per card. Nine `@keyframes` blocks
 * repeated across four placeholders is the same CSS four times, and every copy after the first is ignored.
 */
const LAUREL_CSS = laurelKeyframes({ prefix: 'ch', durationSecs: 2 })

function Skeleton() {
  return (
    <svg viewBox={LAUREL_VIEW_BOX} className="laurel" aria-hidden="true">
      {LAUREL_PATHS.map((d, i) => (
        <path key={d} d={d} fill={LAUREL_GOLD} className={laurelLeafClass(i, 'ch')} />
      ))}
    </svg>
  )
}

function IconAnimate() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="2" y="5" width="14" height="14" rx="2" />
      <path d="m22 8-6 4 6 4V8Z" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  )
}

function IconEdit() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function IconRecreate() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

/** ⚠️ `preload="metadata"`: fetching whole videos for a result nobody played is a cost on someone else's bill. */
function Media({
  output,
  kind,
  onReady,
}: {
  output: Output
  kind: WidgetData['contentType']
  onReady?: () => void
}) {
  if (kind === 'video') {
    return (
      <video
        className="media"
        src={output.url}
        poster={output.posterUrl ?? undefined}
        controls
        preload="metadata"
        playsInline
        // ⚠️ `loadeddata`, not `canplay`: the first frame is painted by then, which is what the laurel is
        // waiting for. `canplay` waits on enough buffer to play through, which is a different question.
        onLoadedData={onReady}
        onError={onReady}
      />
    )
  }
  if (kind === 'audio') return <audio className="media" src={output.url} controls preload="metadata" />
  return <img className="media" src={output.url} alt={output.name} onLoad={onReady} onError={onReady} />
}

/** Reduce measured pixels to the ratio a person recognizes, so 2736x1536 reads as `16:9`. */
function ratioLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(w, h) || 1
  let rw = Math.round(w / g)
  let rh = Math.round(h / g)
  // An awkward pair like 683:384 means the source is not a tidy ratio. Approximate to the nearest familiar
  // one rather than printing noise nobody can read.
  if (rw > 32 || rh > 32) {
    const r = w / h
    const known: Array<[number, number]> = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9]]
    const best = known.reduce((a, b) => (Math.abs(a[0] / a[1] - r) < Math.abs(b[0] / b[1] - r) ? a : b))
    rw = best[0]
    rh = best[1]
  }
  return `${rw}:${rh}`
}

/**
 * The extension and media type a host needs to name a saved file.
 *
 * ⚠️ Both were missing from the download request, so the dialog offered a bare uuid with no extension. The
 * url's own extension is the truth here: it is the stored object's name, not a guess from the content type,
 * which cannot tell a png from a webp.
 */
function extensionOf(url: string): string | null {
  const path = url.split('?')[0] ?? ''
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m?.[1]?.toLowerCase() ?? null
}

const FALLBACK_EXT: Record<WidgetData['contentType'], string> = { image: 'png', video: 'mp4', audio: 'mp3' }
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
}

function fileNameFor(o: Output, data: WidgetData): string {
  const ext = extensionOf(o.url) ?? FALLBACK_EXT[data.contentType]
  return o.name.includes('.') ? o.name : `${o.name}.${ext}`
}

function mimeFor(o: Output, data: WidgetData): string | undefined {
  const ext = extensionOf(o.url) ?? FALLBACK_EXT[data.contentType]
  return MIME_BY_EXT[ext]
}

/**
 * The messages the action buttons put in the conversation.
 *
 * ⭐ Kept together and out of the render tree because they are the actual PRODUCT of a button: what the
 * agent is asked to do. Reading them side by side is the only way to see that each one is complete, which
 * is the property the whole design rests on (see `say`).
 */
const ASK = {
  animate: (url: string) =>
    `Animate this image into a short video. Use it as the reference image: ${url}\n\n` +
    `Pick a suitable video model and tell me which one before you spend credits.`,
  edit: (url: string) =>
    `I want to edit this image: ${url}\n\n` +
    `Ask me what change I want, then make it with an image-editing model. Do not generate anything yet.`,
  /**
   * ⚠️ `model: ${d.modelId}` IS THE RAW ID ON PURPOSE. This message's reader is the agent, which needs the
   * token it can pass to a tool, not the display name a person reads. The chip is the opposite case and
   * renders nothing rather than an id; both are deliberate and stated in `format.ts` for the same reason.
   */
  recreate: (d: WidgetData) => {
    const lines = [
      'Generate this again with the same settings.',
      '',
      `type: ${d.contentType}`,
      `model: ${d.modelId}`,
    ]
    if (d.displayAspect) lines.push(`aspect_ratio: ${d.displayAspect}`)
    lines.push(`count: ${d.outputs.length}`)
    if (d.prompt) lines.push('', 'prompt:', d.prompt)
    return lines.join('\n')
  },
}

/**
 * The CSS custom properties that give a tile its shape.
 *
 * ⚠️ ONE HELPER FOR BOTH THE PLACEHOLDER AND THE FINISHED TILE. Written out twice, the two would drift and
 * the grid would resize at the exact moment the media arrives, which is the jump the placeholders exist to
 * prevent.
 */
function shapeOf(aspect: string): CSSProperties {
  return {
    ['--ar']: aspectToCss(aspect),
    ['--ar-num']: String(parseAspectRatio(aspect) ?? 1),
  } as CSSProperties
}

function Widget() {
  const [data, setData] = useState<WidgetData | null>(null)
  const [index, setIndex] = useState(0)
  const [full, setFull] = useState(false)
  const [openPrompt, setOpenPrompt] = useState(false)
  const [ratio, setRatio] = useState<string | null>(null)
  /** The url currently downloading, and the url whose download was refused. Both are transient UI only. */
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  /** True once polling has given up. A spinner that never resolves is worse than saying so. */
  const [stalled, setStalled] = useState(false)
  /** Urls whose media has pixels on screen. Drives the laurel-to-media cross-fade, per tile. */
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())

  /**
   * ⚠️⚠️ REGISTERED IN `onAppCreated`, WHICH IS BEFORE THE HANDSHAKE COMPLETES.
   *
   * There is no `app.toolResult` to read after the fact: the host DELIVERS the result that opened this
   * widget as a `ui/notifications/tool-result`. A handler attached in an effect races that delivery, and
   * losing it means an empty frame with nothing to retry.
   */
  const readResult = useCallback((params: unknown) => {
    const sc =
      (params as { structuredContent?: WidgetData } | null)?.structuredContent ??
      (params as { result?: { structuredContent?: WidgetData } } | null)?.result?.structuredContent
    // ⚠️ A PENDING RESULT HAS NO OUTPUTS, so the old `outputs.length` guard dropped it and the frame sat
    // on "Waiting for the generation result." forever. Accept anything that identifies a generation.
    if (sc?.outputId) {
      setData(sc)
      setIndex(0)
      setRatio(null)
      setStalled(false)
    }
  }, [])

  const { app, isConnected } = useApp({
    appInfo: { name: 'contenthero-generation', version: '1' },
    capabilities: {},
    autoResize: true,
    onAppCreated: (a) => {
      a.ontoolresult = readResult
    },
  })

  const current = useMemo(() => data?.outputs[index] ?? null, [data, index])

  /**
   * ⭐ ASKS THE HOST FOR ROOM rather than faking a lightbox inside a frame only as big as the host allows,
   * and renders against the mode the host GRANTED rather than the one we requested.
   */
  const canExpand = Boolean(app?.getHostContext?.()?.availableDisplayModes?.includes('fullscreen'))
  const setMode = useCallback(
    async (want: boolean) => {
      if (!app || !canExpand) return
      try {
        const res = await app.requestDisplayMode({ mode: want ? 'fullscreen' : 'inline' })
        setFull(res.mode === 'fullscreen')
      } catch {
        /* A refusal is an answer. Leave the layout alone. */
      }
    },
    [app, canExpand],
  )

  /**
   * ⭐⭐ THE HOST'S THEME, FOLLOWED RATHER THAN GUESSED.
   *
   * `prefers-color-scheme` inside a sandboxed frame reports the OPERATING SYSTEM, not the theme the person
   * chose in the chat client, and those disagree the moment anyone sets the client to dark on a light
   * machine. The host tells us directly on its context and notifies on change, so that is what is read.
   *
   * ⚠️ Stamped on the DOCUMENT ELEMENT rather than held in React state and threaded through className, so
   * the CSS custom properties cascade to every subtree including the fullscreen tree, which is a sibling of
   * the inline one rather than a child.
   *
   * ⚠️ `?? 'dark'` is the stated fallback, matching the token defaults. A host that reports no theme gets
   * the dark treatment, which stays legible on a light background where the inverse would not.
   */
  useEffect(() => {
    if (!app) return
    const apply = (theme?: string) => {
      document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
    }
    apply(app.getHostContext?.()?.theme)
    const onChange = (ctx: { theme?: string } | undefined) => apply(ctx?.theme)
    app.addEventListener?.('hostcontextchanged', onChange)
    return () => app.removeEventListener?.('hostcontextchanged', onChange)
  }, [app])

  /**
   * ⛔⛔ **A DENIAL WAS BEING THROWN AWAY.** This was `void app?.downloadFile(...)`, so the `isError` the
   * host returns when it refuses or the person cancels went nowhere: a download that did nothing looked
   * exactly like a download that worked, and "the button is broken" could not be told apart from "the host
   * asked and I said no". The result is now read and a failure says so on the button itself.
   *
   * ⚠️ The `name` carries a FILE EXTENSION and a `mimeType`, both of which were missing. The host names the
   * saved file from these, and it is the only thing in the download dialog a person can recognize.
   */
  /**
   * ⭐ ARROW KEYS IN FULLSCREEN. The thumbnail strip already says these are siblings of one set, and a set a
   * person is comparing is one they will want to step through without aiming at a 56px target.
   *
   * ⚠️ Bound to the WINDOW rather than a focused element: nothing in the fullscreen tree holds focus after
   * the host opens it, so a keydown on a container would never fire. Only active while fullscreen, so the
   * inline widget never swallows a key the host wants.
   */
  useEffect(() => {
    if (!full || !data || data.outputs.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const len = data.outputs.length
      setIndex((i) => (e.key === 'ArrowRight' ? (i + 1) % len : (i - 1 + len) % len))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full, data])

  /**
   * ⭐⭐⭐ **THE WIDGET POLLS ITSELF WHILE A GENERATION IS STILL RUNNING.**
   *
   * The server answers a slow job with `status: 'processing'` and no urls, and calls
   * `get_generation_status` from in here until the outputs arrive. Without this the placeholders would sit
   * there forever waiting for a human to ask the agent to check.
   *
   * ⚠️ **THE AGENT IS STILL TOLD TO POLL, IN THE TEXT BLOCK.** These two are not redundant: the text is
   * what a host without app support renders and what the model reads, and an agent that stopped polling
   * because prose was swapped for a payload it cannot see would leave the generation unclaimed. Both
   * converge on the same completed row, and `get_generation_status` is a read, so the duplicate costs a
   * request and nothing else.
   *
   * ⚠️ **BOUNDED.** A job that never finishes must not poll forever in someone's chat window. Twenty
   * minutes of attempts at the server's suggested cadence, then it stops and says so, because a spinner
   * that never resolves is a worse answer than "this is taking too long".
   *
   * ⚠️ `cancelled` is checked after every await. An unmount or a completed swap while a request is in
   * flight would otherwise schedule one more round against a widget that is gone.
   */
  useEffect(() => {
    if (!app || !data || data.status !== 'processing' || data.outputs.length > 0) return
    const everySeconds = Math.max(3, data.pollAfterSeconds ?? 10)
    const deadline = 20 * 60
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let elapsed = 0

    const tick = async () => {
      if (cancelled) return
      try {
        const res = await app.callServerTool({
          name: 'get_generation_status',
          // ⚠️ `outputIds`, PLURAL, and an array even for one. The singular spelling is a validation error.
          arguments: { outputIds: [data.outputId] },
        })
        if (cancelled) return
        const sc = (res as { structuredContent?: WidgetData }).structuredContent
        if (sc?.outputs?.length) {
          setData(sc)
          setRatio(null)
          return
        }
      } catch {
        /* A transient failure is not a finished job. Fall through and try again on the next tick. */
      }
      if (cancelled) return
      elapsed += everySeconds
      if (elapsed >= deadline) {
        setStalled(true)
        return
      }
      timer = setTimeout(() => void tick(), everySeconds * 1000)
    }

    timer = setTimeout(() => void tick(), everySeconds * 1000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [app, data])

  const download = async (o: Output) => {
    // ⚠️ `data` is narrowed below, but this closure is defined above that point, so the guard is restated.
    if (!app || !data) return
    setBusy(o.url)
    try {
      const res = await app.downloadFile({
        contents: [{ type: 'resource_link', uri: o.url, name: fileNameFor(o, data), mimeType: mimeFor(o, data) }],
      })
      setFailed(res?.isError ? o.url : null)
    } catch {
      setFailed(o.url)
    } finally {
      setBusy(null)
    }
  }

  /**
   * ⭐⭐⭐ **EVERY MESSAGE IS COMPLETE ON ITS OWN, BECAUSE WE DO NOT CONTROL WHETHER IT IS SENT.**
   *
   * `ui/message` is the only channel the spec gives an app for putting text in the conversation, and it has
   * no "prefill but do not send" flag: the SDK documents it as adding a message to the thread, in contrast
   * to `updateModelContext`, which never reaches the composer at all. The reference implementation's
   * buttons visibly leave their text sitting in the composer with a trailing `Prompt:` for the person to
   * finish, which means a host may also just SEND it.
   *
   * ⛔ So a message ending in an empty `Prompt:` is a bug waiting on host behavior: if the host sends it,
   * a turn is spent on an instruction with a hole in it. Writing each message so that sending it
   * immediately is the CORRECT outcome makes both host behaviors right, and removes a dependency on
   * something we cannot observe from in here.
   *
   * ⚠️ The url is the same capability url the result's text block already prints, so this exposes nothing
   * new. Its token names one object.
   */
  const say = async (text: string) => {
    if (!app) return
    try {
      await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] })
    } catch {
      /* A host that refuses leaves the conversation untouched, which is the honest outcome. */
    }
  }

  if (!data) {
    return <div className="fallback muted">{isConnected ? 'Waiting for the generation result.' : 'Connecting.'}</div>
  }

  /** True while the server has told us a job is running and no outputs have landed yet. */
  const pending = data.status === 'processing' && data.outputs.length === 0

  const n = pending ? Math.max(1, data.expected ?? 1) : data.outputs.length
  const noun = data.contentType
  const label = pending
    ? stalled
      ? 'Still running. Ask me to check on it.'
      : `Making ${n} ${n === 1 ? noun : `${noun}s`}`
    : n === 1
      ? noun
      : `${n} ${noun}s`

  /**
   * ⭐⭐ **MEASURED PIXELS BEAT THE REQUESTED RATIO, AND `displayAspect` SEEDS THE FIRST PAINT.**
   *
   * A model does not always return the shape it was asked for, and the studio's row view already settles
   * this the same way for the same reason: lay out by what the media ACTUALLY is. But measuring requires a
   * loaded image, so seeding from the server's `displayAspect` means the grid is right on the first frame
   * instead of reflowing once a decode finishes.
   *
   * ⚠️ Null is a real third state. Audio has no shape, and an older server sends nothing, so the tiles fall
   * back to a bounded `contain` box rather than cropping against a ratio nobody established.
   */
  const aspect = ratio ?? data.displayAspect ?? null

  /**
   * ⚠️ `Math.min` WITH THE COUNT. Three outputs under a four-column rule would otherwise lay out as three
   * tiles and a hole, which reads as a missing item rather than an arrangement.
   */
  const cols = Math.min(n, columnsForAspect(aspect))

  /**
   * ⭐ ONE ACTION SET, RENDERED TWICE. The hover overlay and the fullscreen foot offer the same verbs, so
   * they are built from one function: two lists would drift the first time a verb is added to one of them.
   *
   * ⚠️ WHICH VERBS APPLY IS A PROPERTY OF THE MEDIUM. Animate and Edit are image-only: there is nothing to
   * animate about a video and no image-editing model takes audio. Recreate and Download apply to all three.
   */
  const actions = (o: Output, opts: { labels: boolean }) => {
    const isImage = data.contentType === 'image'
    const t = (s: string) => (opts.labels ? s : null)
    const refused = failed === o.url
    return (
      <>
        {isImage && (
          <button className="pill gold" onClick={() => void say(ASK.animate(o.url))} title="Animate">
            <IconAnimate />
            {t('Animate')}
          </button>
        )}
        <button
          className={`pill${refused ? ' warn' : ''}`}
          onClick={() => void download(o)}
          disabled={busy === o.url}
          title={refused ? 'The host refused that download' : 'Download'}
        >
          <IconDownload />
          {t(refused ? 'Not downloaded' : busy === o.url ? 'Saving' : 'Download')}
        </button>
        {isImage && (
          <button className="pill" onClick={() => void say(ASK.edit(o.url))} title="Edit">
            <IconEdit />
            {t('Edit')}
          </button>
        )}
      </>
    )
  }

  const badges = (
    <>
      {/* ⛔ No `?? data.modelId`. A null name means the server could not resolve one, and the id reads
          enough like a label that printing it turns that into a cosmetic bug nobody can diagnose. */}
      {data.modelName && (
        <span className={`badge model${data.modelIconKey ? '' : ' no-glyph'}`}>
          {/* The glyph IS the brand mark, so the dot only appears when there is no glyph to stand in for. */}
          <ModelGlyph iconKey={data.modelIconKey} />
          <span className="dot" style={{ background: data.modelBrandColor || GOLD }} />
          {data.modelName}
        </span>
      )}
      {aspect && <span className="badge">{aspect}</span>}
    </>
  )

  if (full && current) {
    return (
      <div className="full">
        {/* ⛔ NO HEADER HERE. The host already frames a fullscreen app with its own title and close control,
            so drawing ours produced two of each stacked on top of one another. */}
        <div className="stage">
          <Media output={current} kind={data.contentType} />
        </div>
        {n > 1 && (
          <div className="strip" role="tablist" aria-label="Variations">
            {data.outputs.map((o, i) => (
              <button
                key={o.url}
                className="t"
                role="tab"
                aria-current={i === index}
                aria-label={`Variation ${i + 1} of ${n}`}
                onClick={() => setIndex(i)}
              >
                <img src={o.posterUrl ?? o.url} alt="" />
              </button>
            ))}
          </div>
        )}
        <div className="foot">
          {actions(current, { labels: true })}
          <button className="pill" onClick={() => void say(ASK.recreate(data))} title="Recreate">
            <IconRecreate />
            Recreate
          </button>
          <span className="spacer" />
          {badges}
          {n > 1 && <span className="muted">Variation {index + 1} of {n}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="wrap">
      {/* ⭐ METADATA LEFT, MARK RIGHT. The wordmark and the count both went: the host already shows which
          connector answered, and the count is said once at the bottom instead of twice. */}
      <div className="head">
        <div className="badges">{badges}</div>
        <span className="spacer" />
        <Mark size={20} />
      </div>

      {data.prompt && (
        <div className="meta">
          <p
            className={openPrompt ? 'prompt' : 'prompt clamped'}
            onClick={() => setOpenPrompt((v) => !v)}
            title={openPrompt ? 'Show less' : 'Show more'}
          >
            {data.prompt}
          </p>
        </div>
      )}

      <div className="grid" style={{ ['--cols' as string]: String(cols) }}>
        {pending &&
          Array.from({ length: n }, (_, i) => (
            // ⚠️ A placeholder is ALWAYS shaped: `shapeOf` bottoms out at 1:1, matching the studio's own
            // aspect resolver. There is no media to crop yet, so a square beats an arbitrary fixed height
            // that the real tile would then jump away from.
            <div key={`pending-${i}`} className="tile shaped" style={shapeOf(aspect ?? '1:1')}>
              <div className="laurel-wrap">
                <Skeleton />
              </div>
            </div>
          ))}
        {data.outputs.map((o, i) => (
          <div
            key={o.url}
            className={
              `tile${data.contentType === 'image' ? ' img' : ''}` +
              `${data.contentType === 'audio' ? ' audio' : ''}` +
              ` ${aspect ? 'shaped' : 'unshaped'}${loaded.has(o.url) ? ' ready' : ''}`
            }
            // ⭐ The tile takes the MEDIA's shape, so there is nothing left over to letterbox. See `.tile` above.
            style={aspect ? shapeOf(aspect) : undefined}
            onClick={() => {
              setIndex(i)
              if (data.contentType === 'image') void setMode(true)
            }}
          >
            {data.contentType === 'image' ? (
              <img
                className="media"
                src={o.url}
                alt={o.name}
                /**
                 * ⛔ NOT `loading="lazy"`. These tiles are the point of the message and they are all above
                 * the fold, and a lazy image that never enters the viewport never fires `onLoad`, which is
                 * now the signal that retires the laurel. A placeholder that never resolves would be worse
                 * than an eager fetch of four images somebody just paid to generate.
                 */
                onLoad={(e) => {
                  // The handoff signal: this tile has pixels, so its laurel can go.
                  setLoaded((prev) => (prev.has(o.url) ? prev : new Set(prev).add(o.url)))
                  /**
                   * ⭐⭐ MEASURED FROM THE REAL PIXELS, WHICH DRIVES THE LAYOUT AND NOT JUST THE BADGE.
                   *
                   * A model does not always return the shape it was asked for, and object-fit: cover crops
                   * against whatever ratio the tile was given, so laying out by the REQUESTED ratio would
                   * silently trim any output that came back different. The server's displayAspect seeds
                   * the first paint; this corrects it the moment a real decode can answer.
                   */
                  if (i !== 0) return
                  const el = e.currentTarget
                  if (el.naturalWidth && el.naturalHeight) setRatio(ratioLabel(el.naturalWidth, el.naturalHeight))
                }}
                // A broken image must not leave a laurel spinning over it forever.
                onError={() => setLoaded((prev) => new Set(prev).add(o.url))}
              />
            ) : (
              <Media
                output={o}
                kind={data.contentType}
                onReady={() => setLoaded((prev) => (prev.has(o.url) ? prev : new Set(prev).add(o.url)))}
              />
            )}
            {/* The laurel sits ON the media until it has pixels, then the two cross-fade. See .tile .media. */}
            {!loaded.has(o.url) && data.contentType !== 'audio' && (
              <div className="laurel-wrap">
                <Skeleton />
              </div>
            )}
            {/* ⚠️ stopPropagation, or every action also opens the lightbox underneath it. */}
            <div className="acts" onClick={(e) => e.stopPropagation()}>
              {actions(o, { labels: false })}
            </div>
          </div>
        ))}
      </div>

      <div className="bar">
        <span className="muted">{label}</span>
        <span className="spacer" />
        {/* Recreate acts on the GENERATION, not one output, which is why it sits under the set rather than
            on a tile. It carries the prompt and settings, so it needs no follow-up to be actionable. */}
        {!pending && (
          <button className="pill ghost" onClick={() => void say(ASK.recreate(data))}>
            <IconRecreate />
            Recreate
          </button>
        )}
        {!pending && canExpand && data.contentType === 'image' && (
          <button className="pill ghost" onClick={() => void setMode(true)}>Expand</button>
        )}
      </div>
    </div>
  )
}

const style = document.createElement('style')
// The laurel's keyframes ship alongside the stylesheet: one injection for every placeholder on the page.
style.textContent = styles + LAUREL_CSS
document.head.appendChild(style)

const root = document.createElement('div')
document.body.appendChild(root)
createRoot(root).render(<Widget />)
