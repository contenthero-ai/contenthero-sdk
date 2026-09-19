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
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', 'dist', 'widget')

const result = await build({
  entryPoints: [join(HERE, 'src', 'main.tsx')],
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

mkdirSync(OUT_DIR, { recursive: true })
const out = join(OUT_DIR, 'generation.html')
writeFileSync(out, html)

const kb = (html.length / 1024).toFixed(0)
console.log(`widget: ${out.replace(join(HERE, '..'), '.')} (${kb}KB, self-contained)`)
// A widget that silently lost its script is the failure this catches at build time rather than in a host.
if (!html.includes('createRoot') && !/createRoot|\.render\(/.test(js)) {
  throw new Error('bundle does not appear to mount a React root')
}
