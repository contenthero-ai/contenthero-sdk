#!/usr/bin/env node
/**
 * Does the PUBLISHED artifact actually run?
 *
 * ## ⛔⛔⛔ THE ONLY CHECK THAT CAN SEE THIS CLASS OF DEFECT
 *
 * `@contenthero/mcp@0.4.12` shipped and crashed on startup for anyone who installed it, for weeks. Every
 * local signal said it was fine, because every local signal resolves differently from a consumer:
 *
 *   - our checkout finds `@contenthero-ai/brand-ui` hoisted in the monorepo
 *   - the hosted MCP finds it in the app's own dependencies
 *   - `npm pack` succeeds regardless, and even succeeds on a FAILED build, packing a stale dist
 *
 * A consumer has none of that. `npm install` then `node dist/index.js` in an EMPTY directory with no
 * `.npmrc` is the only thing that asks the question a consumer asks.
 *
 * ⭐ It has already caught two different failures on the same line of work: a private dependency that
 * could not be installed, and a duplicate shebang from bundling that made the binary unparseable.
 *
 * Usage: npm run verify:tarball -w @contenthero/mcp
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts })

for (const f of readdirSync(PKG)) if (f.endsWith('.tgz')) rmSync(join(PKG, f))
run('npm', ['pack'], { cwd: PKG, stdio: 'pipe' })
const tgz = readdirSync(PKG).find((f) => f.endsWith('.tgz'))
if (!tgz) { console.error('verify:tarball: npm pack produced nothing'); process.exit(1) }

const dir = mkdtempSync(join(tmpdir(), 'ch-tarball-'))
let failed = false
try {
  writeFileSync(join(dir, 'package.json'), '{"name":"t","private":true,"type":"module"}')
  /**
   * ⚠️ `HOME` IS REDIRECTED, which is the whole point. Our own `~/.npmrc` maps the private scope, so an
   * install that reads it proves nothing: the package would resolve here and 404 for everybody else.
   */
  run('npm', ['install', join(PKG, tgz), '--no-audit', '--no-fund'], {
    cwd: dir,
    env: { ...process.env, HOME: dir },
    stdio: 'pipe',
  })

  const entry = join(dir, 'node_modules', '@contenthero', 'mcp', 'dist', 'index.js')
  // Speak enough MCP to prove it STARTED. A module that cannot resolve an import dies before this answers.
  const out = run('node', ['-e', `
    const { spawn } = require('node:child_process')
    const p = spawn(process.execPath, [${JSON.stringify(entry)}], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\\n')
    setTimeout(() => { p.kill(); process.stdout.write(out) }, 4000)
  `], { stdio: 'pipe' })

  if (/ERR_MODULE_NOT_FOUND|Cannot find package|SyntaxError/.test(out)) {
    console.error(`verify:tarball: the published artifact does not run.\n${out.slice(0, 600)}`)
    failed = true
  } else if (!/"serverInfo"/.test(out)) {
    console.error(`verify:tarball: the server never answered initialize.\n${out.slice(0, 600)}`)
    failed = true
  } else {
    console.log(`verify:tarball: ${tgz} installs clean with no .npmrc and answers initialize.`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
  for (const f of readdirSync(PKG)) if (f.endsWith('.tgz')) rmSync(join(PKG, f))
}
process.exit(failed ? 1 : 0)
