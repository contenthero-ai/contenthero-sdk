import { PACKAGE_VERSION } from './widget/generation.js'

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
/**
 * ⭐⭐⭐ **VERSION-STAMPED, BECAUSE A HOST CACHES THIS BY NAME AND A FIXED NAME NEVER INVALIDATES.**
 *
 * This was `ui://contenthero/generation.html`, one constant string for every build this server has ever
 * shipped. A host that caches a resource by its uri, which is the obvious thing to do for an identifier, then
 * serves the FIRST widget it ever loaded for the rest of time, and every fix after that is invisible no
 * matter how many times the package is published.
 *
 * ⚠️ It also collided ACROSS SERVERS. A published ContentHero and a local build connected at once both
 * advertised this exact string, so one cache entry stood for two different widgets and which one won was not
 * something either server decided. That is the configuration a widget is actually developed in.
 *
 * ⭐ Deriving it from the package version costs nothing and makes every publish cache-safe by construction:
 * new bytes always arrive under a new name. Both the resource registration and the `_meta` bindings import
 * this one constant, so they cannot disagree about which name was advertised.
 *
 * ⚠️ WHAT THIS DOES NOT FIX: two builds of the SAME version still share a name, which is the local
 * development case. Bump the version, or accept that a same-version rebuild may be served from cache.
 */
export const GENERATION_WIDGET_URI = `ui://contenthero/generation-${PACKAGE_VERSION}.html`
