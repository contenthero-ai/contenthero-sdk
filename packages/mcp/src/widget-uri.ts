/**
 * The generation widget's identifier, in a module of its own.
 *
 * ⚠️ A `ui://` uri is an IDENTIFIER, not a fetchable address: the host asks this server for its contents by
 * name. Two spellings resolve to nothing and render a blank frame with no error anywhere, so it is declared
 * once and imported by both the resource that serves it and the results that point at it.
 *
 * ⭐ It lives here rather than in `server.ts` because `format.ts` must not import the server (the server
 * imports the formatter, and the cycle would be real).
 */
export const GENERATION_WIDGET_URI = 'ui://contenthero/generation.html'
