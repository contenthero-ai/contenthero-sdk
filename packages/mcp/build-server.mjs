#!/usr/bin/env node
/**
 * Bundle the server entry so the published tarball is self-contained.
 *
 * ## ⛔⛔⛔ THE PUBLISHED PACKAGE CRASHED ON A CLEAN INSTALL, AND HAD FOR SOME TIME
 *
 * `format.ts` imports one function, `aspectLabel`, from `@contenthero-ai/brand-ui`. That package lives on
 * GitHub Packages and is RESTRICTED, so it cannot be a runtime dependency of a PUBLIC package: `mcp@0.4.9`
 * shipped that way and 404'd at install for everyone. Moving it to `devDependencies` fixed the install and
 * moved the failure to startup instead, because plain `tsc` leaves the bare import in `dist/format.js`:
 *
 *     npm install @contenthero/mcp@0.4.12   ->  added 100 packages
 *     node node_modules/@contenthero/mcp/dist/index.js
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@contenthero-ai/brand-ui'
 *
 * Measured 2026-09-21 in an empty directory with no `.npmrc`, which is the only test that can see this: our
 * own checkout resolves the package from the monorepo, and the hosted MCP resolves it from the app's
 * dependencies, so every local signal said the package was fine.
 *
 * ⛔ **MOVING IT BETWEEN `dependencies` AND `devDependencies` CANNOT FIX IT.** One 404s at install, the
 * other fails at import. The dependency has to stop being a dependency, which means the bytes have to be
 * IN the tarball.
 *
 * ⭐ So the entry is bundled, and every REAL runtime dependency stays external: they are public, declared,
 * and npm installs them. Only what a consumer cannot install gets inlined. The widget half of this package
 * has always been built this way; the server half was the part nobody had checked.
 *
 * ⚠️ TYPES STILL COME FROM `tsc --emitDeclarationOnly`, so the published types are the real ones rather
 * than something esbuild inferred.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))

/**
 * ⭐ DERIVED FROM `dependencies`, never listed by hand. A package declared as a dependency is one npm will
 * install, so bundling it would ship a second copy that cannot be deduped or patched. A hand-written list
 * would drift from the manifest the first time a dependency is added, and the symptom would be a silently
 * fatter tarball rather than an error.
 */
const external = Object.keys(pkg.dependencies ?? {})

await build({
  entryPoints: [join(HERE, 'src', 'index.ts')],
  outfile: join(HERE, 'dist', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  /**
   * ⚠️ NO SHEBANG BANNER HERE. esbuild PRESERVES the entry file's own shebang, so adding one produced two,
   * the second on line 2 where it is a syntax error and the binary would not start at all. Caught by
   * installing the tarball into an empty directory and running it, which is the only check that sees the
   * published artifact rather than the source it came from.
   */
  logLevel: 'warning',
})

const bytes = readFileSync(join(HERE, 'dist', 'index.js')).length
console.log(`server: ./dist/index.js (${Math.round(bytes / 1024)}KB, externals: ${external.join(', ')})`)
