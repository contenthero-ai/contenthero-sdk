/**
 * `contenthero account` - account-level reads.
 *   account balance     credit balance, tier, and auto-top-up state
 *   account spend-cap   set the monthly spend cap
 */

import { describeReserved } from '@contenthero/sdk'
import { InvalidArgumentError, type Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import type { Balance } from '@contenthero/sdk'

/** `<cap>`: a whole number of credits, or "none" to remove the cap. */
export function parseSpendCap(value: string): number | null {
  if (value.trim().toLowerCase() === 'none') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('Pass a whole number of credits, or "none" for no cap.')
  return n
}

function balanceRows(b: Balance) {
  return keyValues([
    ['Balance', `${b.balance} credits`],
    ['Available', `${b.available} credits`],
    ['Reserved', describeReserved(b.held)],
    ['Spent this month', `${b.spentThisMonth} credits`],
    ['Monthly spend cap', b.spendCap ? `${b.spendCap.limit} credits, ${b.spendCap.remaining} left (resets ${b.spendCap.resetsAt.slice(0, 10)})` : 'none'],
    ['Tier', b.tier],
    ['Auto top-up', b.autoTopupEnabled ? 'on' : 'off'],
  ])
}

export function registerAccount(program: Command): void {
  const account = program.command('account').description('Account balance, tier and monthly spend cap')

  account
    .command('balance')
    .description('Show the credit balance, subscription tier, and auto-top-up state')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const balance = await client.getBalance()
      emit(balance, ctx, balanceRows)
    })

  account
    .command('spend-cap')
    // DRAFT wording (pending approval).
    .description('Set the monthly spend cap in credits, or "none" to remove it (owner only; needs billing:write)')
    .argument('<cap>', 'credits per month, or "none"', parseSpendCap)
    .action(async (cap: number | null, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.setSpendCap(cap), ctx, balanceRows)
    })
}
