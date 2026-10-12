import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * This CLI's installed version, read once from its package.json (kept in lockstep with sdk + mcp): `--version` prints
 * it and every request names it (`X-ContentHero-Client`), so the server knows which installed CLIs are behind it.
 */
export const CLI_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
