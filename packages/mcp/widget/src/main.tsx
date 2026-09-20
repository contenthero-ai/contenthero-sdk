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
  masonryColumns,
  aspectToCss,
  parseAspectRatio,
  laurelKeyframes,
  laurelLeafClass,
  LAUREL_PATHS,
  LAUREL_VIEW_BOX,
  LAUREL_GOLD,
  packIntoColumns,
} from '@contenthero-ai/brand-ui'

/** One tile. Everything past the url is optional, because a producer may genuinely not know it. */
interface Item {
  readonly url: string
  readonly posterUrl?: string | null
  readonly name: string
  readonly contentType: 'image' | 'video' | 'audio'
  readonly displayAspect?: string | null
  /**
   * Where this thing lives IN THE PRODUCT, supplied by whoever built the payload.
   *
   * ⛔ NOT a studio link by assumption. A generation lives in the studio, a project export lives in the
   * editor, an upload lives in the library. Naming the field after one destination is what made an earlier
   * version ask whether an export belonged in the studio detail view, which is not a question about this
   * field at all. Absent means there is nowhere to go and the Open button does not render.
   */
  readonly openUrl?: string | null
  /**
   * The token the API accepts for this item.
   *
   * ⛔ ITS ABSENCE HIDES ANIMATE AND EDIT. Both end in a tool call that must NAME this thing, and a project
   * export has an exportId no generate tool resolves. Offering a verb that cannot work is worse than not
   * offering it, because the failure lands on the agent and reads as the agent's fault.
   */
  readonly reference?: string | null
  readonly modelName?: string | null
  readonly modelBrandColor?: string | null
  readonly modelIconKey?: string | null
  /**
   * ⭐⭐⭐ **THE SMALL PICTURE. TILES PAINT THIS; NOTHING SAVES IT.**
   *
   * A tile used to load `url`, the master, at 1.7 to 2.9 MB apiece. Ten of those is about 25 MB over a
   * browser's ~6 connections per origin, which is the five to ten minutes of Laurel skeletons and the tiles
   * that never arrived.
   *
   * ⛔ A PREVIEW IS 1600px AT QUALITY 80, so handing it to someone who asked to DOWNLOAD their asset is a
   * silent quality downgrade. Download stays on `url`; the detail view paints this first and swaps to the
   * master when it lands.
   */
  readonly previewUrl?: string | null
  /** Which library this came from. Only a CREATION can be generated again, so this gates Recreate. */
  readonly source?: 'creations' | 'uploads' | 'stock' | null
  /** PER ITEM, so Recreate works for a mixed set where no shared model exists. */
  readonly modelId?: string | null
}

interface WidgetData {
  readonly outputId?: string | null
  /** Shared medium, when every item shares one. Null for a mixed set. */
  readonly contentType?: 'image' | 'video' | 'audio' | null
  readonly modelId?: string
  /**
   * ⛔ **NULL MEANS RENDER NO CHIP. NEVER FALL BACK TO `modelId`.** This carried `modelName ?? modelId`
   * until the server resolved it properly, and `gpt-image-2` reads enough like a label that a failed
   * lookup showed up as a chip flickering between kebab case and title case instead of as a failure.
   */
  readonly modelName?: string | null
  readonly modelBrandColor?: string | null
  readonly modelIconKey?: string | null
  /** Shared shape, when every item shares one. Its presence is what makes the layout a ROW. */
  readonly displayAspect?: string | null
  readonly prompt?: string | null
  readonly items?: readonly Item[]
  /**
   * ⚠️ **THE OLD SHAPE, READ FOR AS LONG AS OLD RESULTS EXIST.**
   *
   * The payload used to be a generation with `outputs`, each carrying only a url and a name, with the
   * medium and the shape shared at the top. Those results are still sitting in people's conversations and
   * the host re-renders them with whatever bundle is current, so dropping this would blank every card
   * anybody generated before today.
   */
  readonly outputs?: readonly { url: string; posterUrl?: string | null; name: string; studioUrl?: string }[]
  readonly status?: 'processing' | 'completed'
  readonly expected?: number
  readonly pollAfterSeconds?: number
}

/**
 * One list of tiles, whichever shape the payload arrived in.
 *
 * ⭐ Normalizing ONCE here means the rest of the widget never asks which era a result came from. The old
 * shape's shared `contentType` and `displayAspect` become per-item values, which is exactly what they
 * always meant.
 */
function itemsOf(data: WidgetData): Item[] {
  if (data.items?.length) return [...data.items]
  return (data.outputs ?? []).map((o) => ({
    url: o.url,
    posterUrl: o.posterUrl ?? null,
    name: o.name,
    contentType: data.contentType ?? 'image',
    displayAspect: data.displayAspect ?? null,
    openUrl: o.studioUrl ?? null,
  }))
}

/**
 * ⭐⭐⭐ THE LAYOUT IS DERIVED FROM THE DATA, NOT SELECTED BY A FLAG.
 *
 * Variations of one generation share a medium and a shape, and they exist to be compared, so they go on a
 * ROW sized by that shape. A mixed set shares nothing and is being scanned rather than chosen from, so it
 * goes in a masonry grid that keeps each item's own shape.
 *
 * ⚠️ "A generation" is therefore not a mode anyone sets. It is the case where every item agrees, which is
 * a property the payload already carries.
 */
function isUniform(items: readonly Item[]): boolean {
  if (items.length === 0) return true
  const first = items[0]!
  return items.every(
    (it) => it.contentType === first.contentType && (it.displayAspect ?? null) === (first.displayAspect ?? null),
  )
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
    --chip-bg-hover: #242424;
    --chip-fg: #ffffff;
  }
  :root[data-theme='light'] {
    --chip-bg: #f2f2f2;
    --chip-bg-hover: #e6e6e6;
    --chip-fg: ${OBSIDIAN};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 var(--font-sans, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
    color: var(--color-text-primary, CanvasText);
    background: transparent;
  }
  /*
   * ⭐ ROUNDER, AND LIT FROM THE TOP LEFT.
   *
   * A 14px radius on a panel this size reads as a utility box. The reference's widgets are noticeably
   * rounder and carry a soft diagonal gradient, which is most of what makes them feel finished rather than
   * functional. Both are cheap: one radius and one overlay gradient in the brand's own gold, at an opacity
   * low enough to read as light rather than as color.
   *
   * ⚠️ The gradient goes on the CONTAINER and stays under the content, so it tints the panel without
   * touching the media. Painting it over the grid would cast gold on every picture.
   */
  .wrap {
    position: relative;
    border: 1px solid var(--color-border-primary, color-mix(in srgb, CanvasText 14%, transparent));
    border-radius: var(--border-radius-lg, 22px);
    overflow: hidden;
    background: var(--color-background-secondary, Canvas);
  }
  .wrap::before {
    content: '';
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background: linear-gradient(135deg, color-mix(in srgb, ${GOLD} 7%, transparent), transparent 55%);
  }
  .wrap > * { position: relative; z-index: 1; }

  /*
   * ⚠️ THE HEAD AND THE GRID SHARE THEIR HORIZONTAL PADDING, WHICH IS WHAT ALIGNS THE MARK.
   *
   * Measured: the mark's right edge and the rightmost tile's right edge are the same pixel, and the mark's
   * vertical center matches the chips' to the pixel. Both fall out of the shared 12px and align-items
   * center; neither is a coincidence to preserve by hand, but both break the moment these two rules
   * disagree about padding.
   */
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
  /*
   * ⛔ CSS OWNS THE SIZE. The component passed size={20} and this rule said 18px, so the attribute lost
   * silently and the real size was in neither place a reader would look first.
   *
   * ⚠️ 26px MATCHES THE CHIP HEIGHT EXACTLY, so the mark reads as a peer of the metadata rather than as a
   * decoration tucked into a corner. At 18px it was two thirds of the chips beside it.
   *
   * ⚠️ The artwork fills 93.84 of its 100-unit viewBox horizontally and 88.17 vertically, anchored top
   * left, so the painted leaves stop about 1.6px short of the element's right edge at this size. That is
   * the shape's own whitespace, not a layout error, and correcting for it with a negative margin would
   * make the mark disagree with every other surface that draws it.
   */
  .head .mark { width: 26px; height: 26px; flex: 0 0 auto; }
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

  /*
   * MASONRY, for a set whose items do not share a shape.
   *
   * ⭐ A uniform set is a ROW, because variations of one generation exist to be compared and comparison has
   * to be parallel. A mixed set is being SCANNED, not chosen from, so every item stays its own shape and
   * the column count comes from the width instead. Both rules live in the shared package, so the same
   * media lands the same way in the studio and in a chat.
   *
   * ⛔⛔⛔ **NOT column-count. IT READS DOWN, AND A SET OF MEDIA READS ACROSS.**
   *
   * CSS multi-column fills each column top to bottom before starting the next, so item 2 lands BELOW item 1
   * rather than beside it, and a set arrives in one order and reads in another. That is what multi-column
   * MEANS; no styling fixes it. The note that used to sit here called the reading order an acceptable cost
   * "for a set nobody is reading in order", which was a guess about the reader. The reader said otherwise.
   *
   * ⭐ So columns are assigned in JS by packIntoColumns (shortest column first, by relative height) and each
   * is rendered as its own flex stack. That is the rule the studio masonry already uses, shared from the
   * brand-ui package so the product and a chat arrange the same media the same way.
   *
   * ⚠️ Keeping each tile's NATURAL height is still the point: no measurement pass, no layout thrash as
   * images decode at different times. Assigning columns up front is what buys that without the reading order.
   */
  .grid.mixed {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .grid.mixed > .col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    /* Equal share of the row, and min-width 0 so a wide tile cannot push its column past its share. */
    flex: 1 1 0;
    min-width: 0;
  }
  .grid.mixed .tile {
    /* A mixed tile is sized by its own ratio, so it must not also be bounded by the row cap. */
    max-width: none;
  }
  .t-glyph {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    font-size: 18px;
    color: rgba(255, 255, 255, 0.45);
  }

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
  /**
   * ⛔⛔ AN overflow-hidden TILE CLIPPED ITS OWN TOOLTIP, and a tile at the grid edge is exactly where a
   * tooltip is most needed. The rounded corner is what the clip was FOR, so it moved onto the media, which
   * is the only child that needs clipping. The tile itself now lets an overlay escape its bounds.
   */
  .tile {
    position: relative; overflow: visible; border-radius: var(--border-radius-md, 14px);
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
  /*
   * ⚠️ INHERIT THE RADIUS, OR THE CORNERS SHOW THEIR POINTS.
   *
   * The tile rounds its corners and this fills the tile edge to edge with its own background, so a square
   * overlay inside a rounded box leaves four visible triangles of skeleton colour poking past the curve.
   * Only noticeable against the tile's own background, which is exactly when a skeleton is on screen.
   *
   * The tile's overflow is visible now (so a tooltip can escape it), which means the tile is no longer
   * clipping this for us. Every child that paints to the edge has to round itself.
   */
  /*
   * ⚠️ NO RESERVED BOX HERE, DELIBERATELY. A shaped frame was tried and is worse: it promises a size that
   * the real card will not have, so the first thing you see is a rectangle nothing ever occupies. Text
   * claims no layout, so the card that replaces it does not have to snap out of one.
   */
  .fallback { padding: 18px; }
  .laurel-wrap {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: var(--color-background-tertiary, color-mix(in srgb, CanvasText 6%, transparent));
    border-radius: inherit;
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
  /* The clip that used to live on the tile. The media fills the tile, so the rounded look is identical. */
  .tile .media { border-radius: inherit; }
  .tile .media { visibility: hidden; }
  .tile.ready .media { visibility: visible; }
  /* Audio has no decode event worth waiting on and no picture to hide, so it is ready on arrival. */
  .tile.audio .media { visibility: visible; }

  /**
   * Actions live ON the thing they act on. Hidden until hover, never unreachable by keyboard.
   *
   * ## ⭐⭐ THREE ZONES, BECAUSE FIVE IN A ROW READ AS ONE UNDIFFERENTIATED CLUMP
   *
   * The creative verbs (Animate, Edit, Recreate) are the choice someone is making, so they stay centered
   * where the eye already is. Download and Open are EXITS: they leave the picture or leave the
   * conversation, and pinning them to opposite corners separates them from the choice rather than hiding
   * them in the middle of it.
   */
  .acts {
    position: absolute; left: 0; right: 0; bottom: 10px; z-index: 1;
    display: flex; gap: 6px; justify-content: center;
    opacity: 0; transition: opacity .12s ease;
  }
  .corner { position: absolute; top: 8px; z-index: 2; opacity: 0; transition: opacity .12s ease; }
  /**
   * ⛔⛔ **AN AUDIO TILE IS A CONTROL SURFACE, SO THE ACTIONS MUST NOT COVER IT.**
   *
   * Every other medium is a picture with an overlay on top, which is fine because the picture does nothing
   * when you click it. An audio tile is a transport: play, scrub, volume. The acts row sat 10px from the
   * bottom, directly over those controls, so hovering to press play summoned buttons that took the click
   * instead. Reported as audio that "just doesn't really do anything".
   *
   * ⭐ Moving them to the TOP of the tile leaves the transport clear. The corners already sit there, so an
   * audio tile reserves a little more height for the row to live in rather than overlapping either one.
   */
  .tile.audio {
    /* Tall enough for a transport and a row of verbs to sit apart rather than on top of each other. */
    min-height: 116px;
    display: flex;
    align-items: flex-start;
    padding: 10px 8px;
  }
  /* The transport gets the top, where nothing is ever drawn over it. */
  .tile.audio .media { width: 100%; }
  .tile.audio .acts {
    top: auto;
    bottom: 10px;
    /* Always visible: there is no picture here that an overlay would obscure. */
    opacity: 1;
  }
  .corner.tl { left: 8px; }
  .corner.tr { right: 8px; }
  .tile:hover .acts, .tile:focus-within .acts,
  .tile:hover .corner, .tile:focus-within .corner { opacity: 1; }
  @media (hover: none) { .acts, .corner { opacity: 1; } }

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
  /*
   * ⚠️ EVERY ACTION NEEDS A SURFACE, NOT JUST THE PRIMARY ONE. Only Animate carried a background, so
   * Download, Edit and Recreate read as bare text floating next to a button rather than as buttons. The
   * neutral surface is theme-aware for the same reason the chip's is: a single fixed gray is unreadable
   * against one of the two backgrounds, and the frame does not choose which.
   */
  /*
   * ⚠️ A SURFACE **AND** A HAIRLINE. The neutral fill alone still read as bare text against a dark panel,
   * because the fill and the panel are close in value by design. The border is what makes the edge of the
   * control findable, and it is the treatment Expand already had before the other buttons were changed
   * around it, which is why they suddenly looked unlike each other.
   */
  .pill.neutral {
    background: var(--chip-bg);
    color: var(--chip-fg);
    border-color: var(--color-border-secondary, color-mix(in srgb, CanvasText 18%, transparent));
  }
  .pill.neutral:hover {
    background: var(--chip-bg-hover);
    border-color: ${GOLD};
  }
  .pill[disabled] { opacity: .6; cursor: default; }
  /* A refused download must not look like one that worked. Gold is the brand's attention color. */
  .pill.warn { border-color: ${GOLD}; color: ${GOLD}; }
  /*
   * A pill with only a glyph in it is a CIRCLE. The reference draws squircles; fully round reads as an
   * action rather than a small panel, and it is the shape the rest of this widget already uses.
   */
  .acts .pill, .corner .pill { padding: 0; width: 30px; height: 30px; justify-content: center; border-radius: 999px; }
  .acts .pill.warn { width: auto; padding: 0 12px; }
  .bar {
    display: flex; align-items: center; gap: 8px; padding: 10px 12px; flex-wrap: wrap;
    border-top: 1px solid var(--color-border-primary, color-mix(in srgb, CanvasText 14%, transparent));
  }
  /*
   * OUR OWN TOOLTIP, NOT THE BROWSER'S.
   *
   * ⚠️ The title attribute took roughly a second to appear, rendered in the OS's own style, and could not
   * be themed or positioned, so an icon-only button looked unlabeled for the whole time someone was
   * deciding whether to click it. This one appears immediately and matches the chips.
   *
   * ⚠️ Pointer-events off, or the tooltip sits under the cursor and re-triggers the hover it came from,
   * which flickers. It is also the reason the glyphs themselves are pointer-events: none.
   */
  /*
   * ⛔ SCOPED TO .acts, WHICH IS THE ONLY PLACE A BUTTON HAS NO LABEL. A tooltip on a button that already
   * says Recreate tells you what it says, which is noise wearing the costume of help. The selector is the
   * enforcement: there is no way to attach one to a labeled button without moving it into the hover row.
   */
  /**
   * ⛔⛔⛔ THE z-index ON THE TOOLTIP IS NOT WHAT DECIDES THIS, AND THAT IS WHY IT LOOKED IGNORED.
   *
   * A pseudo-element is painted inside its own element's box. Raising its z-index orders it against that
   * element's other children, never against the element's SIBLINGS, so the Animate tooltip was drawn under
   * the Download button simply because Download comes later in the DOM. Measured: the tooltip rendered,
   * in the right place, behind a button.
   *
   * ⭐ THE HOVERED BUTTON IS WHAT HAS TO RISE. Lifting the button lifts everything it paints, tooltip
   * included, above every sibling in the row.
   */
  .acts [data-tip], .corner [data-tip] { position: relative; }
  /**
   * ⛔⛔⛔ **RAISING THE BUTTON WAS STILL NOT ENOUGH, AND THE REASON IS ONE LEVEL UP.**
   *
   * A z-index only orders an element against its siblings INSIDE its nearest stacking context. The acts row
   * and each corner are themselves positioned with their own z-index, so each one IS such a context: a
   * button inside the acts row (z-index 1) can be raised to any number at all and still paint under the
   * corner buttons (z-index 2), because the whole row is below them. The Animate and Recreate tooltips kept
   * rendering behind Download and Open after the button itself was lifted, which is what that looks like.
   *
   * ⭐ THE ZONE IS WHAT HAS TO RISE. Hovering anywhere in a zone lifts the zone above its neighbours, and
   * the tooltip rides with it. This is the same mistake as the tile clipping its own tooltip, one level
   * further out: the fix is never on the thing you can see, it is on the box that contains it.
   */
  .tile .acts:hover, .tile .acts:focus-within,
  .tile .corner:hover, .tile .corner:focus-within { z-index: 8; }
  .acts [data-tip]::after, .corner [data-tip]::after {
    content: attr(data-tip);
    position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
    /* Fully round, like every other control here. A rounded rectangle was the odd one out. */
    padding: 5px 12px; border-radius: 999px; white-space: nowrap;
    font-size: 12px; font-weight: 500; line-height: 1.2;
    background: var(--chip-bg); color: var(--chip-fg);
    box-shadow: 0 2px 10px rgb(0 0 0 / .28);
    opacity: 0; pointer-events: none; transition: opacity .1s ease; z-index: 3;
  }
  /**
   * ⚠️ ONE DIRECTION FOR EVERY TOOLTIP: UPWARD.
   *
   * These opened downward, on the reasoning that a tooltip above a button 8px from the frame's top would
   * be clipped. That reasoning was written before the tile stopped clipping its own overlay, and the grid
   * carries a header above it, so there is room. A tooltip that points the other way from every other one
   * reads as a different control, which costs more than the edge case it was guarding.
   */
  .acts [data-tip]:hover::after, .acts [data-tip]:focus-visible::after,
  .corner [data-tip]:hover::after, .corner [data-tip]:focus-visible::after { opacity: 1; }

  .muted { color: var(--color-text-secondary, color-mix(in srgb, CanvasText 55%, transparent)); font-size: 13px; }
  .spacer { flex: 1 1 auto; }

  /**
   * FULLSCREEN. ⚠️⚠️ "min-height: 0" ON THE MEDIA ROW IS LOAD-BEARING. A flex child defaults to
   * "min-height: auto", so a tall image refuses to shrink below its content size and pushes the thumbnail
   * strip off the bottom of the frame. That is exactly the clipping reported before this comment existed.
   */
  /*
   * ⚠️⚠️ THE RESERVED BAND IS A VARIABLE, AND IT IS NOT A CONSTANT HEIGHT.
   *
   * The host's composer floats over this frame, and it GROWS: attach something or type a few lines and it
   * is several times its resting height. A fixed 96px reserve was sized for the resting case, so a grown
   * composer climbed over the thumbnail strip and made it unclickable. The strip is the only way to change
   * variation, so that is not a cosmetic overlap.
   *
   * ⭐ --composer-band is measured at runtime from the frame's own height against the host's reported
   * container height. Reserving too much costs a strip of empty background; reserving too little costs the
   * controls, which is not a symmetric trade.
   *
   * ⛔⛔ **THE COMPOSER IS NOT THE ONLY THING DOWN THERE.** The host also floats a scroll-to-bottom arrow
   * ABOVE its composer, and that arrow sits over our frame and eats the pointer. The reported symptom was
   * buttons that highlight sometimes and summon the host's arrow other times, which is exactly what a
   * transparent overlay catching hover looks like from the inside.
   *
   * ⚠️ THAT SYMPTOM WAS REPORTED AGAINST THE INLINE FRAME, and this band is only ever applied to the
   * FULLSCREEN one. Measured 2026-09-21: a fullscreen capture shows the composer and no arrow, while an
   * inline capture from the same session shows both. So the arrow's extra reach was being paid here for
   * an obstruction that is not present, and that is the empty space under the action row.
   *
   * ⭐ The floor now covers the composer plus a margin. If an arrow ever does appear over a fullscreen
   * frame the symptom is specific: a button that responds only when the cursor is slightly off it. Raise
   * the floor, do not move the button.
   */
  .full {
    position: fixed; inset: 0; display: flex; flex-direction: column;
    padding-bottom: var(--composer-band, 132px);
    background: var(--color-background-primary, Canvas);
  }
  .full .stage { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 12px 16px; }
  /**
   * ⭐⭐ THE STAGE IS THE POINT OF THIS VIEW, SO THE PICTURE SHOULD USE IT.
   *
   * These were max-width and max-height with auto sizing, which bounds an image DOWNWARD and never scales
   * it up. Anything whose natural size was smaller than the stage drew at its natural size and left the
   * rest of the frame empty, which is the unused space below the picture.
   *
   * ⚠️ Filling the box and letting object-fit: contain do the fitting keeps the ratio exactly as before:
   * contain never crops. The only change is that a small source now scales UP to the space available,
   * which is what someone who opened a detail view asked for.
   */
  .full .stage img, .full .stage video { width: 100%; height: 100%; object-fit: contain; }
  /* ⚠️ The host's composer overlays the bottom of a fullscreen frame, so the strip needs room BELOW it or
     it sits behind the message box. Measured: clipped by roughly a composer's height. */
  .full .strip { flex: 0 0 auto; display: flex; gap: 8px; padding: 8px 16px 10px; overflow-x: auto; justify-content: center; }
  .full .strip .t { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; background: none; flex: 0 0 auto; }
  .full .strip .t[aria-current="true"] { border-color: ${GOLD}; }
  .full .strip .t img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /*
   * ⚠️ THE HOST'S COMPOSER OVERLAYS THE BOTTOM OF A FULLSCREEN FRAME. The foot was pressed flat against it
   * with no breathing room, so the actions read as squeezed against the message box rather than as part of
   * the picture above them. The strip already reserves 96px below itself for the same reason; the foot
   * sits inside that reserved band, which is why its own bottom padding is zero when a strip is present.
   */
  .full .foot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 16px 16px; flex-wrap: wrap; }
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
function Mark() {
  return (
    <svg viewBox={LAUREL_VIEW_BOX} className="mark" aria-hidden="true">
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
/**
 * ⛔ **NO `durationSecs` HERE, DELIBERATELY.** This passed 2 and ran THREE TIMES faster than the studio,
 * whose skeleton cards render `<LaurelLoader />` with no duration and therefore take its default of 6.
 * Nothing about a fast laurel looks broken, which is why it survived until the two were compared side by
 * side. The package owns the number now, so a surface that says nothing inherits the right speed.
 */
const LAUREL_CSS = laurelKeyframes({ prefix: 'ch' })

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

function IconOpen() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
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

/**
 * ⚠️ `preload="metadata"`: fetching whole videos for a result nobody played is a cost on someone else's bill.
 *
 * ## ⭐⭐⭐ `quality` IS WHICH FILE, AND IT IS NEVER WHICH FILE YOU DOWNLOAD
 *
 * `'preview'` paints the small derivative and `'master'` paints the real thing. A grid tile is 200 to 400
 * CSS px and a master is 1.7 to 2.9 MB, so a grid of masters is tens of megabytes over a browser's ~6
 * connections per origin: measured as five to ten minutes of skeletons with some tiles never arriving.
 *
 * ⛔ DOWNLOAD IS NOT A CONSUMER OF THIS. It reads `output.url` directly, because a preview is 1600px at
 * quality 80 and giving that to someone who asked for their asset is a downgrade they cannot see until
 * later. The distinction lives here as an explicit parameter precisely so no future caller has to infer it.
 */
function Media({
  output,
  kind,
  onReady,
  quality = 'master',
}: {
  output: Item
  kind: WidgetData['contentType']
  onReady?: () => void
  quality?: 'preview' | 'master'
}) {
  // A video's POSTER is already a small still, so the preview question does not arise for it.
  const src = quality === 'preview' ? (output.previewUrl ?? output.url) : output.url
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
  return <img className="media" src={src} alt={output.name} onLoad={onReady} onError={onReady} />
}

/**
 * The small still that represents an item in a strip, or null when none can exist.
 *
 * ⚠️ ORDER MATTERS AND IS NOT ARBITRARY. A video's representative image is its POSTER; an image's is its
 * own preview. `url` is deliberately absent from this chain: for a video it is an `.mp4`, and putting that
 * in an `<img>` is exactly what drew the broken-image icons.
 */
function thumbFor(o: Item): string | null {
  if (o.contentType === 'video') return o.posterUrl ?? null
  if (o.contentType === 'audio') return null
  return o.previewUrl ?? o.url
}

/**
 * What to CALL a set whose items do not share a shape.
 *
 * ⚠️ DERIVED FROM THE ITEMS, never a constant. A set is only "Creations" when every item actually is one;
 * the moment an upload or a stock clip joins, the honest word is the one that covers all of them. Absent
 * `source` counts as "not known to be a creation", so an older payload reads as Media rather than claiming
 * something it never stated.
 */
function setNoun(items: readonly Item[]): string {
  if (items.length === 0) return 'Media'
  return items.every((it) => it.source === 'creations') ? 'Creations' : 'Media'
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

const FALLBACK_EXT: Record<Item['contentType'], string> = { image: 'png', video: 'mp4', audio: 'mp3' }
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
}

function fileNameFor(o: Item): string {
  const ext = extensionOf(o.url) ?? FALLBACK_EXT[o.contentType]
  return o.name.includes('.') ? o.name : `${o.name}.${ext}`
}

function mimeFor(o: Item): string | undefined {
  const ext = extensionOf(o.url) ?? FALLBACK_EXT[o.contentType]
  return MIME_BY_EXT[ext]
}

/**
 * The messages the action buttons put in the conversation.
 *
 * ⭐ Kept together and out of the render tree because they are the actual PRODUCT of a button: what the
 * agent is asked to do. Reading them side by side is the only way to see that each one is complete, which
 * is the property the whole design rests on (see `say`).
 */
/**
 * ⭐⭐⭐ **THE MESSAGES NAME AN OUTPUT ID, NOT A URL.**
 *
 * A capability url is ~500 characters and carries a signed token in its query string, so pasting one into
 * the conversation dumped a JWT into the transcript and buried the instruction under it. `generate_image`'s
 * own `referenceImages` already documents the alternative: "a URL or a previous output id (e.g. `<id>` or
 * `<id>-2`)", and `<id>-2` is exactly what the widget already calls each output's `name`.
 *
 * ⚠️ So this is not a cosmetic shortening. The id is the token the API was designed to take, it survives
 * the url being re-signed, and it keeps a credential out of the chat log.
 */
const ASK = {
  animate: (ref: string) =>
    `Animate this image into a short video. Use it as the reference image: ${ref}\n\n` +
    `Pick a suitable video model and tell me which one before you spend credits.`,
  /**
   * ⚠️ NAMES THE MEDIUM, NEVER A MODEL. "an image-editing model" was hardcoded, which is both wrong for a
   * video and a frozen claim about a roster that changes with no deploy. `features.edit` in the registry is
   * the live answer, and the agent is the one that can read it.
   */
  edit: (ref: string, medium: 'image' | 'video' | 'audio') =>
    `I want to edit this ${medium}: ${ref}\n\n` +
    `Ask me what change I want. Then find a model that can edit a ${medium} (check the registry rather than ` +
    `assuming one) and tell me which you picked before you spend credits. Do not generate anything yet.`,
  /**
   * ⚠️ `model: ${d.modelId}` IS THE RAW ID ON PURPOSE. This message's reader is the agent, which needs the
   * token it can pass to a tool, not the display name a person reads. The chip is the opposite case and
   * renders nothing rather than an id; both are deliberate and stated in `format.ts` for the same reason.
   */
  /**
   * ⚠️ ONLY OFFERED WHEN THERE IS SOMETHING TO REPEAT. This emits `model:` and `prompt:` lines, and a
   * payload carrying neither (audio, an export, a mixed library set) produced a message with holes in it
   * that an agent would act on anyway.
   */
  canRecreate: (d: WidgetData) => Boolean(d.modelId && d.prompt),
  /**
   * ⭐ THE PER-ITEM TWIN, for a set whose items share no model or prompt.
   *
   * ⚠️ `source === 'creations'` IS PART OF THE TEST, not just the presence of a model. An upload can carry
   * a model id (something generated it elsewhere) and still not be a thing this product can generate again.
   */
  canRecreateItem: (o: Item) => Boolean(o.source === 'creations' && o.reference && o.modelId),
  /**
   * ⚠️ NAMES THE ITEM, DOES NOT QUOTE ITS PROMPT. Embedding one prompt per tile is affordable for a
   * generation's four variations and not for a hundred library items, and a truncated prompt would
   * regenerate something quietly different. The agent reads the settings from the id.
   */
  recreateItem: (o: Item) =>
    `Generate this again with the same settings: ${o.reference}\n\n` +
    `Read its prompt and settings first (model ${o.modelId}), tell me what you are about to run, ` +
    `then generate one.`,
  recreate: (d: WidgetData) => {
    const lines = [
      'Generate this again with the same settings.',
      '',
      `type: ${d.contentType}`,
      `model: ${d.modelId}`,
    ]
    if (d.displayAspect) lines.push(`aspect_ratio: ${d.displayAspect}`)
    lines.push(`count: ${itemsOf(d).length}`)
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
  /**
   * The line shown before any result exists, naming the tool the host says is running.
   *
   * ⚠️ A SENTENCE, NOT A SHAPE. Whatever fills this frame afterwards has its own dimensions, and text
   * claims none, so nothing snaps when the real card replaces it.
   */
  const [waitingLine, setWaitingLine] = useState('Waiting for the result.')
  /** Urls whose media has pixels on screen. Drives the laurel-to-media cross-fade, per tile. */
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  /** Why the last download failed, shown in the button's tooltip. Null when nothing has failed. */
  const [failReason, setFailReason] = useState<string | null>(null)
  /** True once ANY tool result has been delivered, whether or not it was a generation. See `readResult`. */
  const [answered, setAnswered] = useState(false)
  /**
   * The frame's own width, which is the only thing a masonry grid can reason from.
   *
   * ⚠️ MEASURED, not taken from the host's reported container: the host reports the space it GAVE us, and
   * our own padding and borders come out of that. `innerWidth` is what the grid actually has.
   */
  const [frameWidth, setFrameWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setFrameWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
    /**
     * ⚠️ A PENDING RESULT HAS NO OUTPUTS, so an `outputs.length` guard dropped it and the frame sat on
     * "Waiting for the generation result." forever. `outputId` is what identifies a generation at any stage.
     *
     * ⛔⛔ **AND A RESULT THAT IS NOT A GENERATION MUST COLLAPSE THE FRAME.**
     *
     * The widget is declared on the TOOL, so the host mounts it for EVERY result `generate_image` returns,
     * including `getCost: true`, which is a one-line estimate with no generation in it. That rendered an
     * empty card saying "Waiting for the generation result." on every preflight, waiting for something that
     * was never coming. Recording that a result ARRIVED, separately from whether it was a generation, is
     * what lets the frame render nothing instead of a lie.
     */
    setAnswered(true)
    /**
     * ⛔⛔ **A MIXED SET HAS NO `outputId`, AND THIS GUARD REQUIRED ONE.**
     *
     * The payload generalized from a generation to a set of items, and `outputId` became optional for
     * exactly the case it was meant to support: `get_media` returns tiles from many generations, so it
     * sends null. This guard then dropped the whole payload and `answered` made the frame render nothing,
     * so a working widget with eight resolved items displayed as an empty space and the agent, reading its
     * own successful tool result, reported that it had rendered.
     *
     * ⭐ The real question is "is there anything to show", which is items, or a job that will produce them.
     */
    if (sc && (sc.items?.length || sc.outputs?.length || sc.status === 'processing')) {
      setData(sc)
      setIndex(0)
      setRatio(null)
      setStalled(false)
    }
  }, [])

  /**
   * What the host says is running, taken from the tool's own declared title.
   *
   * ⛔ NO MAP OF TOOL NAMES TO PHRASES IN HERE. Every tool already carries a human title in its
   * annotations; a second list would be one more copy to keep in step with a surface that grows, and this
   * file has already paid for that pattern with the laurel paths and the model catalog.
   */
  const { app, isConnected } = useApp({
    appInfo: { name: 'contenthero-generation', version: '1' },
    capabilities: {},
    autoResize: true,
    onAppCreated: (a) => {
      a.ontoolresult = readResult
    },
  })

  /** Every tile, whichever payload era this result came from. See `itemsOf`. */
  const items = useMemo(() => (data ? itemsOf(data) : []), [data])
  const current = useMemo(() => items[index] ?? null, [items, index])

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
    const apply = (
      ctx:
        | {
            theme?: string
            displayMode?: string
            containerDimensions?: { height?: number; maxHeight?: number }
          }
        | undefined,
    ) => {
      document.documentElement.dataset.theme = ctx?.theme === 'light' ? 'light' : 'dark'
      /**
       * ⛔⛔⛔ **THE HOST OWNS THE DISPLAY MODE. OUR STATE WAS A SECOND SOURCE OF TRUTH FOR IT.**
       *
       * `full` was set only from the result of our own `requestDisplayMode`, so a mode change the host
       * made ON ITS OWN never reached us. Closing fullscreen with the host's X is exactly that: the host
       * returns the frame to inline and we keep rendering the `.full` tree, which is `position: fixed;
       * inset: 0` inside a frame that is now inline-sized. The result is a widget that VANISHES from the
       * conversation, with nothing broken enough to log.
       *
       * ⭐ Reading `displayMode` off the host context makes the host authoritative in both directions:
       * our request still asks, and this answers.
       */
      if (ctx?.displayMode) setFull(ctx.displayMode === 'fullscreen')
      /**
       * ⚠️ THE COMPOSER GROWS, so the band it overlays cannot be a constant. The host reports the container
       * it gave us; the part of the viewport BELOW that is what the composer occupies, plus a margin so
       * the strip is not merely touching it. Clamped to a sane range because a host that reports something
       * unexpected must not be able to push the whole layout off screen.
       */
      const dims = ctx?.containerDimensions
      const given = dims?.height ?? dims?.maxHeight
      if (given && window.innerHeight) {
        /**
         * ⚠️ THE FLOOR CAME DOWN FROM 184px TO 132px, AND THE ARROW IS WHY IT WAS EVER 184.
         *
         * The composer is about 90px. The extra reach was for the host's scroll-to-bottom arrow, which
         * floats over our frame and TAKES THE POINTER, so a button under it highlights only when the
         * cursor misses the arrow. There is nothing to query and nothing to disable from inside a
         * sandboxed frame, so standing further back was the whole of the fix.
         *
         * ⛔ THAT WAS MEASURED AGAINST THE INLINE FRAME. In fullscreen, which is the only thing that
         * consumes this, the host draws no arrow: measured 2026-09-21 from a fullscreen capture showing
         * the composer and no arrow, against an inline capture in the same session showing both. So 184
         * reserved an arrow's worth of emptiness under the action row for an arrow that is not there, and
         * that gap is exactly the unused space below the picture.
         *
         * ⚠️ 132 IS THE COMPOSER PLUS A MARGIN, NOT A GUESS AT THE ARROW. If an arrow ever does appear
         * over a fullscreen frame, the symptom is specific and immediate: a button that only responds when
         * the cursor is slightly off it. Raise this, do not chase the button.
         */
        const band = Math.min(240, Math.max(132, window.innerHeight - given + 24))
        document.documentElement.style.setProperty('--composer-band', `${Math.round(band)}px`)
      }
      /**
       * ⭐⭐ THE TOOL NAMES ITSELF, so the waiting line does not have to guess.
       *
       * `toolInfo.tool` is the tool DEFINITION the host is running, annotations and all, which means the
       * title is the same string the tool already advertises. That is why there is no phrase table in
       * here: adding a tool gives it a correct waiting line for free, and renaming one cannot leave a
       * stale copy behind.
       *
       * ⚠️ FALLS BACK TO THE NEUTRAL SENTENCE, never to a guess. A host that sends no `toolInfo` gets
       * "Waiting for the result", which is true of everything that mounts this frame.
       */
      const info = (ctx as {
        toolInfo?: { tool?: { name?: string; title?: string; annotations?: { title?: string } } }
      })?.toolInfo?.tool
      /**
       * ⚠️ `tool.title` IS THE FIELD, not `annotations.title`. Verified against a real `tools/list`:
       * every tool carries `title: "Generate Image"` at the top level and `annotations.title` is
       * undefined on all of them. Reading the wrong one falls back to the snake_case NAME, which is what
       * an agent addresses the tool by, not what a person should be shown.
       */
      const title = info?.title ?? info?.annotations?.title
      // An ellipsis is what makes a label read as an action in progress rather than as a button.
      if (title) setWaitingLine(`${title}\u2026`)
    }
    apply(app.getHostContext?.())
    app.addEventListener?.('hostcontextchanged', apply)
    return () => app.removeEventListener?.('hostcontextchanged', apply)
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
    if (!full || !data) return
    const all = itemsOf(data)
    if (all.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const len = all.length
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
    /**
     * ⛔⛔ **`itemsOf(data).length > 0` USED TO STOP THE POLL, WHICH IS WRONG NOW THAT A PARTIAL ANSWERS
     * WITH ITS PART.** Two of three ready has items AND is still processing; stopping there would freeze
     * the card at two tiles forever. `status` is the only thing that says whether more is coming.
     */
    if (!app || !data || data.status !== 'processing') return
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
        /**
         * ⛔⛔⛔ **THIS READ `sc.outputs`, A FIELD RENAMED TO `items`, SO IT NEVER SAW A FINISHED JOB.**
         *
         * Combined with the status tool having its `structuredContent` deleted, the poll was reading an
         * absent field off an absent payload. It never matched, so the card sat on its skeletons until the
         * twenty-minute deadline while the images were visibly finished in the studio. Two independent
         * breakages of one path, each invisible on its own.
         *
         * ⭐ `itemsOf` normalizes both spellings, which is the same function the render path uses, so
         * there is one answer to "what tiles does this payload have" rather than a second opinion here.
         */
        const got = sc ? itemsOf(sc) : []
        if (got.length > 0) {
          /**
           * ⭐⭐ MERGED, NOT REPLACED. The poll's answer knows the items; only the ORIGINAL pending result
           * knew how many were asked for. Replacing wholesale would drop `expected` and the remaining
           * skeletons would vanish the moment the first tile landed, which reads as "finished" when it is
           * not.
           */
          setData((prev) => ({ ...prev, ...sc, expected: prev?.expected ?? sc?.expected }))
          setRatio(null)
          // Still processing means more are coming, so keep polling rather than returning.
          if (sc?.status !== 'processing') return
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

  /**
   * ⭐⭐⭐ **WE HOLD THE BYTES. THE HOST IS NOT ASKED TO GO AND GET THEM.**
   *
   * This sent a `resource_link` and the host answered `isError`, twice, with no way to tell refusal from
   * failure. A link hands the host a job it may not be able to do: our urls are capability urls whose
   * token rides in the query string, and nothing in the protocol says a host will fetch one, from where,
   * or with what. The reference implementation's own `resource_link` was rejected outright elsewhere in
   * this project with "Resource links are not currently supported".
   *
   * ⭐ An embedded resource removes the question. The frame fetches the object itself, which it can do now
   * that `connectDomains` is declared, and hands over bytes the host only has to write to disk. Nothing
   * depends on host behavior we cannot observe from in here.
   *
   * ⚠️ THE LINK REMAINS AS A FALLBACK, and only for the case that is genuinely different: a fetch blocked
   * by CSP or a network failure means we have no bytes to offer, so asking the host to try is strictly
   * better than giving up. Any failure now carries its reason to the button.
   */
  const download = async (o: Item) => {
    // ⚠️ `data` is narrowed below, but this closure is defined above that point, so the guard is restated.
    if (!app || !data) return
    setBusy(o.url)
    setFailed(null)
    setFailReason(null)
    const name = fileNameFor(o)
    const mimeType = mimeFor(o)
    try {
      let sent: { isError?: boolean } | undefined
      try {
        const res = await fetch(o.url)
        if (!res.ok) throw new Error(`the media responded ${res.status}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        // ⚠️ CHUNKED. `String.fromCharCode(...buf)` on a multi-megabyte image blows the argument limit and
        // throws a RangeError that reads like an unrelated crash.
        let binary = ''
        for (let i = 0; i < buf.length; i += 0x8000) {
          binary += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        }
        sent = await app.downloadFile({
          contents: [{ type: 'resource', resource: { uri: o.url, mimeType, blob: btoa(binary) } }],
        })
      } catch (err) {
        // No bytes to offer. Ask the host to fetch rather than giving up.
        sent = await app.downloadFile({
          contents: [{ type: 'resource_link', uri: o.url, name, mimeType }],
        })
        if (sent?.isError) setFailReason(err instanceof Error ? err.message : 'could not read the file')
      }
      if (sent?.isError) {
        setFailed(o.url)
        setFailReason((r) => r ?? 'the host declined to save it')
      }
    } catch (err) {
      setFailed(o.url)
      setFailReason(err instanceof Error ? err.message : 'the download failed')
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
    /**
     * ⛔ NOTHING AT ALL once a result has arrived that was not a generation. A cost estimate is a legitimate
     * answer from this tool, and the honest rendering of "this response has no media in it" is no card,
     * not an empty one apologising for itself.
     */
    if (answered) return null
    /**
     * ⛔⛔ **THIS SAID "Waiting for the generation result" FOR EVERY TOOL THAT DECLARES THIS WIDGET.**
     *
     * The host mounts the frame when the CALL starts, before any result exists, so this is what a person
     * sees during `show_media`, `get_media`, an import and an upload as well: a message about generating
     * something, from a tool that generates nothing. It was written when a generation was the only thing
     * that could render here.
     *
     * ⭐ The frame does not know what it is waiting for, so it says nothing and shows the mark instead.
     * A laurel is true for every producer, and it is the same shape the tiles fall back to, so the wait
     * and the thing being waited for look like one object rather than two.
     */
    /**
     * ⚠️ NOT CONNECTED IS A DIFFERENT STATE FROM NOT YET ANSWERED, and only one of them resolves on its
     * own. A frame that never reached the host does not fix itself, so that one keeps its words.
     */
    if (!isConnected) return <div className="fallback muted">Connecting.</div>
    /**
     * ⛔⛔ **A BIG LAUREL IN AN EMPTY BOX IS NOT A BRIDGE, IT IS A FAKE TILE.**
     *
     * I filled this gap with one large laurel in a 16:9 frame. For a request of four portrait variations
     * that then snapped to four portrait skeletons, which is a worse transition than the text it replaced:
     * the laurel's job is to sit INSIDE a tile while that tile loads, and borrowing it to stand in for the
     * whole widget makes the first thing you see a shape that nothing will ever occupy.
     *
     * ⭐ A LINE OF TEXT IS THE HONEST BRIDGE. It claims no layout, so nothing has to snap.
     *
     * ⭐⭐ AND IT NAMES THE ACTUAL TOOL, from `toolInfo.tool`, which the host hands us. The line used to
     * read "Waiting for the generation result" for every tool that declares this widget, including
     * `show_media` and `get_media`, which generate nothing. The title comes from the tool's own
     * annotations, so it cannot drift from the surface the way a list in here would.
     */
    return <div className="fallback muted">{waitingLine}</div>
  }

  /** True while the server has told us a job is running and nothing has landed yet. */
  /**
   * ⭐⭐⭐ **STILL WORKING IS NOT THE SAME AS HAVING NOTHING, AND CONFLATING THEM IS WHY A CARD WAITED FOR
   * THE WHOLE BATCH.**
   *
   * `pending` used to mean "processing AND no items", so the first tile to land flipped it false and every
   * remaining skeleton vanished at once: the card showed two tiles and looked finished while a third was
   * still rendering. The studio has always resolved each card the moment its own image exists, and this
   * was the one surface that could not.
   *
   * `working` is the honest question (is more coming), and `awaiting` is how many placeholders are left to
   * draw beside whatever has already arrived.
   */
  const working = data.status === 'processing'

  /**
   * ⚠️ `expected` COMES FROM THE JOB THAT STARTED IT, never from a poll: a partial answer knows how many
   * exist so far, not how many were asked for. Falling back to what we have means a payload with no
   * expected count draws no phantom placeholders.
   */
  const expected = Math.max(items.length, working ? (data.expected ?? items.length ?? 1) : items.length)
  const awaiting = Math.max(0, expected - items.length)
  /** Layout still reasons about the FULL set, so tiles do not resize as the last ones arrive. */
  const n = Math.max(1, expected)
  /** Nothing has arrived yet: the card is only skeletons, which is what suppresses the set noun and verbs. */
  const pending = working && items.length === 0
  /**
   * ⚠️ A MIXED SET HAS NO SINGLE NOUN. "4 images" is only true when every item is an image, which is the
   * uniform case; anything else is honestly just "items".
   */
  const noun = data.contentType ?? (isUniform(items) ? items[0]?.contentType ?? 'item' : 'item')
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
  const aspect = ratio ?? data.displayAspect ?? (isUniform(items) ? items[0]?.displayAspect ?? null : null)

  /**
   * ⭐⭐⭐ **ROW OR MASONRY, DECIDED BY THE DATA.**
   *
   * Variations of one generation share a medium and a shape and exist to be compared, so they go on a row
   * sized by that shape. A mixed set shares nothing and is being scanned, so it goes in a masonry grid
   * that keeps each item's own shape. Neither is a mode anyone selects; `isUniform` reads a property the
   * payload already carries.
   */
  const uniform = pending || isUniform(items)

  /**
   * ⚠️ `Math.min` WITH THE COUNT. Three outputs under a four-column rule would otherwise lay out as three
   * tiles and a hole, which reads as a missing item rather than an arrangement.
   */
  /**
   * ⚠️ TWO RULES, BECAUSE THEY ANSWER TWO QUESTIONS. A uniform set's column count comes from its SHAPE
   * (four portrait variations belong on one row); a mixed set's comes from the WIDTH, because there is no
   * shared shape to reason from. Both rules live in `@contenthero-ai/brand-ui` so the studio and a chat
   * arrange the same media the same way.
   */
  const cols = uniform ? Math.min(n, columnsForAspect(aspect)) : masonryColumns(frameWidth, n)

  /**
   * ⭐ ONE ACTION SET, RENDERED TWICE. The hover overlay and the fullscreen foot offer the same verbs, so
   * they are built from one function: two lists would drift the first time a verb is added to one of them.
   *
   * ## ⚠️ WHICH VERBS APPLY, AND WHY EDIT IS NOT IMAGE-ONLY
   *
   * Download and Open apply to everything: a file is always a file, and everything lives somewhere.
   *
   * ANIMATE is genuinely image-only. It turns a still into motion, so there is nothing to animate about a
   * video and nothing to see in audio.
   *
   * ⭐⭐ EDIT APPLIES TO VIDEO TOO, and gating it on the medium was a guess this codebase can check:
   * `features.edit: true` is a real flag in `model_provider_capabilities`, and `seedance-2` carries it with
   * `videoRef` among its input types. Video editing is a capability we already sell.
   *
   * ⛔⛔ THE WIDGET MUST NOT ENCODE WHICH MODELS CAN EDIT. The registry changes with no deploy, so a list
   * here would be stale the week after it is written. The message names the MEDIUM and the agent resolves a
   * model at call time, which is the same rule that keeps the model roster out of the skill.
   *
   * RECREATE needs a model and a prompt, so it is offered only for a CREATION that carries both. An upload
   * was never generated, and "generate this again" is an instruction the agent cannot carry out.
   */
  /**
   * ⭐⭐⭐ ONE VERB LIST, THREE ZONES, AND THE ZONE IS AN ARGUMENT RATHER THAN A SECOND LIST.
   *
   * `zone` selects which verbs to draw: `'center'` is the creative choice (Animate, Edit, Recreate),
   * `'download'` and `'open'` are the two exits that sit in the tile's corners, and `'all'` is the detail
   * view's single labeled row.
   *
   * ⛔ THE ALTERNATIVE WAS A SECOND COPY PER ZONE, and this file already carries the scar: the detail foot
   * grew its own Open and its own Recreate, so once those verbs were added to the shared list the foot
   * rendered BOTH and someone saw two Open buttons side by side. One list cannot disagree with itself.
   */
  const actions = (o: Item, opts: { labels: boolean; zone?: 'all' | 'center' | 'download' | 'open' }) => {
    const zone = opts.zone ?? 'all'
    const show = (z: 'center' | 'download' | 'open') => zone === 'all' || zone === z
    const isImage = o.contentType === 'image'
    /** Verbs that must name this item to the API. See `Item.reference`. */
    const canReference = Boolean(o.reference)
    const t = (s: string) => (opts.labels ? s : null)
    // ⛔ A LABELED BUTTON GETS NO TOOLTIP. It already says what it does, and repeating that on hover is
    // noise. `tip` is undefined in the labeled variant so the attribute is absent, not empty.
    const tip = (s: string) => (opts.labels ? undefined : s)
    const refused = failed === o.url
    return (
      <>
        {show('center') && isImage && canReference && (
          /**
           * ⚠️ NEUTRAL, NOT GOLD. Animate carried the brand fill as the "primary" verb, which is a claim
           * about what someone wants that we are in no position to make: on a library set the likely verb
           * is Download, and on a fresh generation it may be Recreate. One treatment across every button
           * in both the hover row and the detail foot, so nothing is emphasized by accident.
           */
          <button className="pill neutral" onClick={() => void say(ASK.animate(o.reference!))} data-tip={tip('Animate')}>
            <IconAnimate />
            {t('Animate')}
          </button>
        )}
        {show('download') && (
        <button
          className={`pill neutral${refused ? ' warn' : ''}`}
          onClick={() => void download(o)}
          disabled={busy === o.url}
          data-tip={refused ? failReason || 'The host refused that download' : tip('Download')}
        >
          <IconDownload />
          {t(refused ? 'Not downloaded' : busy === o.url ? 'Saving' : 'Download')}
        </button>
        )}
        {show('center') && canReference && o.contentType !== 'audio' && (
          <button
            className="pill neutral"
            onClick={() => void say(ASK.edit(o.reference!, o.contentType))}
            data-tip={tip('Edit')}
          >
            <IconEdit />
            {t('Edit')}
          </button>
        )}
        {show('open') && o.openUrl && (
          <button
            className="pill neutral"
            onClick={() => void app?.openLink({ url: o.openUrl! })}
            data-tip={tip('Open')}
          >
            <IconOpen />
            {t('Open')}
          </button>
        )}
        {/* ⭐ PER ITEM, so a mixed set offers it too. It used to read the payload's SHARED model and prompt,
            which are null the moment two items disagree, so a library set offered no Recreate at all even
            though every item knew its own. */}
        {show('center') && ASK.canRecreateItem(o) && (
          <button
            className="pill neutral"
            onClick={() => void say(ASK.recreateItem(o))}
            data-tip={tip('Recreate')}
          >
            <IconRecreate />
            {t('Recreate')}
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
      {/**
        * ⭐⭐⭐ A RATIO DESCRIBES A SHAPE, SO IT MAY ONLY LABEL A SET THAT HAS ONE.
        *
        * `aspect` falls back to the FIRST loaded image's measured ratio, which is correct for a generation
        * (every variation shares it by construction) and a lie for a library set: a grid of 1:1 flowers,
        * 16:9 terraces and a portrait clip was labeled "1:1" because item one happened to be square.
        *
        * A mixed set gets a NOUN instead. "Creations" when every item is one, "Media" when the set spans
        * libraries, because an upload was never created here and calling it a creation is the same class of
        * wrong as the ratio.
        */}
      {uniform && aspect ? (
        <span className="badge">{aspect}</span>
      ) : (
        !pending && <span className="badge">{setNoun(items)}</span>
      )}
    </>
  )

  if (full && current) {
    return (
      <div className="full">
        {/* ⛔ NO HEADER HERE. The host already frames a fullscreen app with its own title and close control,
            so drawing ours produced two of each stacked on top of one another. */}
        <div className="stage">
          {/* ⭐ THE MASTER, because this is the view someone opened to LOOK at the thing, and a 1600px
              preview is soft at 2600 device px on a retina display. The tile they clicked is already
              painted underneath, so this is a swap rather than a blank frame. */}
          <Media output={current} kind={current.contentType} quality="master" />
        </div>
        {n > 1 && (
          <div className="strip" role="tablist" aria-label="Variations">
            {items.map((o, i) => (
              <button
                key={o.url}
                className="t"
                role="tab"
                aria-current={i === index}
                aria-label={`${i + 1} of ${n}`}
                onClick={() => setIndex(i)}
              >
                {thumbFor(o) ? (
                  <img src={thumbFor(o)!} alt="" />
                ) : (
                  /**
                   * ⚠️ A GLYPH ONLY WHERE NO STILL CAN EXIST. Audio has no frame to show, so this is the
                   * honest answer rather than a placeholder standing in for a picture we failed to fetch.
                   * A video reaching this branch means its poster is genuinely missing and needs a backfill,
                   * not a read-side workaround.
                   */
                  <span className="t-glyph" aria-hidden>♪</span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="foot">
          {/**
            * ⛔ THE ONLY VERB SOURCE. This used to be the shared list PLUS a hand-rolled Open and a
            * hand-rolled Recreate, which was invisible until those two verbs joined the shared list and
            * the foot started drawing each of them twice. A second copy of a list is a duplicate waiting
            * for the first thing to be added to the other one.
            */}
          {actions(current, { labels: true })}
          <span className="spacer" />
          {badges}
          {/* ⭐ "Variation X of Y" IS GENERATION VOCABULARY. True for variations of one generation, false
              for a library set spanning many, where item 3 is not a variation of anything. */}
          {n > 1 && (
            <span className="muted">
              {uniform ? `Variation ${index + 1} of ${n}` : `${index + 1} of ${n}`}
            </span>
          )}
        </div>
      </div>
    )
  }

  /**
   * ⭐ ONE TILE, RENDERED FROM ONE PLACE, so the uniform row and the masonry columns cannot drift. The
   * two layouts differ only in how tiles are GROUPED; a tile is the same thing in both.
   */
  const renderTile = (o: Item, i: number) => (
          <div
            key={o.url}
            className={
              `tile${o.contentType === 'image' ? ' img' : ''}` +
              `${o.contentType === 'audio' ? ' audio' : ''}` +
              ` ${(uniform ? aspect : o.displayAspect) ? 'shaped' : 'unshaped'}` +
              `${loaded.has(o.url) ? ' ready' : ''}`
            }
            // ⭐ The tile takes the MEDIA's shape, so there is nothing left over to letterbox. See `.tile` above.
            /**
             * ⚠️ THE TILE'S OWN SHAPE IN A MIXED SET, the shared one when the set is uniform. Using the
             * shared value for a mixed set would crop every item that disagreed with the first one,
             * silently, because object-fit: cover trims against whatever ratio the tile was given.
             */
            style={(() => {
              const a = uniform ? aspect : (o.displayAspect ?? null)
              return a ? shapeOf(a) : undefined
            })()}
            onClick={() => {
              setIndex(i)
              if (o.contentType === 'image') void setMode(true)
            }}
          >
            {o.contentType === 'image' ? (
              <img
                className="media"
                /**
                 * ⭐⭐⭐ THE PREVIEW, NOT THE MASTER. A tile is 200 to 400 CSS px and a master is 1.7 to
                 * 2.9 MB; a grid of them is tens of megabytes over ~6 connections. Download still reads
                 * `o.url`, so nobody receives the small file as their asset.
                 */
                src={o.previewUrl ?? o.url}
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
                kind={o.contentType}
                quality="preview"
                onReady={() => setLoaded((prev) => (prev.has(o.url) ? prev : new Set(prev).add(o.url)))}
              />
            )}
            {/* The laurel sits ON the media until it has pixels, then the two cross-fade. See .tile .media. */}
            {!loaded.has(o.url) && o.contentType !== 'audio' && (
              <div className="laurel-wrap">
                <Skeleton />
              </div>
            )}
            {/* ⚠️ stopPropagation on EVERY zone, or an action also opens the lightbox underneath it. */}
            {/**
              * ⭐⭐ AUDIO PUTS EVERY VERB IN ONE ROW, because the corners exist to keep exits off a picture
              * and an audio tile has no picture: it has a TRANSPORT. Pinning buttons to the edges of a
              * short box puts them straight back onto the play and scrub controls they were moved away
              * from, which is what made audio tiles unclickable. Every verb still renders, in one place,
              * below the control rather than over it.
              */}
            {o.contentType === 'audio' ? (
              <div className="acts" onClick={(e) => e.stopPropagation()}>
                {actions(o, { labels: false, zone: 'all' })}
              </div>
            ) : (
              <>
                <div className="corner tl" onClick={(e) => e.stopPropagation()}>
                  {actions(o, { labels: false, zone: 'download' })}
                </div>
                <div className="corner tr" onClick={(e) => e.stopPropagation()}>
                  {actions(o, { labels: false, zone: 'open' })}
                </div>
                <div className="acts" onClick={(e) => e.stopPropagation()}>
                  {actions(o, { labels: false, zone: 'center' })}
                </div>
              </>
            )}
          </div>
  )

  return (
    <div className="wrap">
      {/* ⭐ METADATA LEFT, MARK RIGHT. The wordmark and the count both went: the host already shows which
          connector answered, and the count is said once at the bottom instead of twice. */}
      <div className="head">
        <div className="badges">{badges}</div>
        <span className="spacer" />
        {/* Size comes from `.head .mark`, deliberately: see the rule for why it is not passed here. */}
        <Mark />
      </div>

      {data.prompt && (
        <div className="meta">
          <p
            className={openPrompt ? 'prompt' : 'prompt clamped'}
            onClick={() => setOpenPrompt((v) => !v)}
            /**
             * ⛔ NO `title` HERE ANY MORE. The native tooltip is the host OS's, appears after about a
             * second, cannot be themed, and is the same mechanism that made the icon buttons look
             * unlabelled. The clamp plus the pointer cursor already say the text is expandable, and the
             * one tooltip treatment in this widget is scoped to buttons that genuinely have no label.
             */
          >
            {data.prompt}
          </p>
        </div>
      )}

      <div className={uniform ? 'grid' : 'grid mixed'} style={{ ['--cols' as string]: String(cols) }}>
        {/* ⭐ DRAWN AFTER THE REAL TILES BELOW WOULD PUT THEM IN THE WRONG ORDER, so the placeholders for
            what is still coming are rendered FIRST only while nothing has arrived. Once tiles exist they
            follow them, which matches the order the slots will fill. */}
        {awaiting > 0 && items.length === 0 &&
          Array.from({ length: awaiting }, (_, i) => (
            // ⚠️ A placeholder is ALWAYS shaped: `shapeOf` bottoms out at 1:1, matching the studio's own
            // aspect resolver. There is no media to crop yet, so a square beats an arbitrary fixed height
            // that the real tile would then jump away from.
            <div key={`pending-${i}`} className="tile shaped" style={shapeOf(aspect ?? '1:1')}>
              <div className="laurel-wrap">
                <Skeleton />
              </div>
            </div>
          ))}
        {/**
          * ⭐⭐⭐ UNIFORM FLOWS; MIXED IS PACKED INTO COLUMNS.
          *
          * A uniform set is a ROW, so its tiles are siblings and the grid arranges them. A mixed set
          * needs each column to be its own stack, because that is the only way the reading order runs
          * ACROSS rather than down: multi-column fills a column before starting the next, by definition.
          *
          * ⚠️ THE INDEX PASSED TO renderTile IS THE INDEX IN `items`, not the position within a column.
          * The lightbox and the strip both index into `items`, so a per-column index would open the
          * wrong picture from the second column onward.
          */}
        {/* ⭐ THE TILES THAT HAVE LANDED, then a placeholder for each slot still working, so a set fills in
            one at a time exactly as the studio's grid does. */}
        {uniform
          ? items.map((o, i) => renderTile(o, i))
          : packIntoColumns(
              items.map((o, i) => ({ o, i })),
              cols,
              (e) => e.o.displayAspect,
            ).map((col, ci) => (
              <div className="col" key={`col-${ci}`}>
                {col.map((e) => renderTile(e.o, e.i))}
              </div>
            ))}
        {awaiting > 0 && items.length > 0 &&
          Array.from({ length: awaiting }, (_, i) => (
            <div key={`awaiting-${i}`} className="tile shaped" style={shapeOf(aspect ?? '1:1')}>
              <div className="laurel-wrap">
                <Skeleton />
              </div>
            </div>
          ))}
      </div>

      <div className="bar">
        <span className="muted">{label}</span>
        <span className="spacer" />
        {/* Recreate acts on the GENERATION, not one output, which is why it sits under the set rather than
            on a tile. It carries the prompt and settings, so it needs no follow-up to be actionable. */}
        {!pending && ASK.canRecreate(data) && (
          <button className="pill neutral" onClick={() => void say(ASK.recreate(data))}>
            <IconRecreate />
            Recreate
          </button>
        )}
        {!pending && canExpand && items.some((it) => it.contentType === 'image') && (
          <button className="pill neutral" onClick={() => void setMode(true)}>Expand</button>
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
