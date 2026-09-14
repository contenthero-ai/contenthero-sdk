/**
 * `contenthero stage` - the columns of one space's board. Space > Stage > Card > Post.
 *   stage list                        list the stages, in order
 *   stage create <name>               a new column, optionally placed
 *   stage update <id> --space <id>    rename, recolor or move one
 *   stage delete <id> --space <id>    delete one, moving its cards
 *
 * Stages belong to a SPACE, not to the account, so two spaces can each have a
 * stage called `Published`. Resolve one here before placing a card with
 * `card create --stage`. The id is the most stable handle.
 *
 * ⚠️ `--space` IS REQUIRED ON update AND delete, AND OPTIONAL ON create. A stage
 * id alone does not tell the server which board you mean, and defaulting it
 * picks the account's OLDEST space, which silently changed nothing on every
 * other board. Creating may default because "the default board" is a real
 * answer; changing an existing column may not, because its id already decided.
 */

import type { Command } from 'commander'
import type { Stage, StageListResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table } from '../output.js'

/** One stage, printed the same way by create and update. */
function line(s: Stage): string {
  return `${s.name} (${s.id})${s.slug ? ` slug ${s.slug}` : ''} at ${s.sortOrder}`
}

export function registerStage(program: Command): void {
  const stage = program.command('stage').description("Manage a space's stages (the board's columns)")

  stage
    .command('list')
    .description("List a space's stages, in order (defaults to the default space)")
    .option('--space <id>', "which space's stages (from `contenthero space list`); default space if omitted")
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const result = await client.listStages({ spaceId: opts.space as string | undefined })
      emit(result, ctx, (r: StageListResult) => {
        // ⭐ NAME THE SCOPE, matching `card list` and the MCP. Stages are per-space and this falls back to
        // the default space, so an unfamiliar set of columns should say whose it is rather than look wrong.
        const where = r.space ? ` in ${r.space.name}` : ''
        if (!r.stages.length) return `No stages found${where}.`
        const t = table(
          ['ORDER', 'NAME', 'SLUG', 'ID'],
          r.stages.map((s) => [s.sortOrder, s.name, s.slug ?? '', s.id]),
        )
        return `${t}\n\n${r.stages.length} stage(s)${where}`
      })
    })

  stage
    .command('create')
    .description('Create a column. The slug is derived from the name and is not settable')
    .argument('<name>', 'column name, for example "In Review"')
    .option('--space <id>', "which board (from `contenthero space list`); default space if omitted")
    .option('--color <hex>', 'a hex color such as "#3B82F6"')
    .option('--after <id>', 'place it immediately after this stage')
    .option('--before <id>', 'place it immediately before this stage')
    .action(
      async (
        name: string,
        opts: { space?: string; color?: string; after?: string; before?: string },
        command: Command,
      ) => {
        const { client, ctx } = makeClient(command)
        const s = await client.createStage({
          name,
          spaceId: opts.space,
          color: opts.color,
          afterId: opts.after,
          beforeId: opts.before,
        })
        emit(s, ctx, (d: Stage) => `Created stage ${line(d)}`)
      },
    )

  stage
    .command('update')
    .description('Rename, recolor or move a column. A PATCH: a flag you omit leaves that field alone')
    .argument('<id>', 'stage id')
    .requiredOption('--space <id>', 'the board this stage is on (required: an id alone does not name a board)')
    .option('--name <text>', 'a new name; the slug follows it')
    .option('--color <hex>', 'a new hex color')
    .option('--after <id>', 'move it immediately after this stage')
    .option('--before <id>', 'move it immediately before this stage')
    /*
      ⚠️ SEPARATE FLAGS FOR THE EDGES, for the reason `space update --no-cover` exists: "--after with no
      value" cannot be told apart from "--after omitted", and the two mean opposite things. Omitting
      both anchors means "do not move it"; the far edges are a real intent and need their own spelling.
    */
    .option('--to-start', 'move it to the far left of the board')
    .option('--to-end', 'move it to the far right of the board')
    .action(
      async (
        id: string,
        opts: {
          space: string
          name?: string
          color?: string
          after?: string
          before?: string
          toStart?: boolean
          toEnd?: boolean
        },
        command: Command,
      ) => {
        const { client, ctx } = makeClient(command)
        // `null` is the API's word for an edge; `undefined` is "leave it where it is".
        const afterId = opts.toStart ? null : opts.after
        const beforeId = opts.toEnd ? null : opts.before
        const { stage: s, respaced } = await client.updateStage(id, {
          spaceId: opts.space,
          name: opts.name,
          color: opts.color,
          afterId,
          beforeId,
        })
        emit({ stage: s, respaced }, ctx, (d: { stage: Stage; respaced: boolean }) =>
          [
            `Updated stage ${line(d.stage)}`,
            // The one answer the caller cannot derive: a move with no room renumbers the whole board.
            d.respaced ? 'The whole board was renumbered; re-run `stage list` for current positions.' : null,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      },
    )

  stage
    .command('delete')
    .description('Delete a column and move its cards. The server refuses a non-empty column with no --target')
    .argument('<id>', 'stage id')
    .requiredOption('--space <id>', 'the board this stage is on')
    .option('--target <id>', "where this column's cards should go (required unless it is empty)")
    .action(
      async (id: string, opts: { space: string; target?: string }, command: Command) => {
        const { client, ctx } = makeClient(command)
        const result = await client.deleteStage(id, {
          spaceId: opts.space,
          targetStageId: opts.target ?? null,
        })
        emit(result, ctx, (d: { id: string; movedCards: number; stages: Stage[] }) =>
          [
            `Deleted stage ${d.id}` +
              (d.movedCards > 0
                ? `, moving ${d.movedCards} ${d.movedCards === 1 ? 'card' : 'cards'}`
                : ' (it held no cards)'),
            table(
              ['ORDER', 'NAME', 'ID'],
              d.stages.map((s) => [s.sortOrder, s.name, s.id]),
            ),
          ].join('\n'),
        )
      },
    )
}
