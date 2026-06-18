/**
 * `contenthero model` - the discovery catalog.
 *   model list [--type image|video|audio]   models available to this key
 *
 * This is the source of truth for which model ids exist; use it instead of
 * hardcoding ids when scripting generation.
 */

import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import type { ModelInfo } from '@contenthero/sdk'

const CONTENT_TYPES = ['image', 'video', 'audio'] as const
type ContentType = (typeof CONTENT_TYPES)[number]

export function registerModel(program: Command): void {
  const model = program.command('model').description('Discover the models available to your key')

  model
    .command('list')
    .description('List the models available to this key (the discovery catalog)')
    .option('--type <type>', 'filter by content type: image, video, or audio')
    .action(async (opts: { type?: string }, command: Command) => {
      if (opts.type && !CONTENT_TYPES.includes(opts.type as ContentType)) {
        throw new CliError(
          `Invalid --type "${opts.type}". Expected one of: ${CONTENT_TYPES.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      const models = await client.listModels({ contentType: opts.type as ContentType | undefined })
      emit(models, ctx, (rows: ModelInfo[]) =>
        table(
          ['MODEL', 'TYPE', 'KIND', 'NAME'],
          rows.map((m) => [m.modelId, m.contentType, m.kind, m.displayName]),
        ),
      )
    })
}
