/**
 * `contenthero folder` - organize the library (Unified Content Library, Phase D). No bytes move.
 *   folder list                                   your folders + the built-in derived folders
 *   folder get <id>                               a folder's contents (id or derived key)
 *   folder create <name> [--smart --parent]       create a manual (or smart) folder
 *   folder delete <id>                            delete a folder (and its subtree)
 *   folder update <folderId> --add <ref> --remove <ref>         file or unfile items (a media id, project:<id>, card:<id>)
 */

import type { Command } from 'commander'
import type { FolderItemRef } from '@contenthero/sdk'
import type { Folder, FolderContents, FolderListResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table, displayId, withMore, clip } from '../output.js'
import { collect, withPageFlags } from '../args.js'
import { CliError, EXIT } from '../errors.js'


export function registerFolder(program: Command): void {
  const folder = program.command('folder').description('Organize the library into manual and smart folders')

  withPageFlags(folder.command('list').description('List your folders plus the built-in derived folders'))
    .action(async (opts: { limit?: number; cursor?: string }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const data = await client.listFolders({ limit: opts.limit, cursor: opts.cursor })
      emit(data, ctx, (d: FolderListResult) =>
        withMore(
          table(
            ['ID', 'NAME', 'TYPE', 'PARENT'],
            [
              ...d.folders.map((f) => [displayId(f), f.name, f.type, f.parentId ? displayId(d.folders.find((x) => x.id === f.parentId) ?? { id: f.parentId }) : '']),
              ...d.derived.map((x) => [x.key, x.name, 'derived', '']),
            ],
          ),
          d.nextCursor,
        ),
      )
    })

  withPageFlags(
    folder
      .command('get')
      .description("A folder's contents (a folder id or a derived key: recents, favorites, edits, canvas, cards)")
      .argument('<id>', 'folder id or derived key'),
  )
    .option('--small-copies', 'give each image its small copy, where the library keeps one: for drawing images small, never for downloading, delivering or showing large')
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const page = await client.getFolder(id, {
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
        smallCopies: opts.smallCopies ? true : undefined,
      })
      emit(page, ctx, (p: FolderContents) =>
        withMore(
          table(
            ['KIND', 'REF', 'DETAIL'],
            p.items.map((i) =>
              i.type === 'media'
                ? [i.kind ?? 'media', i.mediaId ?? '', clip(i.summary, 50)]
                : [i.type, displayId(i), clip(i.name, 50)],
            ),
          ),
          p.nextCursor,
        ),
      )
    })

  folder
    .command('create')
    .description('Create a folder (manual by default; --smart for a saved query with --text)')
    .argument('<name>', 'folder name')
    .option('--smart', 'create a smart (saved-query) folder')
    .option('--text <text>', 'smart-folder semantic query text')
    .option('--parent <id>', 'nest under this parent folder id')
    .action(async (name: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const f = await client.createFolder({
        name,
        type: opts.smart ? 'smart' : 'manual',
        query: opts.smart ? { text: opts.text as string | undefined } : undefined,
        parentId: (opts.parent as string | undefined) ?? null,
      })
      emit(f, ctx, (x: Folder) => `Created ${x.type} folder "${x.name}" (${x.id}).`)
    })

  folder
    .command('delete')
    .description('Delete a folder and its subtree (pointers only; assets are never deleted)')
    .argument('<id>', 'folder id')
    .action(async (id: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      await client.deleteFolder(id)
      emit({ ok: true }, ctx, () => `Deleted folder ${id}.`)
    })

  folder
    .command('update')
    .description('Rename, move, re-query a folder, and file or unfile items (requires assets:write)')
    .argument('<id>', 'the folder id')
    .option('--name <text>', 'a new name')
    .option('--parent <id>', 'move under this folder id, or "none" for the top level')
    .option('--text <text>', "a smart folder's new semantic query text (the same query `folder create --smart --text` sets)")
    .option('--also <id>', 'apply to this folder too; repeatable. Name and query still need exactly one', collect)
    .option('--add <ref>', 'file an item: a media id (a1B2c3D4-2), project:<id> or card:<id>. Repeatable', collect)
    .option('--remove <ref>', 'unfile an item: a media id, project:<id> or card:<id>. Repeatable', collect)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const patch = {
        name: opts.name as string | undefined,
        parentId:
          opts.parent === undefined ? undefined : NONE.includes(String(opts.parent).toLowerCase()) ? null : (opts.parent as string),
        query: opts.text === undefined ? undefined : { text: opts.text as string },
        addItems: parseRefs(opts.add as string[] | undefined),
        removeItems: parseRefs(opts.remove as string[] | undefined),
      }
      const also = (opts.also as string[] | undefined) ?? []
      const targets = [id, ...also]
      const folders = targets.length > 1 ? await client.updateFolders(targets, patch) : [await client.updateFolder(id, patch)]
      emit(folders, ctx, (list: Folder[]) => {
        const filed = patch.addItems?.length ?? 0
        const unfiled = patch.removeItems?.length ?? 0
        const what = [filed ? `filed ${filed}` : null, unfiled ? `unfiled ${unfiled}` : null].filter(Boolean).join(', ')
        return `Updated ${list.length} folder(s)${what ? `: ${what} item(s)` : '.'}`
      })
    })
}

/** "none" clears a parent, which is how you move a folder to the top level. */
const NONE = ['none', 'null', 'root', 'clear']

/**
 * An item named the way it is named everywhere else: a media id (`a1B2c3D4`, or `a1B2c3D4-2` for one output of
 * several, as `media list`, `media search` and `folder get` print it), or `project:<id>` / `card:<id>`.
 *
 * A compact form because these are repeatable and bulk is the point. It took `sourceTable:sourceRecordId[:variant]`,
 * a stored key with a 0-based slot that no read printed, until 7.44.
 */
function parseRefs(refs: string[] | undefined): FolderItemRef[] | undefined {
  if (!refs?.length) return undefined
  return refs.map((raw) => {
    const ref = raw.trim()
    if (!ref) throw new CliError('Empty item ref. Expected a media id, project:<id> or card:<id>.', EXIT.USAGE)
    if (ref.startsWith('project:')) return { projectId: ref.slice('project:'.length) }
    if (ref.startsWith('card:')) return { cardId: ref.slice('card:'.length) }
    return { mediaId: ref }
  })
}
