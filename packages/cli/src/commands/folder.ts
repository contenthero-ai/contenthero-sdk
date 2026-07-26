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
import { toInt } from '../args.js'

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
    .command('add')
    .description('File an item into a manual folder')
    .argument('<folderId>', 'destination folder id')
    .argument('<sourceTable>', 'item source table')
    .argument('<sourceRecordId>', 'item source record id')
    .option('--variant <n>', 'variation index (default 0)', toInt)
    .action(async (folderId: string, sourceTable: string, sourceRecordId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      await client.addToFolder(folderId, { sourceTable, sourceRecordId, variant: opts.variant as number | undefined })
      emit({ ok: true }, ctx, () => 'Filed into the folder.')
    })

  folder
    .command('remove')
    .description('Remove an item from a manual folder')
    .argument('<folderId>', 'folder id')
    .argument('<sourceTable>', 'item source table')
    .argument('<sourceRecordId>', 'item source record id')
    .option('--variant <n>', 'variation index (default 0)', toInt)
    .action(async (folderId: string, sourceTable: string, sourceRecordId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      await client.removeFromFolder(folderId, { sourceTable, sourceRecordId, variant: opts.variant as number | undefined })
      emit({ ok: true }, ctx, () => 'Removed from the folder.')
    })
}
