/**
 * `contenthero content` / `tracked-account` - the research surface.
 *   content list                  tracked social posts, ranked by outlier score (by relevance with --search)
 *   content get <id>              one post in full, transcript optional
 *   content analyze <id>          Break It Down, the scenes (--kind scenes), or the post's videos (--kind video)
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

import { chargeSentence, contentVideoLabel, describeAccountIdsNotFound, describeContentVideo, statusTarget, type Charge } from '@contenthero/sdk'
import type { Command } from 'commander'
import type {
  ContentScenes,
  ContentVideos,
  ContentScenesResult,
  ContentVideoResult,
  TrackedAccountDetail,
  ContentAnalysis,
  ContentAnalysisResult,
  ContentDetail,
  CostEstimate,
  ContentListResult,
  ContentSummary,
  ContentScope,
  TrackedAccount,
  ContentSort,
  SortOrder,
  TrackedAccountListResult,
} from '@contenthero/sdk'
import { LIST_SORTS } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { costRows, emit, keyValues, linkRow, table, displayId, statusCommand, withMore } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { placementFrom, toFloat, toInt, toList, withPageFlags, withPlacementFlags, withSortFlags } from '../args.js'

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

function accountDetailHuman(d: TrackedAccountDetail): string {
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

  withPageFlags(
    account
      .command('list')
      .description('List tracked accounts (both kinds by default)')
      .option('--kind <kind>', `narrow to one kind: ${['inspiration', 'brand'].join(', ')}`)
      .option('--brand-kit <id>', 'scope to the accounts linked to this brand kit'),
  )
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const kind = opts.kind as string | undefined
      if (kind && kind !== 'inspiration' && kind !== 'brand') {
        throw new CliError(`Invalid --kind "${kind}". Expected: inspiration, brand.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      emit(
        await client.listTrackedAccounts({
          accountType: kind as 'inspiration' | 'brand' | undefined,
          brandKitId: opts.brandKit as string | undefined,
          limit: opts.limit as number | undefined,
          cursor: opts.cursor as string | undefined,
        }),
        ctx,
        (p: TrackedAccountListResult) => withMore(trackedAccountsTable(p.trackedAccounts), p.nextCursor),
      )
    })

  withPlacementFlags(
    account
      .command('update')
      .description('Move a tracked account within its list (requires inspiration:write)')
      .argument('<id>', 'the tracked account id'),
  ).action(async (id: string, opts: Record<string, unknown>, command: Command) => {
    const placement = placementFrom(opts)
    if (Object.keys(placement).length === 0) throw new CliError('Name where it goes: --after, --before or --position.', EXIT.USAGE)
    const { client, ctx } = makeClient(command)
    emit(await client.updateTrackedAccount(id, placement), ctx, accountDetailHuman)
  })

  account
    .command('get')
    .description('Get one tracked account with its performance and top content')
    .argument('<id>', 'the tracked account id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getTrackedAccount(id), ctx, accountDetailHuman)
    })
}

export function registerContent(program: Command): void {
  const content = program
    .command('content')
    .description('Tracked social content: what is working, for the creators watched and for this account')

  withSortFlags(withPageFlags(
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
      .option('--account <id>', 'limit to this tracked account; repeatable', collectAccount)
      .option('--added-by-you', 'only the one-off posts saved by url')
      .option('--brand-kit <id>', 'scope to the accounts linked to this brand kit')
      .option('--favorite', 'only content the account has favorited'),
  ), LIST_SORTS.content)
    .action(async (opts: Record<string, unknown>, command: Command) => {
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
        sort: opts.sort as ContentSort | undefined,
        order: opts.order as SortOrder | undefined,
        accountIds: opts.account as string[] | undefined,
        addedByYou: opts.addedByYou ? true : undefined,
        brandKitId: opts.brandKit as string | undefined,
        favorited: opts.favorite ? true : undefined,
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
      })
      emit(result, ctx, (r: ContentListResult) => {
        const t = outliersTable(r.content)
        const notMatched = describeAccountIdsNotFound(r.accountIdsNotFound)
        return withMore(`${t}\n\n${r.content.length} of ${r.total}${notMatched.length ? `\n${notMatched.join('\n')}` : ''}`, r.nextCursor)
      })
    })

  content
    .command('get')
    .description('Get one tracked post in full (engagement, hashtags, optional transcript and Break It Down analysis)')
    .argument('<id>', 'the content id (from content list, a tracked account, or a card inspiration asset)')
    .option('--transcript [grain]', `include the transcript: ${GRAINS.join(', ')} (default none)`)
    .option('--start-ms <n>', 'window start, ms into the media: narrows transcript segments, scenes and cut lists', toInt)
    .option('--end-ms <n>', 'window end, ms into the media: narrows transcript segments, scenes and cut lists', toInt)
    .option('--transcript-search <text>', 'only the transcript segments containing this phrase')
    .option('--analysis', 'include the full Break It Down analysis (availability always reports)')
    .option('--analysis-sections <list>', 'only these analysis sections, comma-separated (names come from the availability line)', toList)
    .option('--scenes <grain>', "the post's scenes: map, each scene's range, what happens and what is said (view --content-id --at-sec shows its frames); --start-ms/--end-ms narrow them")
    .option('--cuts', "add each downloaded video's cut list: the seconds where its picture changes, measured once and free; --start-ms/--end-ms narrow the lists")
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const scenes = opts.scenes as string | undefined
      if (scenes === 'frames') {
        throw new CliError("Scenes are descriptions only: use --scenes map, and see a scene's frames with view --content-id <id> --at-sec <seconds in its range>.", EXIT.USAGE)
      }
      if (scenes != null && !['none', 'map'].includes(scenes)) {
        throw new CliError(`Invalid --scenes "${scenes}". Expected one of: none, map.`, EXIT.USAGE)
      }
      const wantsScenes = scenes === 'map'
      // `--transcript` with no value means "yes"; a window or a search implies segments, since neither can
      // be honored against flat text. With --scenes or --cuts, a window narrows those instead.
      const raw = opts.transcript
      let grain: 'none' | 'text' | 'segments' | undefined
      if (raw === true) grain = 'segments'
      else if (typeof raw === 'string') {
        if (!(GRAINS as readonly string[]).includes(raw)) {
          throw new CliError(`Invalid --transcript "${raw}". Expected one of: ${GRAINS.join(', ')}.`, EXIT.USAGE)
        }
        grain = raw as 'none' | 'text' | 'segments'
      } else if (opts.transcriptSearch || (!wantsScenes && !opts.cuts && (opts.startMs != null || opts.endMs != null))) {
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
        scenes: wantsScenes ? 'map' : undefined,
        cuts: opts.cuts ? true : undefined,
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
        const post = { contentId: c.id, shortId: c.shortId ?? undefined }
        if (c.analysis) out += `\n\n${analysisText(post, c.analysis)}`
        if (c.scenes) out += `\n\n${scenesText(c.scenes, post)}`
        if (c.video) out += `\n\n${postVideosText(c.video)}`
        return out
      })
    })

  content
    .command('analyze')
    .description("Analyze a tracked post: Break It Down, its scenes with --kind scenes, or its videos with --kind video (every video the post holds, its one video or each video slide of a carousel, downloaded into shared analysis copies, each with its cut list once stored, never your library). Free when the result exists, otherwise it spends credits (see --cost)")
    .argument('<id>', 'the content id (from content list, a tracked account, or a card inspiration asset)')
    .option('--kind <kind>', "breakdown (default), scenes (the scene map, each scene's range, what happens and what is said, priced per minute of video), or video (every video the post holds in shared analysis copies, each with its cut list once stored, charged for what the downloads moved)")
    .option('--cost', 'show the credit cost instead of analyzing (nothing runs, nothing is charged)')
    .option('--no-wait', 'return at once instead of waiting for a running analysis')
    .option('--timeout <sec>', `how long to wait for a running analysis (default ${ANALYZE_TIMEOUT_SEC})`, toInt)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kind = (opts.kind as string | undefined) ?? 'breakdown'
      if (kind !== 'breakdown' && kind !== 'scenes' && kind !== 'video') {
        throw new CliError("--kind must be 'breakdown', 'scenes' or 'video'", EXIT.USAGE)
      }
      if (opts.cost) {
        const est = await client.estimateAnalysisCost(id, { kind })
        emit(est, ctx, (e: CostEstimate) =>
          kind === 'video'
            ? e.creditsEstimate === 0
              ? "This post's videos are already in their analysis copies or being downloaded: it costs 0 credits. Nothing ran and nothing was charged."
              : `Downloading this post's videos for analysis costs at most ${e.creditsEstimate} credits: the most the downloads may move is held, and it is charged for what arrives. Nothing ran and nothing was charged.`
            : kind === 'scenes'
              ? `Preparing this post's scenes costs ${e.creditsEstimate} credits. Nothing ran and nothing was charged.`
              : `Analyzing this post costs ${e.creditsEstimate} credits. Nothing ran and nothing was charged.`,
        )
        return
      }
      const timeoutMs = ((opts.timeout as number | undefined) ?? ANALYZE_TIMEOUT_SEC) * 1000
      if (kind === 'video') {
        // A post's copy has no job `status` reads: asking again with the same kind is how it is followed, and is free.
        let video = await client.analyzeContent(id, { kind: 'video' })
        const deadline = Date.now() + timeoutMs
        while (opts.wait !== false && video.copy.status === 'pending' && Date.now() + ANALYZE_POLL_MS <= deadline) {
          await new Promise((resolve) => setTimeout(resolve, ANALYZE_POLL_MS))
          video = await client.analyzeContent(id, { kind: 'video' })
        }
        emit(video, ctx, contentVideoHuman)
        if (opts.wait !== false && video.copy.status === 'pending') process.exitCode = EXIT.TIMEOUT
        return
      }
      // Either kind runs as a job, waited on through the SDK's one wait (`waitForStatus`), which starts nothing. Done:
      // ask once more, which starts nothing for a finished post and answers with the result and its final charge.
      const waited = async (r: { contentId: string; shortId?: string }, statusKind: 'content' | 'scenes'): Promise<boolean> => {
        if (opts.wait === false) return false
        const [status] = await client.waitForStatus([statusTarget({ id: r.contentId, shortId: r.shortId, kind: statusKind })], {
          timeoutMs,
          pollIntervalMs: ANALYZE_POLL_MS,
        })
        return status?.state === 'completed' || status?.state === 'failed'
      }
      if (kind === 'scenes') {
        let scenes = await client.analyzeContent(id, { kind: 'scenes' })
        if (scenes.scenes.status === 'running' && (await waited(scenes, 'scenes'))) scenes = await client.analyzeContent(id, { kind: 'scenes' })
        emit(scenes, ctx, (r: ContentScenesResult) => `Scenes for post ${postName(r)}\n\n${scenesText(r.scenes, r)}${costAfter(r.charge)}`)
        if (opts.wait !== false && scenes.scenes.status === 'running') process.exitCode = EXIT.TIMEOUT
        return
      }
      let result = await client.analyzeContent(id)
      if (result.analysis.status === 'running' && (await waited(result, 'content'))) result = await client.analyzeContent(id)
      if (opts.wait !== false && result.analysis.status === 'running') process.exitCode = EXIT.TIMEOUT
      emit(result, ctx, (r: ContentAnalysisResult) => `Break It Down for post ${postName(r)}\n\n${analysisText(r, r.analysis)}${costAfter(r.charge)}`)
    })
}

/** Where a post's videos stand, each with its cut list once stored, and how to follow them while they download. */
export function contentVideoHuman(r: ContentVideoResult): string {
  const copy = r.copy
  const status =
    copy.status === 'ready'
      ? "ready in the post's shared analysis copies, which the reading tools use. Nothing was added to your library."
      : copy.status === 'pending'
        ? "still downloading into the post's shared analysis copies"
        : copy.status === 'failed'
          ? `a download failed: ${copy.error.trim().replace(/\.+$/, '')}. Asking again tries once more.`
          : copy.status === 'unavailable'
            ? `this post has no video to analyze: ${copy.reason.trim().replace(/\.+$/, '')}`
            : 'not downloaded yet'
  return keyValues([
    ['Post', displayId({ id: r.contentId, shortId: r.shortId })],
    ...linkRow(r),
    ['Status', status],
    ...r.videos.map((v): [string, string] => [contentVideoLabel(v), describeContentVideo(v)]),
    ...costRows(r.charge),
    ...(copy.status === 'pending'
      ? [['Next', `contenthero content analyze ${r.shortId || r.contentId} --kind video (free)`] as [string, string]]
      : []),
  ])
}

/** Repeatable --account. */
function collectAccount(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** How long `content analyze` waits for a running analysis by default, and how often it looks. */
const ANALYZE_TIMEOUT_SEC = 600
const ANALYZE_POLL_MS = 5_000

/**
 * A post's videos as content get reports them, always: where they stand together, then each video with its state and,
 * with --cuts, its cut list, in the words content analyze --kind video uses.
 */
function postVideosText(video: ContentVideos): string {
  const c = video.copy
  const head =
    c.status === 'ready'
      ? `Videos: ready${video.videos.some((v) => v.cuts) ? '' : " (--cuts reads where each one's picture changes)"}`
      : c.status === 'pending'
        ? 'Videos: still downloading (content analyze --kind video follows them, free)'
        : c.status === 'failed'
          ? `Videos: a download failed (${c.error.trim().replace(/\.+$/, '')}); content analyze --kind video tries again`
          : c.status === 'unavailable'
            ? `Videos: none (${c.reason.trim().replace(/\.+$/, '')})`
            : 'Videos: not downloaded (content analyze --kind video downloads them)'
  return [head, ...video.videos.map((v) => `  ${contentVideoLabel(v)}: ${describeContentVideo(v)}`)].join('\n')
}

/** A post an analysis answer is about: the id its job is followed by, and its page. */
function postName(r: { contentId: string; shortId?: string; appUrl?: string }): string {
  return `${displayId({ id: r.contentId, shortId: r.shortId })}${r.appUrl ? ` (${r.appUrl})` : ''}`
}

/** A post's scenes: whether they exist, and how to read them. */
function scenesText(sc: ContentScenes, post: { contentId: string; shortId?: string }): string {
  if (sc.status === 'running') {
    return `Scenes: running (wait with ${statusCommand([{ id: post.contentId, shortId: post.shortId, kind: 'scenes' }])}, then content analyze --kind scenes reads them at no charge)`
  }
  if (sc.status === 'complete' && sc.detail) {
    const d = sc.detail
    const head = `Scenes: ${sc.sceneCount}${d.windowed ? ` (${d.scenes.length} in this window)` : ''}`
    const rows = d.scenes.map((s) => {
      const said = s.said === null ? '' : `\n    said: ${s.said || '(nothing)'}`
      return `  ${s.index + 1}. [${(s.startMs / 1000).toFixed(1)}s to ${(s.endMs / 1000).toFixed(1)}s] ${s.description}${said}`
    })
    const frames = d.scenes.length ? `  (see a scene's frames with contenthero view --content-id ${displayId({ id: post.contentId, shortId: post.shortId })} --at-sec <seconds in its range>)` : null
    return [head, d.summary ? `  ${d.summary}` : null, d.timedTranscript ? null : '  (no timed transcript: what is said per scene is unknown)', frames, ...rows]
      .filter(Boolean)
      .join('\n')
  }
  if (sc.status === 'complete') return `Scenes: ${sc.sceneCount} ready (read them with content get <id> --scenes map)`
  if (sc.status === 'failed') return `Scenes: failed (${sc.error}); content analyze --kind scenes tries it again`
  if (sc.status === 'unavailable') return `Scenes: unavailable (${sc.reason})`
  return 'Scenes: absent (content analyze --kind scenes prepares them)'
}

/** A post's Break It Down: its status always, and the sections when they were returned. */
function analysisText(post: { contentId: string; shortId?: string }, an: ContentAnalysis): string {
  if (an.status === 'running') {
    return `Analysis: running (wait with ${statusCommand([{ id: post.contentId, shortId: post.shortId, kind: 'content' }])}, then content analyze reads it at no charge)`
  }
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

/** The cost line under an analysis, when the server sent a receipt. */
function costAfter(charge: Charge | undefined): string {
  const cost = chargeSentence(charge)
  return cost ? `\n\n${cost}` : ''
}
