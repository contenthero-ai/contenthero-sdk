/**
 * `contenthero folder` - organize the library (Unified Content Library, Phase D). No bytes move.
 *   folder list                                   your folders + the built-in derived folders
 *   folder get <id>                               a folder's contents (id or derived key)
 *   folder create <name> [--smart --parent]       create a manual (or smart) folder
 *   folder delete <id>                            delete a folder (and its subtree)
 *   folder add <folderId> <table> <recordId> [--variant]      file an item
 *   folder remove <folderId> <table> <recordId> [--variant]   unfile an item
 */

import type { Command } from 'commander'
import type { Folder, DerivedFolder, FolderItem } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table } from '../output.js'
import { collect } from '../args.js'
import { CliError, EXIT } from '../errors.js'

function clip(s: string | null | undefined, n = 50): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function registerFolder(program: Command): void {
  const folder = program.command('folder').description('Organize the library into manual and smart folders')

  folder
    .command('list')
    .description('List your folders plus the built-in derived folders')
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const data = await client.listFolders()
      emit(data, ctx, (d: { folders: Folder[]; derived: DerivedFolder[] }) =>
        table(
          ['ID', 'NAME', 'TYPE', 'PARENT'],
          [
            ...d.folders.map((f) => [f.id.slice(0, 8), f.name, f.type, f.parentId ? f.parentId.slice(0, 8) : '']),
            ...d.derived.map((x) => [x.key, x.name, 'derived', '']),
          ],
        ),
      )
    })

  folder
    .command('get')
    .description("A folder's contents (a folder id or a derived key: recents, favorites, edits, canvas, posts)")
    .argument('<id>', 'folder id or derived key')
    .action(async (id: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const { items } = await client.getFolder(id)
      emit(items, ctx, (rows: FolderItem[]) =>
        table(
          ['KIND', 'REF', 'DETAIL'],
          rows.map((i) =>
            i.type === 'media'
              ? [i.kind ?? 'media', `${i.sourceTable}/${i.sourceRecordId.slice(0, 8)} v${i.variant}`, clip(i.summary)]
              : [i.type, i.id.slice(0, 8), clip(i.name)],
          ),
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
    .option('--also <id>', 'apply to this folder too; repeatable. Name and query still need exactly one', collect)
    .option('--add <ref>', 'file an item: sourceTable:sourceRecordId[:variant]. Repeatable', collect)
    .option('--remove <ref>', 'unfile an item: sourceTable:sourceRecordId[:variant]. Repeatable', collect)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const patch = {
        name: opts.name as string | undefined,
        parentId:
          opts.parent === undefined ? undefined : NONE.includes(String(opts.parent).toLowerCase()) ? null : (opts.parent as string),
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
 * `sourceTable:sourceRecordId[:variant]`, which is the universal identity `search_media` returns.
 *
 * A compact form because these are repeatable and bulk is the point: three positional arguments per item
 * would mean one invocation per item, which is exactly what the two tools this replaced forced.
 */
function parseRefs(refs: string[] | undefined) {
  if (!refs?.length) return undefined
  return refs.map((raw) => {
    const [sourceTable, sourceRecordId, variant] = raw.split(':')
    if (!sourceTable || !sourceRecordId) {
      throw new CliError(`Invalid item ref "${raw}". Expected sourceTable:sourceRecordId[:variant].`, EXIT.USAGE)
    }
    return { sourceTable, sourceRecordId, ...(variant ? { variant: Number(variant) } : {}) }
  })
}
