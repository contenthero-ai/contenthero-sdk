/**
 * `contenthero inspiration` - research reads over tracked creators/competitors.
 *   inspiration accounts          the creators the account tracks
 *   inspiration account <id>      one tracked account + its top outliers
 *   inspiration outliers          top-performing content, ranked by outlier score
 *   inspiration content <id>      one item in full (incl. transcript)
 *
 * This is the core "what is working" research surface. Reads only.
 */

import type { Command } from 'commander'
import type {
  InspirationAccountDetail,
  InspirationContent,
  Outlier,
  OutliersResult,
  TrackedAccount,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toFloat, toInt } from '../args.js'

/** A table of tracked accounts (shared with brand-account list). */
export function trackedAccountsTable(rows: TrackedAccount[]): string {
  return table(
    ['ID', 'PLATFORM', 'HANDLE', 'NAME', 'FOLLOWERS'],
    rows.map((a) => [
      a.id.slice(0, 8),
      a.platform ?? '',
      a.handle ?? '',
      a.name ?? '',
      a.followerCount ?? '',
    ]),
  )
}

/** A table of outliers / tracked content. */
export function outliersTable(rows: Outlier[]): string {
  return table(
    ['ID', 'PLATFORM', 'SCORE', 'VIEWS', 'TITLE'],
    rows.map((o) => [
      o.id.slice(0, 8),
      o.platform ?? '',
      o.outlierScore != null ? o.outlierScore.toFixed(1) : '',
      o.viewCount ?? '',
      (o.title ?? '').replace(/\s+/g, ' ').slice(0, 50),
    ]),
  )
}

const SORTS = ['score', 'date', 'views'] as const
type Sort = (typeof SORTS)[number]

export function registerInspiration(program: Command): void {
  const inspiration = program
    .command('inspiration')
    .description('Research reads: tracked creators and their top content')

  inspiration
    .command('accounts')
    .description('List the creators/competitors the account tracks')
    .option('--brand-kit <id>', 'scope to the inspiration accounts linked to this brand kit')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(
        await client.listInspirationAccounts({ brandKitId: opts.brandKit as string | undefined }),
        ctx,
        trackedAccountsTable,
      )
    })

  inspiration
    .command('account')
    .description('Get one tracked account with its top outliers')
    .argument('<id>', 'the inspiration account id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const detail = await client.getInspirationAccount(id)
      emit(detail, ctx, (d: InspirationAccountDetail) => {
        const head = keyValues([
          ['Name', d.account.name ?? ''],
          ['Handle', d.account.handle ?? ''],
          ['Platform', d.account.platform ?? ''],
          ['Followers', d.account.followerCount ?? ''],
          ['Tracked items', d.contentCount],
        ])
        const top = d.topContent.length ? '\n\nTop content:\n' + outliersTable(d.topContent) : ''
        return head + top
      })
    })

  inspiration
    .command('outliers')
    .description('List top-performing content (outliers), ranked by outlier score')
    .option('--platform <platform>', 'filter to one platform (youtube, instagram)')
    .option('--type <type>', "content type, e.g. video, short, reel")
    .option('--min-score <n>', 'only content at or above this outlier score', toFloat)
    .option('--search <text>', 'text search across title, creator, handle, description')
    .option('--sort <sort>', `sort order: ${SORTS.join(', ')} (default score)`)
    .option('--brand-kit <id>', 'scope to the inspiration accounts linked to this brand kit')
    .option('--limit <n>', 'how many to return (default 20)', toInt)
    .option('--offset <n>', 'pagination offset', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      if (opts.sort && !SORTS.includes(opts.sort as Sort)) {
        throw new CliError(`Invalid --sort "${opts.sort}". Expected one of: ${SORTS.join(', ')}.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const result = await client.listOutliers({
        platform: opts.platform as string | undefined,
        contentType: opts.type as string | undefined,
        minOutlierScore: opts.minScore as number | undefined,
        search: opts.search as string | undefined,
        sortBy: opts.sort as Sort | undefined,
        brandKitId: opts.brandKit as string | undefined,
        limit: opts.limit as number | undefined,
        offset: opts.offset as number | undefined,
      })
      emit(result, ctx, (r: OutliersResult) => {
        const t = outliersTable(r.outliers)
        return `${t}\n\n${r.outliers.length} of ${r.total}${r.hasMore ? ' (more available)' : ''}`
      })
    })

  inspiration
    .command('content')
    .description('Get one tracked-content item in full (engagement, hashtags, transcript)')
    .argument('<id>', 'the content id (from outliers or an account)')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const content = await client.getInspirationContent(id)
      emit(content, ctx, (c: InspirationContent) => {
        const pairs: Array<[string, string | number]> = [
          ['Title', c.title ?? ''],
          ['Creator', c.sourceCreator ?? ''],
          ['Platform', c.platform ?? ''],
          ['Outlier score', c.outlierScore != null ? c.outlierScore.toFixed(2) : ''],
          ['Views', c.viewCount ?? ''],
          ['Likes', c.likeCount ?? ''],
          ['Comments', c.commentCount ?? ''],
        ]
        if (c.hashtags.length) pairs.push(['Hashtags', c.hashtags.join(' ')])
        if (c.url) pairs.push(['URL', c.url])
        let out = keyValues(pairs)
        if (c.transcript) {
          const preview = c.transcript.replace(/\s+/g, ' ').slice(0, 280)
          out += `\n\nTranscript (${c.transcript.length} chars):\n${preview}${c.transcript.length > 280 ? '…' : ''}`
        }
        return out
      })
    })
}
