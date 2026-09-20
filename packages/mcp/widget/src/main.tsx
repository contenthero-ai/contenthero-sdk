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
import { useCallback, useMemo, useState } from 'react'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import { columnsForAspect, aspectToCss, LAUREL_PATHS, LAUREL_VIEW_BOX, LAUREL_GOLD } from '@contenthero-ai/brand-ui'

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
  :root { color-scheme: light dark; }
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
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge {
    display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
    border-radius: 999px; font-size: 12px;
    background: var(--color-background-tertiary, color-mix(in srgb, CanvasText 8%, transparent));
    color: var(--color-text-secondary, color-mix(in srgb, CanvasText 62%, transparent));
  }
  .badge .dot { width: 6px; height: 6px; border-radius: 999px; background: ${GOLD}; }

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
  .tile.shaped { aspect-ratio: var(--ar); }
  .tile.shaped img, .tile.shaped video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Shape unknown: contain inside a bounded box, because cropping on a guess is worse than a bar. */
  .tile.unshaped img, .tile.unshaped video { display: block; width: 100%; height: auto; max-height: 260px; object-fit: contain; }
  .tile audio { width: 100%; padding: 22px 14px; }

  /* Actions live ON the thing they act on. Hidden until hover, but never unreachable by keyboard. */
  .acts { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity .12s ease; }
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
  .full { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--color-background-primary, Canvas); }
  .full .stage { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .full .stage img, .full .stage video { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
  /* ⚠️ The host's composer overlays the bottom of a fullscreen frame, so the strip needs room BELOW it or
     it sits behind the message box. Measured: clipped by roughly a composer's height. */
  .full .strip { flex: 0 0 auto; display: flex; gap: 8px; padding: 10px 16px 96px; overflow-x: auto; justify-content: center; }
  .full .strip .t { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; background: none; flex: 0 0 auto; }
  .full .strip .t[aria-current="true"] { border-color: ${GOLD}; }
  .full .strip .t img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .full .foot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px 16px; flex-wrap: wrap; }
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

/** ⚠️ `preload="metadata"`: fetching whole videos for a result nobody played is a cost on someone else's bill. */
function Media({ output, kind }: { output: Output; kind: WidgetData['contentType'] }) {
  if (kind === 'video') {
    return <video src={output.url} poster={output.posterUrl ?? undefined} controls preload="metadata" playsInline />
  }
  if (kind === 'audio') return <audio src={output.url} controls preload="metadata" />
  return <img src={output.url} alt={output.name} loading="lazy" />
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

function Widget() {
  const [data, setData] = useState<WidgetData | null>(null)
  const [index, setIndex] = useState(0)
  const [full, setFull] = useState(false)
  const [openPrompt, setOpenPrompt] = useState(false)
  const [ratio, setRatio] = useState<string | null>(null)

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
    if (sc?.outputs?.length) {
      setData(sc)
      setIndex(0)
      setRatio(null)
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

  const download = (o: Output) =>
    void app?.downloadFile({ contents: [{ type: 'resource_link', uri: o.url, name: o.name }] })
  const open = (o: Output) => void app?.openLink({ url: o.url })

  if (!data || !current) {
    return <div className="fallback muted">{isConnected ? 'Waiting for the generation result.' : 'Connecting.'}</div>
  }

  const n = data.outputs.length
  const label = n === 1 ? data.contentType : `${n} ${data.contentType}s`

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

  const badges = (
    <>
      {/* ⛔ No `?? data.modelId`. A null name means the server could not resolve one, and the id reads
          enough like a label that printing it turns that into a cosmetic bug nobody can diagnose. */}
      {data.modelName && (
        <span className="badge">
          <span className="dot" style={{ background: data.modelBrandColor || GOLD }} />
          {data.modelName}
        </span>
      )}
      {aspect && <span className="badge">{aspect}</span>}
    </>
  )

  if (full) {
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
          <button className="pill gold" onClick={() => download(current)}>Download</button>
          <button className="pill" onClick={() => open(current)}>Open</button>
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
        {data.outputs.map((o, i) => (
          <div
            key={o.url}
            className={`tile${data.contentType === 'image' ? ' img' : ''} ${aspect ? 'shaped' : 'unshaped'}`}
            // ⭐ The tile takes the MEDIA's shape, so there is nothing left over to letterbox. See `.tile` above.
            style={aspect ? { ['--ar' as string]: aspectToCss(aspect) } : undefined}
            onClick={() => {
              setIndex(i)
              if (data.contentType === 'image') void setMode(true)
            }}
          >
            {data.contentType === 'image' ? (
              <img
                src={o.url}
                alt={o.name}
                loading="lazy"
                // ⭐ MEASURED FROM THE REAL PIXELS rather than declared, so the badge cannot disagree with
                // what is on screen the way a parameter threaded through three layers can.
                onLoad={(e) => {
                  if (i !== 0) return
                  const el = e.currentTarget
                  if (el.naturalWidth && el.naturalHeight) setRatio(ratioLabel(el.naturalWidth, el.naturalHeight))
                }}
              />
            ) : (
              <Media output={o} kind={data.contentType} />
            )}
            <div className="acts">
              <button className="pill" onClick={(e) => { e.stopPropagation(); download(o) }}>Download</button>
              <button className="pill" onClick={(e) => { e.stopPropagation(); open(o) }}>Open</button>
            </div>
          </div>
        ))}
      </div>

      {canExpand && data.contentType === 'image' && (
        <div className="bar">
          <span className="muted">{label}</span>
          <span className="spacer" />
          <button className="pill ghost" onClick={() => void setMode(true)}>Expand</button>
        </div>
      )}
    </div>
  )
}

const style = document.createElement('style')
style.textContent = styles
document.head.appendChild(style)

const root = document.createElement('div')
document.body.appendChild(root)
createRoot(root).render(<Widget />)
