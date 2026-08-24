/**
 * `contenthero space` - the planner's top-level container. Space > Stage > Card > Post.
 *   space list [--archived]                          the account's spaces, with card counts
 *   space get <id>                                   one space
 *   space create <name> [--cover --duplicate-from]   a new board, optionally copying another's stages
 *   space update <id> [--name --cover --no-cover]    rename or re-cover (a PATCH: omitted fields stay)
 *   space delete <id>                                delete an EMPTY space
 *
 * Favouriting and archiving a space are NOT here. They are cross-entity verbs:
 *   contenthero favorite space <id>
 *   contenthero archive space <id>
 * exactly as they work for posts, projects and brand kits.
 */

import type { Command } from 'commander'
import type { Space } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table } from '../output.js'

function clip(s: string | null | undefined, n = 40): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function registerSpace(program: Command): void {
  const space = program
    .command('space')
    .description('Manage planner spaces (each space is a board with its own stages)')

  space
    .command('list')
    .description("List the account's spaces, most recently active first")
    .option('--archived', 'include archived spaces')
    .action(async (opts: { archived?: boolean }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const spaces = await client.listSpaces({ includeArchived: opts.archived })
      emit(spaces, ctx, (rows: Space[]) =>
        table(
          ['ID', 'NAME', 'CARDS', 'FLAGS'],
          rows.map((s) => [
            s.id.slice(0, 8),
            clip(s.name),
            String(s.postCount ?? 0),
            [s.isFavorite ? 'favorite' : '', s.archivedAt ? 'archived' : ''].filter(Boolean).join(' '),
          ]),
        ),
      )
    })

  space
    .command('get')
    .description('One space, with its live card count')
    .argument('<id>', 'space id')
    .action(async (id: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const s = await client.getSpace(id)
      emit(s, ctx, (d: Space) =>
        table(
          ['FIELD', 'VALUE'],
          [
            ['id', d.id],
            ['name', d.name],
            ['cards', String(d.postCount ?? 0)],
            ['favorite', d.isFavorite ? 'yes' : 'no'],
            ['archived', d.archivedAt ?? 'no'],
            ['cover', d.coverUrl ?? ''],
            ['updated', d.updatedAt],
          ],
        ),
      )
    })

  space
    .command('create')
    .description("Create a space. --duplicate-from copies another space's STAGES, never its cards")
    .argument('<name>', 'space name')
    .option('--cover <url>', 'cover image URL for the space tile')
    .option('--duplicate-from <id>', "copy this space's stages into the new one")
    .action(
      async (name: string, opts: { cover?: string; duplicateFrom?: string }, command: Command) => {
        const { client, ctx } = makeClient(command)
        const s = await client.createSpace({
          name,
          coverUrl: opts.cover,
          duplicateFrom: opts.duplicateFrom,
        })
        emit(s, ctx, (d: Space) => `Created space ${d.name} (${d.id})`)
      },
    )

  space
    .command('update')
    .description('Rename a space or change its cover. A PATCH: a flag you omit leaves that field alone')
    .argument('<id>', 'space id')
    .option('--name <text>', 'a new name')
    .option('--cover <url>', 'a new cover image URL')
    // ⚠️ A SEPARATE FLAG, because "--cover with no value" cannot be told apart from "--cover omitted".
    // Removing a cover is a real intent and it needs its own way to be said.
    .option('--no-cover', 'remove the cover entirely (and its framing)')
    .action(
      async (
        id: string,
        opts: { name?: string; cover?: string | boolean },
        command: Command,
      ) => {
        const { client, ctx } = makeClient(command)
        // Commander sets `cover` to `false` when --no-cover is passed, and leaves it undefined when
        // neither flag appears. Those are the two different meanings the API distinguishes.
        const coverUrl = opts.cover === false ? null : typeof opts.cover === 'string' ? opts.cover : undefined
        const s = await client.updateSpace(id, { name: opts.name, coverUrl })
        emit(s, ctx, (d: Space) => `Updated space ${d.name} (${d.id})`)
      },
    )

  space
    .command('delete')
    .description('Delete an EMPTY space. The server refuses one that still holds cards, naming the count')
    .argument('<id>', 'space id')
    .action(async (id: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      await client.deleteSpace(id)
      emit({ id }, ctx, () => `Deleted space ${id}`)
    })
}
