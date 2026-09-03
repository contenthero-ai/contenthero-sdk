/**
 * `contenthero stage` - the columns of one space's board. Space > Stage > Card > Post.
 *   stage list   list the stages, in order
 *
 * Stages belong to a SPACE, not to the account, so two spaces can each have a
 * stage called `Published`. Resolve one here before placing a card with
 * `card create --stage`. The id is the most stable handle.
 */

import type { Command } from 'commander'
import type { Stage } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table } from '../output.js'

export function registerStage(program: Command): void {
  const stage = program.command('stage').description("Inspect a space's stages (the board's columns)")

  stage
    .command('list')
    .description("List a space's stages, in order (defaults to the default space)")
    .option('--space <id>', "which space's stages (from `contenthero space list`); default space if omitted")
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const stages = await client.listStages({ spaceId: opts.space as string | undefined })
      emit(stages, ctx, (rows: Stage[]) =>
        table(
          ['ORDER', 'NAME', 'SLUG', 'DEFAULT', 'ID'],
          rows.map((s) => [s.sortOrder, s.name, s.slug ?? '', s.isDefault ? 'yes' : '', s.id]),
        ),
      )
    })
}
