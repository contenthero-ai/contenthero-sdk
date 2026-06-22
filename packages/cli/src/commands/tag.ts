/**
 * `contenthero tag` - the account's organizational tag library.
 *   tag list                    the account's tags
 *   tag create <name>           create a tag (name is lowercased)
 *   tag update <id> <name>      rename a tag (keeps its post assignments)
 *   tag remove <id>             delete a tag (removes it from every post)
 *
 * Apply tags to a post with `post create --tags` / `post update --tags`. Detaching
 * a tag from ONE post is `post update --tags` without it; `tag remove` destroys the
 * tag account-wide.
 */

import type { Command } from 'commander'
import type { Tag } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'

export function registerTag(program: Command): void {
  const tag = program.command('tag').description("Manage the account's tags")

  tag
    .command('list')
    .description("List the account's tags")
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const tags = await client.listTags()
      emit(tags, ctx, (rows: Tag[]) =>
        table(
          ['NAME', 'ID'],
          rows.map((t) => [t.name, t.id]),
        ),
      )
    })

  tag
    .command('create')
    .description('Create a tag (the name is lowercased) (requires pipeline:write)')
    .argument('<name>', 'the tag name')
    .action(async (name: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const t = await client.createTag(name)
      emit(t, ctx, (r: Tag) => keyValues([['Tag', r.name], ['Id', r.id]]))
    })

  tag
    .command('update')
    .description('Rename a tag, keeping its post assignments (requires pipeline:write)')
    .argument('<id>', 'the tag id (from `tag list`)')
    .argument('<name>', 'the new tag name')
    .action(async (id: string, name: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const t = await client.updateTag(id, name)
      emit(t, ctx, (r: Tag) => keyValues([['Tag', r.name], ['Id', r.id]]))
    })

  tag
    .command('remove')
    .description('Delete a tag from the account, removing it from every post (requires pipeline:write)')
    .argument('<id>', 'the tag id (from `tag list`)')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const r = await client.deleteTag(id)
      emit(r, ctx, () => `Tag deleted (id ${r.id}). It was removed from all posts.`)
    })
}
