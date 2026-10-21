/**
 * Build the commander program: global options + the command tree.
 *
 * Global options are defined on the root and merged onto every command via
 * `optsWithGlobals()` (see context.ts). `exitOverride` makes commander throw a
 * CommanderError instead of calling process.exit, so index.ts owns all exit
 * codes in one place.
 */

import { Command } from 'commander'
import { CLI_VERSION } from './version.js'
import { registerAuth } from './commands/auth.js'
import { registerConfig } from './commands/config.js'
import { registerAccount } from './commands/account.js'
import { registerModel } from './commands/model.js'
import { registerTag } from './commands/tag.js'
import { registerKlingElement } from './commands/kling-element.js'
import { registerTemplate } from './commands/template.js'
import { registerStyleLibrary } from './commands/style-library.js'
import { registerGenerate } from './commands/generate.js'
import { registerUpscale } from './commands/upscale.js'
import { registerAudio } from './commands/audio.js'
import { registerTranscribe } from './commands/transcribe.js'
import { registerDownload } from './commands/download.js'
import { registerUpload } from './commands/upload.js'
import { registerStatus } from './commands/status.js'
import { registerMedia } from './commands/media.js'
import { registerImport } from './commands/import.js'
import { registerExport } from './commands/export.js'
import { registerFolder } from './commands/folder.js'
import { registerCard, registerPost } from './commands/card.js'
import { registerStage } from './commands/stage.js'
import { registerSpace } from './commands/space.js'
import { registerBrandKit } from './commands/brandkit.js'
import { registerIdentity } from './commands/identity.js'
import { registerContent, registerTrackedAccount } from './commands/content.js'
import { registerConnectedAccount } from './commands/connected.js'
import { registerSchema } from './commands/schema.js'
import { registerFavorites } from './commands/favorites.js'
import { registerShare } from './commands/share.js'
import { registerProject } from './commands/project.js'
import { registerView } from './commands/view.js'

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('contenthero')
    .description(
      'ContentHero CLI: generate media, run the content pipeline, and read your brand and research context.',
    )
    .version(CLI_VERSION, '-v, --version', 'print the CLI version')
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
  registerKlingElement(program)
  registerTemplate(program)
  registerStyleLibrary(program)
  registerGenerate(program)
  registerUpscale(program)
  registerAudio(program)
  registerTranscribe(program)
  registerDownload(program)
  registerUpload(program)
  registerStatus(program)
  registerMedia(program)
  registerImport(program)
  registerExport(program)
  registerFolder(program)
  registerCard(program)
  registerPost(program)
  registerTag(program)
  registerStage(program)
  registerSpace(program)
  registerBrandKit(program)
  registerIdentity(program)
  registerContent(program)
  registerTrackedAccount(program)
  registerConnectedAccount(program)
  registerSchema(program)
  registerFavorites(program)
  registerShare(program)
  registerProject(program)
  registerView(program)

  return program
}
