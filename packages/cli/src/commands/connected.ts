/**
 * `contenthero connected-account` - the publish targets this account has connected.
 *   connected-account list             connected publish targets (default first)
 *   connected-account get <id>         one connected account's detail
 *
 * DISTINCT from `tracked-account`, which is what ContentHero WATCHES for performance and research. A
 * connected account is an OAuth grant we can publish through; the two overlap in the real world and are
 * different records here. The old `brand-account` group lived in this file and belonged with the other one.
 *
 * Reads only. Responses never include tokens (safe projection).
 */

import type { Command } from 'commander'
import type { ConnectedAccount } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'

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
