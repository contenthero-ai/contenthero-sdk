/**
 * `contenthero tag` - the account's organizational tag library.
 *   tag list                    the account's tags
 *   tag create <name>           create a tag (name is lowercased)
 *   tag update <id> <name>      rename a tag (keeps its post assignments)
 *   tag delete <id>             delete a tag (removes it from every post)
 *
 * Apply tags to a post with `post create --tags` / `post update --tags`. Detaching
 * a tag from ONE post is `post update --tags` without it; `tag delete` destroys the
 * tag account-wide.
 */

import type { Command } from 'commander'
import type { Tag, TagListResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table, linkRow, displayId, withMore } from '../output.js'
import { withPageFlags } from '../args.js'

export function registerTag(program: Command): void {
  const tag = program.command('tag').description("Manage the account's tags")

  withPageFlags(tag.command('list').description("List the account's tags"))
    .action(async (opts: { limit?: number; cursor?: string }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const page = await client.listTags({ limit: opts.limit, cursor: opts.cursor })
      emit(page, ctx, (p: TagListResult) =>
        withMore(
          table(
            ['NAME', 'ID'],
            p.tags.map((t) => [t.name, t.id]),
          ),
          p.nextCursor,
        ),
      )
    })

  tag
    .command('create')
    .description('Create a tag (the name is lowercased) (requires planner:write)')
    .argument('<name>', 'the tag name')
    .action(async (name: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const t = await client.createTag(name)
      emit(t, ctx, (r: Tag) => keyValues([['Tag', r.name], ['Id', displayId(r)], ...linkRow(r)]))
    })

  tag
    .command('update')
    .description('Rename a tag, keeping its post assignments (requires planner:write)')
    .argument('<id>', 'the tag id (from `tag list`)')
    .argument('<name>', 'the new tag name')
    .action(async (id: string, name: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const t = await client.updateTag(id, name)
      emit(t, ctx, (r: Tag) => keyValues([['Tag', r.name], ['Id', displayId(r)], ...linkRow(r)]))
    })

  tag
    .command('delete')
    .description('Delete a tag from the account, removing it from every post (requires planner:write)')
    .argument('<id>', 'the tag id (from `tag list`)')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const r = await client.deleteTag(id)
      emit(r, ctx, () => `Tag deleted (id ${r.id}). It was removed from all posts.`)
    })
}
