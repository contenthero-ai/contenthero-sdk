/**
 * `contenthero account` - your own ContentHero account (not a tracked social account: `tracked-account`).
 *   account get      balance, spend this month, the monthly spend cap, plan and auto top-up
 *   account update   change a setting; only the flags you pass change (today: --spend-cap)
 *
 * A setting joins the account as a flag of `account update`, never as a command of its own.
 */

import { describeReserved } from '@contenthero/sdk'
import { InvalidArgumentError, type Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import type { Account } from '@contenthero/sdk'

/** `--spend-cap`: a whole number of credits, or "none" to remove the cap. */
export function parseSpendCap(value: string): number | null {
  if (value.trim().toLowerCase() === 'none') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('Pass a whole number of credits, or "none" for no cap.')
  return n
}

function accountRows(b: Account) {
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
  // DRAFT wording (pending approval): the descriptions below.
  const account = program.command('account').description('Your ContentHero account: balance, spend cap and plan')

  account
    .command('get')
    .description('Show your balance, spend this month, monthly spend cap, plan and auto top-up')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getAccount(), ctx, accountRows)
    })

  account
    .command('update')
    .description('Change an account setting; only the flags you pass change')
    .option('--spend-cap <credits>', 'monthly spend cap in credits, or "none" to remove it (owner only; needs billing:write)', parseSpendCap)
    .action(async (opts: { spendCap?: number | null }, command: Command) => {
      const fields = opts.spendCap !== undefined ? { spendCap: opts.spendCap } : {}
      if (!Object.keys(fields).length) throw new InvalidArgumentError('Pass a setting to change, such as --spend-cap.')
      const { client, ctx } = makeClient(command)
      emit(await client.updateAccount(fields), ctx, accountRows)
    })
}
