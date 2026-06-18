/**
 * `contenthero pipeline` - the account's pipeline stages.
 *   pipeline stages   list the stages, in order
 *
 * Stages are per-account customizable, so resolve one here before placing a post
 * with `post create --stage`. The id is the most stable handle.
 */

import type { Command } from 'commander'
import type { PipelineStage } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table } from '../output.js'

export function registerPipeline(program: Command): void {
  const pipeline = program.command('pipeline').description('Inspect the content pipeline stages')

  pipeline
    .command('stages')
    .description('List the account\'s pipeline stages, in order')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const stages = await client.listPipelineStages()
      emit(stages, ctx, (rows: PipelineStage[]) =>
        table(
          ['ORDER', 'NAME', 'SLUG', 'DEFAULT', 'ID'],
          rows.map((s) => [s.sortOrder, s.name, s.slug ?? '', s.isDefault ? 'yes' : '', s.id]),
        ),
      )
    })
}
