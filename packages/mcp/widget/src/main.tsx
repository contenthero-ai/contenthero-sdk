/**
 * The generation widget: what a person SEES when ContentHero makes something for them.
 *
 * ## Why this exists at all
 *
 * MCP's content blocks are `text | image | audio | resource | resource_link`. **There is no video block**,
 * so no arrangement of blocks can put a playing video in a conversation. Measured in production on
 * 2026-09-19: a `resource_link` rendered as a "View the generated image" hyperlink in ChatGPT and as
 * NOTHING AT ALL in Claude.
 *
 * MCP Apps is the mechanism that does work, and it is an open standard rather than anything proprietary:
 * the server publishes an HTML resource under `ui://`, the host mounts it, and the widget reads the tool's
 * `structuredContent`. Verified against a working implementation before committing to it.
 *
 * ⭐ ONE WIDGET FOR EVERY MEDIUM, and that is a correctness decision rather than a saving. A generation is a
 * generation: one image, four variations, a video, a voiceover. Three special cases would be three places
 * for "which variation am I looking at" to drift, and the batch case is exactly where the old code was
 * already wrong (it showed one of four).
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@modelcontextprotocol/ext-apps/react'

/** One output of a generation. Mirrors what `generationWidgetData` puts in `structuredContent`. */
interface Output {
  readonly url: string
  readonly posterUrl?: string | null
  readonly name: string
}

interface WidgetData {
  readonly outputId: string
  readonly contentType: 'image' | 'video' | 'audio'
  readonly modelId: string
  readonly outputs: readonly Output[]
  readonly prompt?: string | null
}

/**
 * ⚠️ THEMED FROM THE HOST, NOT FROM OUR APP.
 *
 * The widget renders inside someone else's conversation, which may be light or dark and is not ours to
 * override. The host exposes CSS variables for exactly this, so the surface colors follow it and only the
 * BRAND accent is ours. Olympus Gold `#d4af37` is the one fixed value here; everything else adapts.
 *
 * ⛔ Hardcoding our own background would produce a dark slab sitting in a light conversation, which reads as
 * broken rather than branded.
 */
const GOLD = '#d4af37'

const styles = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    color: var(--text-primary, CanvasText);
    background: transparent;
  }
  .wrap { border: 1px solid var(--border-primary, color-mix(in srgb, CanvasText 14%, transparent));
          border-radius: 12px; overflow: hidden; background: var(--bg-secondary, Canvas); }
  .stage { position: relative; display: flex; align-items: center; justify-content: center;
           background: color-mix(in srgb, CanvasText 6%, transparent); min-height: 180px; }
  .stage img, .stage video { display: block; max-width: 100%; max-height: 60vh; height: auto; }
  .stage audio { width: 100%; padding: 28px 20px; }
  .bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap;
         border-top: 1px solid var(--border-primary, color-mix(in srgb, CanvasText 14%, transparent)); }
  .model { font-weight: 600; letter-spacing: .01em; }
  .muted { color: var(--text-secondary, color-mix(in srgb, CanvasText 55%, transparent)); }
  .spacer { flex: 1 1 auto; }
  .btn { appearance: none; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
         background: transparent; color: inherit; font: inherit; padding: 5px 11px;
         border-radius: 7px; cursor: pointer; }
  .btn:hover { border-color: ${GOLD}; }
  .btn:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
  .thumbs { display: flex; gap: 8px; padding: 10px 12px; overflow-x: auto;
            border-top: 1px solid var(--border-primary, color-mix(in srgb, CanvasText 14%, transparent)); }
  .thumb { flex: 0 0 auto; width: 58px; height: 58px; border-radius: 8px; overflow: hidden;
           border: 2px solid transparent; background: color-mix(in srgb, CanvasText 10%, transparent);
           padding: 0; cursor: pointer; }
  .thumb[aria-current="true"] { border-color: ${GOLD}; }
  .thumb:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .prompt { padding: 0 12px 12px; }
  .fallback { padding: 16px; }
  .fallback a { color: ${GOLD}; }
`

/**
 * ⚠️ A VIDEO NEEDS ITS POSTER, OR THE FIRST FRAME IS A BLACK RECTANGLE until the user presses play.
 * `preload="metadata"` is deliberate too: fetching whole videos for a result nobody played is the kind of
 * cost that only shows up on someone else's bill.
 */
function Media({ output, contentType }: { output: Output; contentType: WidgetData['contentType'] }) {
  if (contentType === 'video') {
    return (
      <video src={output.url} poster={output.posterUrl ?? undefined} controls preload="metadata" playsInline />
    )
  }
  if (contentType === 'audio') return <audio src={output.url} controls preload="metadata" />
  return <img src={output.url} alt={output.name} />
}

function Widget() {
  const { app, isConnected } = useApp({
    appInfo: { name: 'contenthero-generation', version: '1' },
    capabilities: {},
    autoResize: true,
  })

  const [data, setData] = useState<WidgetData | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!app) return
    /**
     * ⚠️ BOTH THE INITIAL RESULT AND LATER ONES. The host delivers the tool result that opened this widget,
     * and may deliver another if the same widget is reused. Reading only the first leaves a stale image on
     * screen after the next generation, which is worse than showing nothing.
     */
    const read = (result: unknown) => {
      const sc = (result as { structuredContent?: WidgetData } | null)?.structuredContent
      if (sc?.outputs?.length) {
        setData(sc)
        setIndex(0)
      }
    }
    read(app.toolResult)
    app.ontoolresult = read
  }, [app])

  const current = useMemo(() => data?.outputs[index] ?? null, [data, index])

  if (!data || !current) {
    // Never a spinner that outlives its cause: if the host never delivers, this line is the honest state.
    return <div className="fallback muted">{isConnected ? 'Waiting for the generation result.' : 'Connecting.'}</div>
  }

  const many = data.outputs.length > 1

  return (
    <div className="wrap">
      <div className="stage">
        <Media output={current} contentType={data.contentType} />
      </div>

      {many && (
        <div className="thumbs" role="tablist" aria-label="Variations">
          {data.outputs.map((o, i) => (
            <button
              key={o.url}
              className="thumb"
              role="tab"
              aria-current={i === index}
              aria-label={`Variation ${i + 1} of ${data.outputs.length}`}
              onClick={() => setIndex(i)}
            >
              {/* A video's thumbnail is its poster; an image is its own. Audio has neither, so the number does the work. */}
              {o.posterUrl || data.contentType === 'image' ? (
                <img src={o.posterUrl ?? o.url} alt="" />
              ) : (
                <span aria-hidden="true">{i + 1}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="bar">
        <span className="model">{data.modelId}</span>
        <span className="muted">
          {many ? `Variation ${index + 1} of ${data.outputs.length}` : data.contentType}
        </span>
        <span className="spacer" />
        {/* ⭐ The host performs the download, so it lands wherever that person's downloads go and we never
            have to care whether the widget's sandbox can write a file. */}
        <button
          className="btn"
          onClick={() => {
            void app?.downloadFile({ contents: [{ uri: current.url, mimeType: '', text: '' }] })
          }}
        >
          Download
        </button>
        <button className="btn" onClick={() => void app?.openLink({ url: current.url })}>
          Open
        </button>
      </div>

      {data.prompt ? <div className="prompt muted">{data.prompt}</div> : null}
    </div>
  )
}

const style = document.createElement('style')
style.textContent = styles
document.head.appendChild(style)

const root = document.createElement('div')
document.body.appendChild(root)
createRoot(root).render(<Widget />)
