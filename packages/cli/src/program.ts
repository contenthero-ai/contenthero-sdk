/**
 * Build the commander program: global options + the command tree.
 *
 * Global options are defined on the root and merged onto every command via
 * `optsWithGlobals()` (see context.ts). `exitOverride` makes commander throw a
 * CommanderError instead of calling process.exit, so index.ts owns all exit
 * codes in one place.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Command } from 'commander'
import { registerAuth } from './commands/auth.js'
import { registerConfig } from './commands/config.js'
import { registerAccount } from './commands/account.js'
import { registerModel } from './commands/model.js'
import { registerElement } from './commands/element.js'
import { registerGenerate } from './commands/generate.js'
import { registerUpscale } from './commands/upscale.js'
import { registerGeneration } from './commands/generation.js'
import { registerMedia } from './commands/media.js'
import { registerPost } from './commands/post.js'
import { registerPipeline } from './commands/pipeline.js'
import { registerBrandKit } from './commands/brandkit.js'
import { registerIdentity } from './commands/identity.js'
import { registerInspiration } from './commands/inspiration.js'
import { registerBrandAccount, registerConnectedAccount } from './commands/connected.js'
import { registerSchema } from './commands/schema.js'

/** Read our own version from package.json (kept in lockstep with sdk + mcp). */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('contenthero')
    .description(
      'ContentHero CLI: generate media, run the content pipeline, and read your brand and research context.',
    )
    .version(readVersion(), '-v, --version', 'print the CLI version')
    .option('--json', 'output raw JSON (the default)')
    .option('--human', 'render human-readable output instead of JSON')
    .option('--api-key <key>', 'API key (overrides env and the stored credential)')
    .option('--base-url <url>', 'API base URL (overrides env and stored config)')
    .showHelpAfterError('(add --help for usage)')
    .exitOverride()

  registerAuth(program)
  registerConfig(program)
  registerAccount(program)
  registerModel(program)
  registerElement(program)
  registerGenerate(program)
  registerUpscale(program)
  registerGeneration(program)
  registerMedia(program)
  registerPost(program)
  registerPipeline(program)
  registerBrandKit(program)
  registerIdentity(program)
  registerInspiration(program)
  registerBrandAccount(program)
  registerConnectedAccount(program)
  registerSchema(program)

  return program
}
