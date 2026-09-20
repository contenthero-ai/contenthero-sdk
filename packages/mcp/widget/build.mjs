#!/usr/bin/env node
/**
 * Bundle the generation widget into ONE self-contained HTML file.
 *
 * ## Why one file is a hard requirement
 *
 * ⚠️⚠️ An MCP App is delivered as the TEXT of a `ui://` resource. Everything the widget needs must already
 * be inside that string: there is no server behind `ui://` for a second request to reach. A build that emits
 * `index.html` plus `assets/main.js` renders a BLANK FRAME in every host, and nothing reports why.
 *
 * ⛔ It must also not fetch from a CDN at runtime. Hosts sandbox these frames, so a widget that works only
 * where a CDN is reachable is one that fails silently in exactly the environments we cannot observe.
 *
 * ## Why esbuild and not a bundler with an HTML entry
 *
 * ⭐ The job is "one tsx file into one js string", and esbuild does precisely that with no plugin and no
 * HTML-entry resolution to go wrong. The first attempt used Vite plus `vite-plugin-singlefile`, which
 * advertises Vite 8 support and still failed with `UNRESOLVED_ENTRY` on an entry that was present on disk
 * and named by absolute path. Two indirections (plugin, HTML entry) for a job with no assets is the
 * shortcut carrying the burden of proof, and it did not carry it.
 *
 * React is bundled IN, not externalized: the frame has no import map and no node_modules.
 */
import { build } from 'esbuild'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * ## ⭐⭐⭐ THE WIDGET IS EMITTED AS A TYPESCRIPT MODULE, NOT AS A FILE TO BE READ AT RUNTIME
 *
 * It used to be written to `dist/widget/generation.html` and loaded with `readFileSync` against
 * `import.meta.url`. That works from disk and fails everywhere a bundler is involved. Measured on Vercel:
 * Next.js inlines this package into the route's bundle, so `import.meta.url` resolves to the bundled file
 * and the HTML was never traced at all (`files traced from @contenthero/mcp: 0`). The hosted MCP therefore
 * advertised a `ui://` resource it could not read, and nothing rendered, with no error a person would see.
 *
 * ⭐ An import is the one thing every bundler, tracer and runtime already understands. Emitting the HTML as
 * a module makes the widget part of the module graph, so no consumer needs tracing configuration, an
 * externals list, or any knowledge that a file exists.
 *
 * ⚠️ **GENERATED. GITIGNORED. NEVER EDITED.** `src/widget/generation.ts` is written by this script before
 * `tsc` runs, so the compiled `dist/widget/generation.js` is always the bundle this build produced.
 *
 * ⛔ **AND IT IS THE ONLY REPRESENTATION.** An `.html` sibling with the same bytes would be a second answer
 * to "what does the server serve", and the two would drift the first time one was regenerated alone.
 */
const MODULE_OUT = join(HERE, '..', 'src', 'widget', 'generation.ts')
const { ENTRY } = await import('./guard.mjs')

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  jsx: 'automatic',
  minify: true,
  // Written to memory rather than disk: the only artifact that matters is the HTML below.
  write: false,
  // React reads this and ships its production build. Without it the dev build warns into a host console
  // nobody is watching, and is several times larger for no benefit.
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

const js = result.outputFiles?.[0]?.text
if (!js) throw new Error('esbuild produced no output')

/**
 * ⚠️ `</script>` INSIDE THE BUNDLE WOULD END THE TAG EARLY and break the document, which is the classic way
 * inlined JS corrupts its own host page. Splitting the sequence is inert to the JS parser and invisible to
 * the HTML one.
 */
const safe = js.replace(/<\/script>/gi, '<\\/script>')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ContentHero</title>
</head>
<body>
<script type="module">${safe}</script>
</body>
</html>
`

mkdirSync(dirname(MODULE_OUT), { recursive: true })
/**
 * ⚠️ `JSON.stringify` RATHER THAN A TEMPLATE LITERAL. The document contains a `<script>` tag and a minified
 * bundle, so any backtick or `${` inside it would terminate or interpolate a template. JSON escaping cannot
 * be defeated by the content.
 */
/**
 * ⚠️ THE PACKAGE VERSION RIDES ALONG, FOR THE SAME REASON.
 *
 * `readVersion()` used to parse `../package.json` relative to `import.meta.url` inside a try/catch that
 * returned `'0.0.0'`. Under a bundler that path does not exist, so the hosted server reported version
 * 0.0.0 and the catch made it silent. It is a build-time fact, so it is baked in at build time like the
 * document beside it, and there is no longer any `import.meta.url` path resolution left in this package.
 */
const version = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version

writeFileSync(
  MODULE_OUT,
  '/* GENERATED BY widget/build.mjs. Do not edit; do not commit. */\n' +
    `export const GENERATION_WIDGET_HTML = ${JSON.stringify(html)}\n` +
    `export const PACKAGE_VERSION = ${JSON.stringify(version)}\n`,
)

const kb = (html.length / 1024).toFixed(0)
console.log(`widget: ${MODULE_OUT.replace(join(HERE, '..'), '.')} (${kb}KB, self-contained)`)
/**
 * ⚠️ THE TWO WAYS THIS BUNDLE CAN BE SILENTLY BROKEN, BOTH CAUGHT HERE RATHER THAN IN A HOST.
 *
 * A widget that lost its script renders an empty frame with no error anywhere, and a CSS template closed
 * early by a stray backtick takes the whole module with it. The second one actually happened: a comment
 * inside the styles template contained `min-height: 0` in backticks, which ENDED the literal.
 */
if (!/createRoot|\.render\(/.test(js)) {
  throw new Error('bundle does not appear to mount a React root')
}
if (!/\.wrap\s*\{/.test(js) || !/\.grid\s*\{/.test(js)) {
  throw new Error('the stylesheet is missing from the bundle: a stray backtick probably closed the template early')
}
