/**
 * `contenthero brand-account` / `connected-account` - the account's own accounts.
 *   brand-account list                 the owner's tracked brand social accounts
 *   brand-account performance <id>     one brand account's performance summary
 *   connected-account list             connected publish targets (default first)
 *   connected-account get <id>         one connected account's detail
 *
 * Reads only. Connected-account responses never include tokens (safe projection).
 */

import type { Command } from 'commander'
import type { BrandAccountPerformance, ConnectedAccount } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { outliersTable, trackedAccountsTable } from './inspiration.js'

export function registerBrandAccount(program: Command): void {
  const brandAccount = program
    .command('brand-account')
    .description("The owner's own tracked brand social accounts")

  brandAccount
    .command('list')
    .description("List the owner's brand social accounts")
    .option('--brand-kit <id>', 'scope to the brand accounts linked to this brand kit')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(
        await client.listBrandAccounts({ brandKitId: opts.brandKit as string | undefined }),
        ctx,
        trackedAccountsTable,
      )
    })

  brandAccount
    .command('performance')
    .description('Get the performance summary for one brand account')
    .argument('<id>', 'the brand account id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const perf = await client.getBrandAccountPerformance(id)
      emit(perf, ctx, (p: BrandAccountPerformance) => {
        const head = keyValues([
          ['Account', p.account.name ?? p.account.handle ?? ''],
          ['Platform', p.account.platform ?? ''],
          ['Tracked items', p.contentCount],
          ['Total views', p.totals.views],
          ['Total likes', p.totals.likes],
          ['Total comments', p.totals.comments],
          ['Avg views', p.averages.views ?? ''],
          ['Avg engagement', p.averages.engagementRate ?? ''],
          ['Avg outlier score', p.averages.outlierScore ?? ''],
        ])
        const top = p.topContent.length ? '\n\nTop content:\n' + outliersTable(p.topContent) : ''
        return head + top
      })
    })
}

export function registerConnectedAccount(program: Command): void {
  const connected = program
    .command('connected-account')
    .description('Connected social accounts (publish targets)')

  connected
    .command('list')
    .description('List connected accounts (default first)')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const accounts = await client.listConnectedAccounts()
      emit(accounts, ctx, (rows: ConnectedAccount[]) =>
        table(
          ['ID', 'PLATFORM', 'NAME', 'HANDLE', 'STATUS', 'DEFAULT'],
          rows.map((a) => [
            a.id.slice(0, 8),
            a.platform ?? '',
            a.accountName ?? '',
            a.accountHandle ?? '',
            a.connectionStatus ?? '',
            a.isDefault ? 'yes' : '',
          ]),
        ),
      )
    })

  connected
    .command('get')
    .description("Get one connected account's detail")
    .argument('<id>', 'the connected account id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const a = await client.getConnectedAccount(id)
      emit(a, ctx, (acc: ConnectedAccount) =>
        keyValues([
          ['Name', acc.accountName ?? ''],
          ['Id', acc.id],
          ['Platform', acc.platform ?? ''],
          ['Handle', acc.accountHandle ?? ''],
          ['Status', acc.connectionStatus ?? ''],
          ['Type', acc.connectionType ?? ''],
          ['Default', acc.isDefault ? 'yes' : 'no'],
          ['Capabilities', acc.capabilities ? JSON.stringify(acc.capabilities) : '(none)'],
        ]),
      )
    })
}
