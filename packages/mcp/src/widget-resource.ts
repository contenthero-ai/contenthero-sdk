import { createHash } from 'node:crypto'
import { GENERATION_WIDGET_HTML, PACKAGE_VERSION } from './widget/generation.js'

/**
 * The generation widget as a resource: where its media comes from, what its frame may load, how a host should
 * frame it, and the name all of that is advertised under.
 *
 * ⭐ One module, because the name is DERIVED from the rest (see `GENERATION_WIDGET_URI`), and because both the
 * resource that serves the widget and the results that point at it import from here. It lives outside
 * `server.ts` because `format.ts` must not import the server (the server imports the formatter, and the cycle
 * would be real).
 */

/**
 * The one host an agent downloads a user's files from: the gateway, whose capability urls carry their token in
 * the query string, so a link needs no header and no sign-in. Public-class files come from it too for an agent
 * (the token names the public store), so a sandbox that reaches only listed hosts needs this one line.
 *
 * ⚠️ The app holds the same fact as `AGENT_MEDIA_HOST` (`lib/media/agent-media-url.ts`), derived from its gateway
 * config; `__tests__/media/agent-media-host-is-published.test.ts` there fails if they differ.
 */
export const MEDIA_HOST = 'media.contenthero.ai'

/**
 * The public CDN, which browsers still read public-class files from. The frame may paint and read it, so a link
 * stored before every reader moved to the gateway still displays; an agent is never TOLD to reach it.
 */
const PUBLIC_CDN_HOST = 'cdn.contenthero.ai'

/**
 * ⛔⛔⛔ **WITHOUT A CSP THE FRAME LOADS NOTHING, AND THE SPEC SAYS SO PLAINLY:**
 * "Empty or omitted → no network resources (secure default)."
 *
 * Measured in Claude Desktop 2026-09-19: the widget mounted, the chrome rendered, the variation strip and
 * the buttons worked, and every image was a broken icon showing its own filename. The frame was doing
 * exactly what it was told, which was to permit nothing.
 *
 * `resourceDomains` maps to `img-src`, `media-src`, `script-src`, `style-src` and `font-src`, so it is the
 * one field that decides whether an `<img>` or a `<video>` in this widget can reach our storage.
 *
 * ⚠️ These are the hosts that actually serve generated media, which is a SMALLER set than the server's SSRF
 * allowlist. That list governs what the SERVER may fetch and inline; this governs what the FRAME may load.
 * Two different questions, deliberately not one constant.
 *
 * What the frame may PAINT. Named once so the ChatGPT mirror below is derived rather than retyped.
 */
const WIDGET_RESOURCE_DOMAINS = [MEDIA_HOST, PUBLIC_CDN_HOST].map((host) => `https://${host}`)

/**
 * What the frame may READ.
 *
 * ⛔⛔ **A SEPARATE FIELD, AND OMITTING IT BLOCKS `fetch` ENTIRELY.** `resourceDomains` maps to `img-src`,
 * `media-src` and friends, which is why the pictures render. `connectDomains` maps to `connect-src`, and the
 * spec's default for an omitted list is "no network connections (secure default)". So the frame could
 * DISPLAY our media and could not READ it, which is exactly the shape needed to save a file: downloading
 * means holding the bytes.
 *
 * ⚠️ Same origins, deliberately a separate list rather than an alias of the one above. They answer
 * different questions (may the frame paint this, may the frame read this) and a future answer to one is not
 * automatically the answer to the other.
 */
const WIDGET_CONNECT_DOMAINS = [MEDIA_HOST, PUBLIC_CDN_HOST].map((host) => `https://${host}`)

/**
 * The widget resource's metadata, spread onto both the `resources/list` entry and the `resources/read` content.
 *
 * ⭐⭐ **NO HOST BORDER: THE WIDGET DRAWS ITS OWN CARD.** The spec leaves the frame to the host unless the
 * resource says otherwise ("omitted: host decides border") and recommends saying, "because hosts' defaults may
 * vary". Ours did: Claude drew its own border and background around the widget, so the card sat inside a second
 * outline with a different corner radius (Claude Desktop, 2026-10-05), while ChatGPT drew none. The card
 * (`.wrap` in `widget/src/main.tsx`) is the one frame in both, so every host is asked for none, under both names.
 */
export const WIDGET_RESOURCE_META = {
  _meta: {
    ui: {
      csp: {
        resourceDomains: WIDGET_RESOURCE_DOMAINS,
        connectDomains: WIDGET_CONNECT_DOMAINS,
      },
      prefersBorder: false,
    },
    /**
     * ⭐⭐ **THE SAME VALUES UNDER CHATGPT'S NAMES.** OpenAI's reference calls this "legacy CSP metadata" and it
     * is still what their host reads, so a widget that mounts there without it renders a frame full of broken
     * images: precisely the failure we already diagnosed in Claude when `resourceDomains` was missing.
     *
     * ⛔ **DERIVED FROM THE ARRAYS ABOVE.** What must never happen is a hand-typed copy: adding a domain for
     * Claude and forgetting it for ChatGPT is a bug that only one of you can see.
     */
    'openai/widgetCSP': {
      resource_domains: WIDGET_RESOURCE_DOMAINS,
      connect_domains: WIDGET_CONNECT_DOMAINS,
    },
    'openai/widgetPrefersBorder': false,
  },
} as const

/**
 * The generation widget's identifier.
 *
 * ⚠️ A `ui://` uri is an IDENTIFIER, not a fetchable address: the host asks this server for its contents by
 * name. Two spellings resolve to nothing and render a blank frame with no error anywhere, so it is declared
 * once and imported by both the resource that serves it and the results that point at it.
 *
 * ⭐⭐⭐ **NAMED BY ITS CONTENTS, BECAUSE A HOST CACHES THIS BY NAME AND A FIXED NAME NEVER INVALIDATES.**
 *
 * This was `ui://contenthero/generation.html`, one constant string for every build, so a host that cached the
 * first widget it loaded served it for the rest of time. Stamping the package version fixed publishes and left
 * every rebuild of one version under one name, which is exactly how a widget is developed: a fix to the frame's
 * metadata (2026-10-05, `prefersBorder`) could not reach a host that already held this version. The name now
 * carries a digest of everything a host caches under it, the HTML and the metadata above, so any change to
 * either arrives under a new name and identical bytes keep theirs. The version stays in front for a reader.
 *
 * ⚠️ It also collided ACROSS SERVERS while it was fixed: a published ContentHero and a local build connected at
 * once advertised one string for two widgets. Different bytes now mean different names.
 *
 * Every name ever minted keeps resolving (`generation-any-version` in `server.ts`), because a transcript stores
 * the uri it saw.
 */
const DIGEST = createHash('sha256')
  .update(GENERATION_WIDGET_HTML)
  .update(JSON.stringify(WIDGET_RESOURCE_META))
  .digest('hex')
  .slice(0, 12)

export const GENERATION_WIDGET_URI = `ui://contenthero/generation-${PACKAGE_VERSION}-${DIGEST}.html`
