/**
 * `contenthero account` - account-level reads.
 *   account balance   credit balance, tier, and auto-top-up state
 */

import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import type { Balance } from '@contenthero/sdk'

export function registerAccount(program: Command): void {
  const account = program.command('account').description('Account-level reads (balance, tier)')

  account
    .command('balance')
    .description('Show the credit balance, subscription tier, and auto-top-up state')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const balance = await client.getBalance()
      emit(balance, ctx, (b: Balance) =>
        keyValues([
          ['Balance', `${b.balance} credits`],
          ['Tier', b.tier],
          ['Auto top-up', b.autoTopupEnabled ? 'on' : 'off'],
        ]),
      )
    })
}
