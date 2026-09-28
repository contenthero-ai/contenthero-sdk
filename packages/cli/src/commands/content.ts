/**
 * `contenthero content` / `tracked-account` - the research surface.
 *   content list                  tracked social posts, ranked by outlier score (by relevance with --search)
 *   content get <id>              one post in full, transcript optional
 *   tracked-account list          the social accounts this account tracks
 *   tracked-account get <id>      one account with its performance
 *
 * ## Why these names
 *
 * This replaces `inspiration accounts|account|outliers|content` and `brand-account list|performance`, two
 * command groups over ONE table that differed only by which `account_type` they would accept. The split made
 * a caller choose a subsystem before it could ask a question, and gave a worse answer for one of the two.
 *
 * `tracked-account` rather than `account` because `contenthero account` is already the ContentHero account
 * itself (balance, tier), which is a different thing entirely.
 *
 * Reads only.
 */

import type { Command } from 'commander'
import type {
  ContentScenes,
  ContentScenesResult,
  AccountDetail,
  ContentAnalysis,
  ContentAnalysisResult,
  ContentDetail,
  CostEstimate,
  ContentListResult,
  ContentSummary,
  ContentScope,
  TrackedAccount,
  ContentSort,
} from '@contenthero/sdk'
import { CONTENT_SORTS } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table, displayId } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toFloat, toInt, toList } from '../args.js'

/** A table of tracked accounts. KIND is present because the list spans both tiers by default. */
export function trackedAccountsTable(rows: TrackedAccount[]): string {
  return table(
    ['ID', 'KIND', 'PLATFORM', 'HANDLE', 'NAME', 'FOLLOWERS'],
    rows.map((a) => [
      displayId(a),
      a.accountType === 'brand' ? 'yours' : a.accountType === 'inspiration' ? 'watching' : '',
      a.platform ?? '',
      a.handle ?? '',
      a.name ?? '',
      a.followerCount ?? '',
    ]),
  )
}

/** A table of tracked content. OWN marks the caller's own posts, since one list holds both. */
export function outliersTable(rows: ContentSummary[]): string {
  return table(
    ['ID', 'OWN', 'PLATFORM', 'SCORE', 'VIEWS', 'TITLE'],
    rows.map((o) => [
      displayId(o),
      o.isOwn ? 'yes' : '',
      o.platform ?? '',
      o.outlierScore != null ? o.outlierScore.toFixed(1) : '',
      o.viewCount ?? '',
      (o.title ?? '').replace(/\s+/g, ' ').slice(0, 50),
    ]),
  )
}

const SCOPES = ['all', 'inspiration', 'brand'] as const
const WINDOWS = ['week', 'month', '3months', '6months', 'year', '2years'] as const
const GRAINS = ['none', 'text', 'segments'] as const

function accountDetailHuman(d: AccountDetail): string {
  const head = keyValues([
    ['Account', d.account.name ?? d.account.handle ?? ''],
    ['Kind', d.account.accountType === 'brand' ? 'yours' : 'watching'],
    ['Platform', d.account.platform ?? ''],
    ['Followers', d.account.followerCount ?? ''],
    ['Tracked items', d.contentCount],
    ['Total views', d.totals.views],
    ['Total likes', d.totals.likes],
    ['Total comments', d.totals.comments],
    ['Avg views', d.averages.views ?? ''],
    ['Avg engagement', d.averages.engagementRate ?? ''],
    ['Avg outlier score', d.averages.outlierScore ?? ''],
  ])
  const top = d.topContent.length ? '\n\nTop content:\n' + outliersTable(d.topContent) : ''
  const recent = d.recentContent.length ? '\n\nMost recent:\n' + outliersTable(d.recentContent) : ''
  return head + top + recent
}

export function registerTrackedAccount(program: Command): void {
  const account = program
    .command('tracked-account')
    .description('The social accounts this account tracks (its own, and the creators it watches)')

  account
    .command('list')
    .description('List tracked accounts (both kinds by default)')
    .option('--kind <kind>', `narrow to one kind: ${['inspiration', 'brand'].join(', ')}`)
    .option('--brand-kit <id>', 'scope to the accounts linked to this brand kit')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const kind = opts.kind as string | undefined
      if (kind && kind !== 'inspiration' && kind !== 'brand') {
        throw new CliError(`Invalid --kind "${kind}". Expected: inspiration, brand.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      emit(
        await client.listAccounts({
          accountType: kind as 'inspiration' | 'brand' | undefined,
          brandKitId: opts.brandKit as string | undefined,
        }),
        ctx,
        trackedAccountsTable,
      )
    })

  account
    .command('get')
    .description('Get one tracked account with its performance and top content')
    .argument('<id>', 'the tracked account id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getAccount(id), ctx, accountDetailHuman)
    })
}

export function registerContent(program: Command): void {
  const content = program
    .command('content')
    .description('Tracked social content: what is working, for the creators watched and for this account')

  content
    .command('list')
    .description('List tracked content, ranked by outlier score, or by relevance when you pass --search')
    .option('--scope <scope>', `which accounts: ${SCOPES.join(', ')} (default all)`)
    .option('--platform <platform>', 'filter to one platform (youtube, instagram)')
    .option('--type <type>', 'content type, e.g. video, short, reel')
    .option('--min-score <n>', 'only content at or above this outlier score', toFloat)
    .option('--max-score <n>', 'only content at or below this outlier score', toFloat)
    .option('--min-views <n>', 'minimum view count', toInt)
    .option('--max-views <n>', 'maximum view count', toInt)
    .option('--min-duration <n>', 'minimum duration in seconds', toInt)
    .option('--max-duration <n>', 'maximum duration in seconds', toInt)
    .option('--min-followers <n>', "minimum follower count of the post's account", toInt)
    .option('--max-followers <n>', "maximum follower count of the post's account", toInt)
    .option('--since <window>', `published within: ${WINDOWS.join(', ')}`)
    .option('--published-after <iso>', 'published on or after this ISO timestamp (wins over --since)')
    .option('--published-before <iso>', 'published on or before this ISO timestamp')
    .option(
      '--search <text>',
      'finds posts by meaning and by keyword across title, creator, description and transcript, ranked by relevance; returns only the posts judged relevant, so no rows means nothing matched',
    )
    .option('--sort <sort>', `sort field: ${CONTENT_SORTS.join(', ')} (default relevance with --search, otherwise score)`)
    .option('--asc', 'sort ascending (default descending)')
    .option('--account <id>', 'limit to this tracked account; repeatable', collectAccount)
    .option('--added-by-you', 'only the one-off posts saved by url')
    .option('--brand-kit <id>', 'scope to the accounts linked to this brand kit')
    .option('--favorite', 'only content the account has favorited')
    .option('--limit <n>', 'how many to return (default 20)', toInt)
    .option('--offset <n>', 'pagination offset', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      if (opts.sort && !(CONTENT_SORTS as readonly string[]).includes(opts.sort as string)) {
        throw new CliError(`Invalid --sort "${opts.sort}". Expected one of: ${CONTENT_SORTS.join(', ')}.`, EXIT.USAGE)
      }
      if (opts.scope && !(SCOPES as readonly string[]).includes(opts.scope as string)) {
        throw new CliError(`Invalid --scope "${opts.scope}". Expected one of: ${SCOPES.join(', ')}.`, EXIT.USAGE)
      }
      if (opts.since && !(WINDOWS as readonly string[]).includes(opts.since as string)) {
        throw new CliError(`Invalid --since "${opts.since}". Expected one of: ${WINDOWS.join(', ')}.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const result = await client.listContent({
        scope: opts.scope as ContentScope | undefined,
        platform: opts.platform as string | undefined,
        contentType: opts.type as string | undefined,
        outlierScoreMin: opts.minScore as number | undefined,
        outlierScoreMax: opts.maxScore as number | undefined,
        viewsMin: opts.minViews as number | undefined,
        viewsMax: opts.maxViews as number | undefined,
        durationMin: opts.minDuration as number | undefined,
        durationMax: opts.maxDuration as number | undefined,
        subscribersMin: opts.minFollowers as number | undefined,
        subscribersMax: opts.maxFollowers as number | undefined,
        publicationDate: opts.since as string | undefined,
        publishedAfter: opts.publishedAfter as string | undefined,
        publishedBefore: opts.publishedBefore as string | undefined,
        search: opts.search as string | undefined,
        sortBy: opts.sort as ContentSort | undefined,
        sortOrder: opts.asc ? 'asc' : undefined,
        accountIds: opts.account as string[] | undefined,
        addedByYou: opts.addedByYou ? true : undefined,
        brandKitId: opts.brandKit as string | undefined,
        favorited: opts.favorite ? true : undefined,
        limit: opts.limit as number | undefined,
        offset: opts.offset as number | undefined,
      })
      emit(result, ctx, (r: ContentListResult) => {
        const t = outliersTable(r.outliers)
        return `${t}\n\n${r.outliers.length} of ${r.total}${r.hasMore ? ' (more available)' : ''}`
      })
    })

  content
    .command('get')
    .description('Get one tracked post in full (engagement, hashtags, optional transcript and Break It Down analysis)')
    .argument('<id>', 'the content id (from content list, a tracked account, or a card inspiration asset)')
    .option('--transcript [grain]', `include the transcript: ${GRAINS.join(', ')} (default none)`)
    .option('--start-ms <n>', 'transcript window start, ms into the media', toInt)
    .option('--end-ms <n>', 'transcript window end, ms into the media', toInt)
    .option('--transcript-search <text>', 'only the transcript segments containing this phrase')
    .option('--analysis', 'include the full Break It Down analysis (availability always reports)')
    .option('--analysis-sections <list>', 'only these analysis sections, comma-separated (names come from the availability line)', toList)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      // `--transcript` with no value means "yes"; a window or a search implies segments, since neither can
      // be honored against flat text.
      const raw = opts.transcript
      let grain: 'none' | 'text' | 'segments' | undefined
      if (raw === true) grain = 'segments'
      else if (typeof raw === 'string') {
        if (!(GRAINS as readonly string[]).includes(raw)) {
          throw new CliError(`Invalid --transcript "${raw}". Expected one of: ${GRAINS.join(', ')}.`, EXIT.USAGE)
        }
        grain = raw as 'none' | 'text' | 'segments'
      } else if (opts.startMs != null || opts.endMs != null || opts.transcriptSearch) {
        grain = 'segments'
      }

      const { client, ctx } = makeClient(command)
      const item = await client.getContent(id, {
        transcript: grain,
        startMs: opts.startMs as number | undefined,
        endMs: opts.endMs as number | undefined,
        transcriptSearch: opts.transcriptSearch as string | undefined,
        analysis: opts.analysis ? 'full' : undefined,
        analysisSections: opts.analysisSections as string[] | undefined,
      })
      emit(item, ctx, (c: ContentDetail) => {
        const pairs: Array<[string, string | number]> = [
          ['Title', c.title ?? ''],
          ['Own account', c.isOwn ? 'yes' : 'no'],
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
        const t = c.transcript
        if (t) {
          // The status is printed even alongside text: 'failed' and 'absent' are the difference between
          // "nothing to read" and "ask again later", which an empty body cannot convey.
          const head = `\n\nTranscript [${t.status}]${t.windowed ? ' (windowed)' : ''}:`
          if (t.segments) {
            out += head + '\n' + (t.segments.length
              ? t.segments.map((sg) => `  [${(sg.startMs / 1000).toFixed(1)}s] ${sg.text}`).join('\n')
              : t.windowed ? '  (no segments in that window)' : '  (none stored)')
          } else {
            out += head + '\n' + (t.text ?? '  (none stored)')
          }
        }
        // Availability always prints: the section names are the vocabulary --analysis-sections accepts.
        if (c.analysis) out += `\n\n${analysisText(c.analysis)}`
        return out
      })
    })

  content
    .command('analyze')
    .description('Analyze a tracked post: Break It Down, or its scenes with --kind scenes. Free when the result exists, otherwise it spends credits (see --cost)')
    .argument('<id>', 'the content id (from content list, a tracked account, or a card inspiration asset)')
    .option('--kind <kind>', 'breakdown (default) or scenes (the scene map and a frame of each scene, priced per minute of video)')
    .option('--cost', 'show the credit cost instead of analyzing (nothing runs, nothing is charged)')
    .option('--no-wait', 'return at once instead of waiting for a running analysis')
    .option('--timeout <sec>', `how long to wait for a running analysis (default ${ANALYZE_TIMEOUT_SEC})`, toInt)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kind = (opts.kind as string | undefined) ?? 'breakdown'
      if (kind !== 'breakdown' && kind !== 'scenes') throw new CliError("--kind must be 'breakdown' or 'scenes'", EXIT.USAGE)
      if (opts.cost) {
        const est = await client.estimateAnalysisCost(id, { kind })
        emit(est, ctx, (e: CostEstimate) =>
          kind === 'scenes'
            ? `Preparing this post's scenes costs ${e.creditsEstimate} credits. Nothing ran and nothing was charged.`
            : `Analyzing this post costs ${e.creditsEstimate} credits. Nothing ran and nothing was charged.`,
        )
        return
      }
      const deadline = Date.now() + ((opts.timeout as number | undefined) ?? ANALYZE_TIMEOUT_SEC) * 1000
      if (kind === 'scenes') {
        let scenes = await client.analyzeContent(id, { kind: 'scenes' })
        while (opts.wait !== false && scenes.scenes.status === 'running' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, ANALYZE_POLL_MS))
          const post = await client.getContent(id)
          if (post.scenes) scenes = { ...scenes, scenes: post.scenes }
        }
        emit(scenes, ctx, (r: ContentScenesResult) => `Scenes for post ${r.contentId}\n\n${scenesText(r.scenes)}`)
        return
      }
      let result = await client.analyzeContent(id)
      // It runs as a job: wait for it by reading the post's analysis status, which starts nothing.
      while (opts.wait !== false && result.analysis.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, ANALYZE_POLL_MS))
        const post = await client.getContent(id, { analysis: 'full' })
        result = { contentId: result.contentId, analysis: post.analysis }
      }
      emit(result, ctx, (r: ContentAnalysisResult) => `Break It Down for post ${r.contentId}\n\n${analysisText(r.analysis)}`)
    })
}

/** Repeatable --account. */
function collectAccount(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** How long `content analyze` waits for a running analysis by default, and how often it looks. */
const ANALYZE_TIMEOUT_SEC = 600
const ANALYZE_POLL_MS = 5_000

/** A post's scenes: whether they exist, and how to read them. */
function scenesText(sc: ContentScenes): string {
  if (sc.status === 'running') return 'Scenes: running (run content analyze --kind scenes again for the result)'
  if (sc.status === 'complete') return `Scenes: ${sc.sceneCount} ready (read them with content get <id> --scenes map, or --scenes frames)`
  if (sc.status === 'failed') return `Scenes: failed (${sc.error}); content analyze --kind scenes tries it again`
  if (sc.status === 'unavailable') return `Scenes: unavailable (${sc.reason})`
  return 'Scenes: absent (content analyze --kind scenes prepares them)'
}

/** A post's Break It Down: its status always, and the sections when they were returned. */
function analysisText(an: ContentAnalysis): string {
  if (an.status === 'running') return 'Analysis: running (run content analyze again for the result)'
  if (an.status === 'failed') return `Analysis: failed (${an.error ?? 'no reason recorded'}); content analyze tries it again`
  if (an.status !== 'complete') return 'Analysis: absent (content analyze creates one)'
  const provenance = [an.model, an.analyzedAt?.slice(0, 10)].filter(Boolean).join(', ')
  let out = `Analysis: complete${provenance ? ` (${provenance})` : ''}`
  if (an.sections?.length) out += `\n  sections: ${an.sections.join(', ')}`
  for (const [section, value] of Object.entries(an.data ?? {})) {
    out += `\n\n${section}:\n${JSON.stringify(value, null, 2)}`
  }
  return out
}
