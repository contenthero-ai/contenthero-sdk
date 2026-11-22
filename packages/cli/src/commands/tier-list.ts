/**
 * `contenthero tier-list` - boards of library media ranked into tiers (a staff-only feature while it is built).
 *   tier-list list [--archived --search]       the account's tier lists
 *   tier-list get <id> [--tab-id]              one, with its tiers, tabs, one tab's items and the standings
 *   tier-list create <name> [--tiers --tabs]   create one
 *   tier-list update <id> [...]                change the board, its tiers, tabs and items, or arrange one tab
 *   tier-list export <id> [--tabs --wait]      render tabs as pictures in the library, one per tab
 *
 * Archiving one is `contenthero archive tier-list <id>`. The structured parts take JSON, in the shape the tool
 * documents. The server refuses everyone else with 403 `feature_unavailable`.
 */

import type { Command } from 'commander'
import {
  GenerationTimeoutError,
  LIST_SORTS,
  optionFromContract,
  type ContractToolName,
  toolDescription,
  type CreateTierListRequest,
  type SortOrder,
  type StartTierListExportInput,
  type TierListDetail,
  type TierListListResult,
  type TierListSort,
  type UpdateTierListRequest,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { EXIT } from '../errors.js'
import { exportHuman, type ExportJobView } from './export.js'
import { emit, table, keyValues, withMore, clip } from '../output.js'
import { toCoverPosition, toInt, toJson, withPageFlags, withSortFlags } from '../args.js'

/** A flag's words, read from the agent contract's input of the tool it mirrors. */
const opt = (tool: ContractToolName, path: string): string => optionFromContract(tool, path).description

function show(l: TierListDetail): string {
  return [
    keyValues([
      ['Id', l.id],
      ['Name', l.name],
      ['Description', l.description ?? ''],
      ['Size', `${l.width}x${l.height}`],
      ['Points', l.showPoints ? 'on' : 'off'],
      ['Link', l.appUrl],
    ]),
    '',
    table(['TIER', 'ID', 'POINTS'], l.tiers.map((t) => [t.label, t.id, t.points])),
    '',
    table(['TAB', 'ID', 'REVISION'], l.tabs.map((t) => [t.name, t.id, t.revision])),
    '',
    `Items on ${l.tab.name}:`,
    table(['ITEM', 'LABEL', 'TIER', 'MEDIA'], l.items.map((i) => [i.id, clip(i.label ?? '', 30), l.tiers.find((t) => t.id === i.tierId)?.label ?? 'unranked', i.mediaId ?? ''])),
    '',
    'Standings:',
    table(['RANK', 'LABEL', 'POINTS', 'PLACEMENTS'], l.standings.map((s) => [`${s.rank}${s.tied ? '=' : ''}`, s.label, s.total ?? '', s.placements])),
  ].join('\n')
}

export function registerTierList(program: Command): void {
  const group = program.command('tier-list').description('Tier lists: boards of library media ranked into tiers (staff only while it is built)')

  withSortFlags(
    withPageFlags(
      group
        .command('list')
        .description(toolDescription('list_tier_lists'))
        .option('--archived', opt('list_tier_lists', 'archived'))
        .option('--search <text>', opt('list_tier_lists', 'search')),
    ),
    LIST_SORTS.tierLists,
  ).action(async (opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const page = await client.listTierLists({
      archived: opts.archived ? true : undefined,
      search: opts.search as string | undefined,
      sort: opts.sort as TierListSort | undefined,
      order: opts.order as SortOrder | undefined,
      limit: opts.limit as number | undefined,
      cursor: opts.cursor as string | undefined,
    })
    emit(page, ctx, (p: TierListListResult) =>
      withMore(table(['NAME', 'ID', 'UPDATED', 'FLAGS'], p.tierLists.map((l) => [l.name, l.id, l.updatedAt, l.archivedAt ? 'archived' : ''])), p.nextCursor),
    )
  })

  group
    .command('get')
    .description(toolDescription('get_tier_list'))
    .argument('<id>', opt('get_tier_list', 'tierListId'))
    .option('--tab-id <id>', opt('get_tier_list', 'tabId'))
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getTierList(id, { tabId: opts.tabId as string | undefined }), ctx, show)
    })

  group
    .command('create')
    .description(toolDescription('create_tier_list'))
    .argument('<name>', opt('create_tier_list', 'name'))
    .option('--description <text>', opt('create_tier_list', 'description'))
    .option('--width <px>', opt('create_tier_list', 'width'), toInt)
    .option('--height <px>', opt('create_tier_list', 'height'), toInt)
    .option('--show-points', opt('create_tier_list', 'showPoints'))
    .option('--no-show-points', 'hide points')
    .option('--tiers <json>', opt('create_tier_list', 'tiers'), toJson)
    .option('--tabs <json>', opt('create_tier_list', 'tabs'), toJson)
    .action(async (name: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const request: CreateTierListRequest = {
        name,
        ...(opts.description !== undefined ? { description: opts.description as string } : {}),
        ...(opts.width !== undefined ? { width: opts.width as number } : {}),
        ...(opts.height !== undefined ? { height: opts.height as number } : {}),
        ...(opts.showPoints !== undefined ? { showPoints: opts.showPoints as boolean } : {}),
        ...(opts.tiers !== undefined ? { tiers: opts.tiers as CreateTierListRequest['tiers'] } : {}),
        ...(opts.tabs !== undefined ? { tabs: opts.tabs as CreateTierListRequest['tabs'] } : {}),
      }
      emit(await client.createTierList(request), ctx, show)
    })

  group
    .command('update')
    .description(toolDescription('update_tier_list'))
    .argument('<id>', opt('update_tier_list', 'tierListId'))
    .option('--name <text>', opt('update_tier_list', 'name'))
    .option('--description <text>', opt('update_tier_list', 'description'))
    .option('--clear-description', 'remove the description')
    .option('--width <px>', opt('update_tier_list', 'width'), toInt)
    .option('--height <px>', opt('update_tier_list', 'height'), toInt)
    .option('--show-points', opt('update_tier_list', 'showPoints'))
    .option('--no-show-points', 'hide points')
    .option('--cover-media <id>', opt('update_tier_list', 'coverMediaId'))
    .option('--cover-url <url>', opt('update_tier_list', 'coverUrl'))
    .option('--clear-cover', 'remove the cover image')
    .option('--cover-position <x,y>', opt('update_tier_list', 'coverPosition'))
    .option('--tiers <json>', opt('update_tier_list', 'tiers'), toJson)
    .option('--tabs <json>', opt('update_tier_list', 'tabs'), toJson)
    .option('--items <json>', opt('update_tier_list', 'items'), toJson)
    .option('--arrangement <json>', opt('update_tier_list', 'arrangement'), toJson)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const request: UpdateTierListRequest = {
        ...(opts.name !== undefined ? { name: opts.name as string } : {}),
        ...(opts.clearDescription ? { description: null } : opts.description !== undefined ? { description: opts.description as string } : {}),
        ...(opts.width !== undefined ? { width: opts.width as number } : {}),
        ...(opts.height !== undefined ? { height: opts.height as number } : {}),
        ...(opts.showPoints !== undefined ? { showPoints: opts.showPoints as boolean } : {}),
        ...(opts.clearCover ? { coverMediaId: null } : opts.coverMedia !== undefined ? { coverMediaId: opts.coverMedia as string } : {}),
        ...(opts.coverUrl !== undefined ? { coverUrl: opts.coverUrl as string } : {}),
        // Parsed here, not by commander: an option parser that returns null is read as no value.
        ...(opts.coverPosition !== undefined ? { coverPosition: toCoverPosition(opts.coverPosition as string) } : {}),
        ...(opts.tiers !== undefined ? { tiers: opts.tiers as UpdateTierListRequest['tiers'] } : {}),
        ...(opts.tabs !== undefined ? { tabs: opts.tabs as UpdateTierListRequest['tabs'] } : {}),
        ...(opts.items !== undefined ? { items: opts.items as UpdateTierListRequest['items'] } : {}),
        ...(opts.arrangement !== undefined ? { arrangement: opts.arrangement as UpdateTierListRequest['arrangement'] } : {}),
      }
      emit(await client.updateTierList(id, request), ctx, show)
    })

  group
    .command('export')
    .description(toolDescription('export_tier_list'))
    .argument('<id>', opt('export_tier_list', 'tierListId'))
    .option('--tabs <tabs>', `${opt('export_tier_list', 'tabs')} Comma separated.`)
    .option('--format <format>', opt('export_tier_list', 'format'))
    .option('--resolution <res>', opt('export_tier_list', 'resolution'))
    .option('--no-watermark', 'remove the watermark (plan-gated)')
    .option('--folder <id>', opt('export_tier_list', 'folderId'))
    .option('--destination <where>', opt('export_tier_list', 'destination'))
    .option('--posts <ids>', `${opt('export_tier_list', 'postIds')} Comma separated.`)
    .option('--drive-account <id>', opt('export_tier_list', 'driveAccountId'))
    .option('--wait', 'poll until the export finishes and print the links')
    .option('--timeout <ms>', 'max wait when --wait (default 600000)', toInt)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const list = (v: unknown): string[] => (v as string).split(',').map((t) => t.trim()).filter(Boolean)
      const input: StartTierListExportInput = {
        ...(opts.tabs !== undefined ? { tabs: list(opts.tabs) } : {}),
        ...(opts.format !== undefined ? { format: opts.format as string } : {}),
        ...(opts.resolution !== undefined ? { resolution: opts.resolution as string } : {}),
        // commander sets opts.watermark=false when --no-watermark is passed; leave undefined otherwise.
        ...(opts.watermark === false ? { watermark: false } : {}),
        ...(opts.folder !== undefined ? { folderId: opts.folder as string } : {}),
        ...(opts.destination !== undefined ? { destination: opts.destination as StartTierListExportInput['destination'] } : {}),
        ...(opts.posts !== undefined ? { postIds: list(opts.posts) } : {}),
        ...(opts.driveAccount !== undefined ? { driveAccountId: opts.driveAccount as string } : {}),
      }
      let job: ExportJobView
      try {
        job = opts.wait
          ? await client.exportTierListAndWait(id, input, { timeoutMs: (opts.timeout as number | undefined) ?? 600000 })
          : await client.startTierListExport(id, input)
      } catch (err) {
        // Still running when the wait ended: the export is not lost, so name it and how to wait, and exit TIMEOUT.
        if (!(err instanceof GenerationTimeoutError)) throw err
        job = { exportId: err.outputId, shortId: err.shortId, appUrl: err.appUrl, status: 'rendering' }
        process.exitCode = EXIT.TIMEOUT
      }
      emit(job, ctx, () => exportHuman(job))
    })
}
